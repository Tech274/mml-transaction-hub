import { createFileRoute } from "@tanstack/react-router";

// Scheduled cleanup: delete original CSV + error JSON artifacts from the
// private "bulk-imports" bucket for runs older than the retention window,
// then clear their path columns on bulk_import_runs.
//
// Called by pg_cron. Auth is by the `apikey` header (Supabase publishable
// key). This route lives under /api/public/* which bypasses site auth on
// the published deployment.

const DEFAULT_RETENTION_DAYS = 90;

export const Route = createFileRoute("/api/public/hooks/bulk-import-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        let days = DEFAULT_RETENTION_DAYS;
        try {
          const body = (await request.json().catch(() => null)) as { days?: number } | null;
          if (body?.days && Number.isFinite(body.days) && body.days > 0) days = Math.floor(body.days);
        } catch { /* ignore */ }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: expired, error: fnErr } = await supabaseAdmin.rpc(
          "expired_bulk_import_artifacts",
          { _days: days } as never,
        );
        if (fnErr) return json({ ok: false, error: fnErr.message }, 500);

        const list = (expired ?? []) as Array<{ run_id: string; original_csv_path: string | null; error_artifact_path: string | null }>;
        const paths = list.flatMap((r) => [r.original_csv_path, r.error_artifact_path].filter((p): p is string => !!p));

        let deleted = 0;
        // Delete in chunks of 100 to stay well below storage payload limits.
        for (let i = 0; i < paths.length; i += 100) {
          const chunk = paths.slice(i, i + 100);
          const { error } = await supabaseAdmin.storage.from("bulk-imports").remove(chunk);
          if (!error) deleted += chunk.length;
        }
        const runIds = list.map((r) => r.run_id);
        let cleared = 0;
        if (runIds.length) {
          const { data: c } = await supabaseAdmin.rpc(
            "clear_bulk_import_artifact_paths",
            { _run_ids: runIds } as never,
          );
          cleared = Number(c ?? 0);
        }
        return json({ ok: true, days, expired_runs: list.length, deleted_objects: deleted, cleared_rows: cleared });
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
