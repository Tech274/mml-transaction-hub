import { createFileRoute } from "@tanstack/react-router";

// Scheduled cleanup: delete original CSV + error JSON artifacts from the
// private "bulk-imports" bucket for runs older than the retention window,
// then clear their path columns on bulk_import_runs.
//
// Called by pg_cron (job currently PAUSED, and the 17 Sep evidence is under a
// database legal hold, see SCRUM-98).
// Auth (SCRUM-89 / G-03): the `x-cron-secret` header must match the Vault
// secret `cron_secret`. The public `apikey` header is no longer accepted.
// Retention is fixed at CLEANUP_RETENTION_DAYS; the request body is ignored.
// SCRUM-72: replies 202 at once; the cleanup runs in the background within
// HOOK_TIMEOUT_SECONDS (default 25) and its summary is logged.

export const Route = createFileRoute("/api/public/hooks/bulk-import-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedCronRequest, unauthorizedResponse } = await import(
          "@/lib/cron-auth.server"
        );
        if (!(await isAuthorizedCronRequest(request))) return unauthorizedResponse();

        const { respondThenRun, hookTimeoutMsFromEnv } = await import("@/lib/background-hook");
        return respondThenRun(request, {
          name: "bulk-import-cleanup",
          timeoutMs: hookTimeoutMsFromEnv(process.env),
          run: runCleanup,
        });
      },
    },
  },
});

async function runCleanup(): Promise<{ ok: boolean; body: unknown }> {
  const { CLEANUP_RETENTION_DAYS } = await import("@/lib/cron-auth");
  const days = CLEANUP_RETENTION_DAYS;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: expired, error: fnErr } = await supabaseAdmin.rpc(
    "expired_bulk_import_artifacts",
    { _days: days } as never,
  );
  if (fnErr) {
    const { logError } = await import("@/lib/app-error");
    const ref = logError(fnErr, "bulk-import-cleanup:lookup");
    return { ok: false, body: { ok: false, error: "cleanup lookup failed", ref } };
  }

  // SCRUM-96: failures are logged with a ref; paths are cleared only for fully deleted runs.
  const { cleanupExpiredArtifacts } = await import("@/lib/artifact-cleanup");
  const { logError } = await import("@/lib/app-error");
  const list = (expired ?? []) as Array<{ run_id: string; original_csv_path: string | null; error_artifact_path: string | null }>;
  const summary = await cleanupExpiredArtifacts(
    list,
    {
      remove: (paths) => supabaseAdmin.storage.from("bulk-imports").remove(paths),
      clearPaths: (runIds) => supabaseAdmin.rpc("clear_bulk_import_artifact_paths", { _run_ids: runIds } as never) as never,
      log: logError,
    },
    { dryRun: false, where: "bulk-import-cleanup" },
  );
  return { ok: summary.ok, body: { days, ...summary } };
}
