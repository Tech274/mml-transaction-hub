import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Admin-only: manually run the bulk-import artifact retention cleanup for a
// chosen `days` value. Returns counts so the UI can confirm how many objects
// were removed and how many run records had their artifact paths cleared.
export const runArtifactCleanup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        days: z.number().int().min(1).max(3650),
        dryRun: z.boolean().optional().default(false),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: rErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (rErr) throw new Error(rErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: expired, error: fnErr } = await supabaseAdmin.rpc(
      "expired_bulk_import_artifacts",
      { _days: data.days } as never,
    );
    if (fnErr) throw new Error(fnErr.message);

    const list = (expired ?? []) as Array<{
      run_id: string;
      original_csv_path: string | null;
      error_artifact_path: string | null;
    }>;
    const paths = list.flatMap((r) =>
      [r.original_csv_path, r.error_artifact_path].filter((p): p is string => !!p),
    );

    // Track removals per storage bucket + per artifact kind so the admin UI
    // can render an accurate summary.
    const csvPaths = list.map((r) => r.original_csv_path).filter((p): p is string => !!p);
    const errorPaths = list.map((r) => r.error_artifact_path).filter((p): p is string => !!p);

    async function removeAll(bucket: string, all: string[]): Promise<number> {
      let removed = 0;
      for (let i = 0; i < all.length; i += 100) {
        const chunk = all.slice(i, i + 100);
        const { error } = await supabaseAdmin.storage.from(bucket).remove(chunk);
        if (!error) removed += chunk.length;
      }
      return removed;
    }

    const csvRemoved = data.dryRun ? csvPaths.length : await removeAll("bulk-imports", csvPaths);
    const errorRemoved = data.dryRun ? errorPaths.length : await removeAll("bulk-imports", errorPaths);
    const deletedObjects = csvRemoved + errorRemoved;
    const buckets: Record<string, { originalCsv: number; errorArtifact: number; total: number }> = {
      "bulk-imports": {
        originalCsv: csvRemoved,
        errorArtifact: errorRemoved,
        total: csvRemoved + errorRemoved,
      },
    };

    let clearedRows = 0;
    const runIds = list.map((r) => r.run_id);
    if (runIds.length) {
      if (data.dryRun) {
        clearedRows = runIds.length;
      } else {
        const { data: c } = await supabaseAdmin.rpc(
          "clear_bulk_import_artifact_paths",
          { _run_ids: runIds } as never,
        );
        clearedRows = Number(c ?? 0);
      }
    }

    return {
      days: data.days,
      dryRun: data.dryRun,
      expiredRuns: list.length,
      deletedObjects,
      clearedRows,
      pathsAttempted: paths.length,
      buckets,
    };
  });