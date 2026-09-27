import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LINE_OF_BUSINESS_OPTIONS,
  PUBLIC_HEADERS,
  PRIVATE_HEADERS,
  TEMPLATE_VERSION,
  getBulkTemplateSchema,
} from "@/lib/bulk-template";
import { dbError, logError } from "@/lib/app-error";
import { cleanupExpiredArtifacts } from "@/lib/artifact-cleanup";
import { requireRole } from "@/lib/require-role";

// Public schema descriptor — read by the UI (and the E2E template-sync test)
// to guarantee the downloadable template and the server validator stay in
// lockstep across releases.
export const getTemplateSchema = createServerFn({ method: "GET" }).handler(
  async () => getBulkTemplateSchema(),
);

// Server-side row validator for bulk-template uploads. Callers (both the
// browser UI and the direct-API E2E test) POST parsed rows and receive a
// structured, machine-readable error payload:
//
//   { template_version, kind, errors: [{ line, column, value, message, allowed_values? }] }
//
// This is the "server API" enforcement layer for the CSV template: it
// mirrors the DB CHECK constraint so callers can never bypass validation by
// skipping the client, and it always names the exact row, column, and the
// allowed values.
export const validateBulkImportRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        kind: z.enum(["public_cloud", "private_cloud"]),
        rows: z
          .array(z.record(z.string(), z.string()))
          .max(50_000, "too many rows"),
        client_template_version: z.string().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const headers = data.kind === "public_cloud" ? PUBLIC_HEADERS : PRIVATE_HEADERS;
    const errors: Array<{
      line: number;
      column: string;
      value: string;
      message: string;
      allowed_values?: readonly string[];
    }> = [];

    data.rows.forEach((row, i) => {
      const line = i + 2; // header is line 1
      const lob = row["line_of_business"] ?? "";
      if (!(LINE_OF_BUSINESS_OPTIONS as readonly string[]).includes(lob)) {
        errors.push({
          line,
          column: "line_of_business",
          value: lob,
          message: `line_of_business must be exactly one of ${LINE_OF_BUSINESS_OPTIONS.join(", ")} (case-sensitive, no surrounding whitespace).`,
          allowed_values: LINE_OF_BUSINESS_OPTIONS,
        });
      }
      for (const h of headers) {
        if (!(h in row) || String(row[h] ?? "").length === 0) {
          if (h === "line_of_business") continue; // already reported above
          errors.push({
            line,
            column: h,
            value: String(row[h] ?? ""),
            message: `${h} is required`,
          });
        }
      }
    });

    return {
      template_version: TEMPLATE_VERSION,
      kind: data.kind,
      client_template_version: data.client_template_version ?? null,
      version_matches:
        !data.client_template_version || data.client_template_version === TEMPLATE_VERSION,
      total_rows: data.rows.length,
      error_count: errors.length,
      errors,
    };
  });

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
        clearPaths: (runIds) => supabaseAdmin.rpc("clear_bulk_import_artifact_paths", { _run_ids: runIds } as never) as never,
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
