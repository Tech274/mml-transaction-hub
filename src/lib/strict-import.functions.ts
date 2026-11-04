// SCRUM-103: server functions for the bulk importer (the Bulk Import tab).
// Available to Admin, Ops Lead and Ops User. No feature flag.
// All rules live in src/lib/strict-import/service.ts (unit-tested).
// SCRUM-131: parse -> Healer -> validate -> sign-off -> commit. Uploaders SUBMIT for approval
// (stage_import, nothing written to transactions); an approver (Chief) commits by approving in
// src/lib/import-approvals.functions.ts. The direct import_transactions_batch() call is gone, and the
// database no longer lets any client role execute it.
// SCRUM-129: there is deliberately NO cloud-type input. Each row's Cloud Provider decides that
// row's type on the server (validate.ts -> service.ts) and again in the database function, so a
// client cannot choose, default or override it. Unknown input keys are stripped by zod.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { base64ToBytes } from "@/lib/strict-import/hash";
import { loadSheetJs, MAX_STRICT_FILE_BYTES } from "@/lib/strict-import/parse";
import { STRICT_TEMPLATE_STATUS, STRICT_TEMPLATE_VERSION } from "@/lib/strict-import/template";
import {
  APPROVAL_REQUIRED_MESSAGE,
  runPreview,
  runSubmit,
  stageRpcError,
  StrictImportError,
  type CommitResult,
  type RepeatOf,
  type StageRpcResult,
  type StrictImportDeps,
} from "@/lib/strict-import/service";
import { untyped } from "@/lib/strict-import/db-client";
import type { PriorImport } from "@/lib/strict-import/commit-plan";
import { dbError } from "@/lib/app-error";
import { hasAnyRole } from "@/lib/require-role";

const IMPORT_ROLES = ["admin", "ops_lead", "ops_user"] as const;
// base64 is 4/3 of the byte size; allow a little slack.
const MAX_BASE64 = Math.ceil((MAX_STRICT_FILE_BYTES * 4) / 3) + 16;

type AuthedContext = {
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>;
  userId: string;
};

function depsFor(context: AuthedContext): StrictImportDeps {
  const { supabase, userId } = context;
  return {
    hasImportRole: () => hasAnyRole(context, IMPORT_ROLES),
    // SCRUM-131: the Healer matches names against every existing customer (case and spaces).
    listCustomers: async () => {
      const out: { customer_name: string; normalized_name: string }[] = [];
      const page = 1000;
      for (let from = 0; from < 50_000; from += page) {
        const { data, error } = await supabase
          .from("customers")
          .select("customer_name, normalized_name")
          .order("customer_name", { ascending: true })
          .range(from, from + page - 1);
        if (error) throw dbError(error, "strict-import.listCustomers");
        out.push(...(data ?? []));
        if (!data || data.length < page) break;
      }
      return out;
    },
    priorImport: async (sha): Promise<PriorImport | null> => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("id, created_at")
        .eq("file_sha256", sha)
        .order("created_at", { ascending: true })
        .limit(1);
      // A failed lookup (migration not applied) does not block the import.
      if (error || !data?.length) return null;
      const row = data[0];
      return { id: row.id, importedOn: String(row.created_at).slice(0, 10) };
    },
    pendingImport: async (sha): Promise<PriorImport | null> => {
      const { data, error } = await untyped(supabase)
        .from<{ id: string; uploaded_at: string }[]>("import_stages")
        .select("id, uploaded_at")
        .eq("file_sha256", sha)
        .eq("status", "pending")
        .order("uploaded_at", { ascending: true })
        .limit(1);
      if (error || !data?.length) return null;
      return { id: data[0].id, importedOn: String(data[0].uploaded_at).slice(0, 10) };
    },
    callStage: async (payload) => {
      const { data, error } = await untyped(supabase).rpc<StageRpcResult>("stage_import", { ...payload });
      if (error) throw stageRpcError(error);
      if (!data) throw new Error("stage_import returned nothing");
      return data;
    },
    loadXlsx: loadSheetJs,
  };
}

/** For code "repeat_file": `repeatOf` (earlier batch or waiting stage) and `canAcknowledge`. */
type Failure = {
  ok: false;
  code: StrictImportError["code"];
  message: string;
  reasons: string[];
  repeatOf?: RepeatOf | null;
  canAcknowledge?: boolean;
};

function asFailure(e: unknown): Failure {
  if (e instanceof StrictImportError) {
    const base: Failure = { ok: false, code: e.code, message: e.message, reasons: e.reasons };
    return e.repeat ? { ...base, repeatOf: e.repeat.repeatOf, canAcknowledge: e.repeat.canAcknowledge } : base;
  }
  throw e;
}

const fileInput = z.object({
  filename: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1).max(MAX_BASE64, "File is larger than 5 MB"),
  // SCRUM-131 date fix: the uploader's answer when every DD-MM-style date is ambiguous. The server re-checks it.
  dateOrder: z.enum(["DMY", "MDY"]).optional(),
});

export const getStrictImportStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const deps = depsFor(context);
    return {
      enabled: true,
      canImport: await deps.hasImportRole(),
      templateVersion: STRICT_TEMPLATE_VERSION,
      templateStatus: STRICT_TEMPLATE_STATUS,
    };
  });

export const previewStrictImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => fileInput.parse(raw))
  .handler(async ({ data, context }) => {
    try {
      const preview = await runPreview(depsFor(context), {
        filename: data.filename,
        bytes: base64ToBytes(data.contentBase64),
        dateOrder: data.dateOrder,
      });
      return { ok: true as const, preview };
    } catch (e) {
      return asFailure(e);
    }
  });

// SCRUM-131: submit for approval. Re-reads the bytes and re-runs parse -> Healer -> validate on the
// server (authoritative), refuses any blocker, stages the healed rows. Nothing reaches transactions.
export const submitStrictImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    fileInput
      .extend({
        expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
        // SCRUM-131: "Submit anyway" after the repeat-file warning. Recorded on the stage (who, when).
        acknowledgeRepeatFile: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    try {
      const result = await runSubmit(depsFor(context), {
        filename: data.filename,
        bytes: base64ToBytes(data.contentBase64),
        dateOrder: data.dateOrder,
        expectedSha256: data.expectedSha256,
        acknowledgeRepeatFile: data.acknowledgeRepeatFile === true,
      });
      return { ok: true as const, result };
    } catch (e) {
      return asFailure(e);
    }
  });

/**
 * @deprecated SCRUM-131: uploaders cannot commit. Kept (same input) so the current Bulk Upload screen
 * gets a clear "needs approval" answer instead of a write; the screen should call submitStrictImport.
 * Nothing is parsed, staged or written here.
 */
export const commitStrictImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    fileInput
      .extend({
        expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
        importAnyway: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async (): Promise<Failure | { ok: true; result: CommitResult }> => {
    return { ok: false, code: "approval_required", message: APPROVAL_REQUIRED_MESSAGE, reasons: [APPROVAL_REQUIRED_MESSAGE] };
  });
