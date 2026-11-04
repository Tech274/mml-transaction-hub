import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError, logError } from "@/lib/app-error";
import { cleanupExpiredArtifacts } from "@/lib/artifact-cleanup";
import { requireRole } from "@/lib/require-role";

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
    await requireRole(context, ["admin"], "Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: expired, error: fnErr } = await supabaseAdmin.rpc(
      "expired_bulk_import_artifacts",
      { _days: data.days } as never,
    );
    if (fnErr) throw dbError(fnErr, "bulk-import.runArtifactCleanup");

    const list = (expired ?? []) as Array<{
      run_id: string;
      original_csv_path: string | null;
      error_artifact_path: string | null;
    }>;
    // SCRUM-96: failures are logged with a ref and reported; a run's paths are cleared only
    // when all of its files were removed (see src/lib/artifact-cleanup.ts).
    const summary = await cleanupExpiredArtifacts(
      list,
      {
        remove: (paths) => supabaseAdmin.storage.from("bulk-imports").remove(paths),
        clearPaths: (runIds) =>
          supabaseAdmin.rpc("clear_bulk_import_artifact_paths", {
            _run_ids: runIds,
          } as never) as never,
        log: logError,
      },
      { dryRun: data.dryRun, where: "bulk-import.runArtifactCleanup" },
    );

    return {
      days: data.days,
      dryRun: data.dryRun,
      expiredRuns: summary.expiredRuns,
      deletedObjects: summary.deletedObjects,
      clearedRows: summary.clearedRows,
      pathsAttempted: summary.pathsAttempted,
      failedObjects: summary.failedObjects,
      runsKept: summary.runsKept,
      errorRefs: summary.errorRefs,
      buckets: {
        "bulk-imports": {
          originalCsv: summary.csvRemoved,
          errorArtifact: summary.errorRemoved,
          total: summary.csvRemoved + summary.errorRemoved,
        },
      } as Record<string, { originalCsv: number; errorArtifact: number; total: number }>,
    };
  });
