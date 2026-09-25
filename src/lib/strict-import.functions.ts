// SCRUM-103: server functions for the strict importer.
// Behind the strict_import_enabled flag (env STRICT_IMPORT_ENABLED, default OFF).
// All rules live in src/lib/strict-import/service.ts (unit-tested). The write
// happens only through the database function import_transactions_batch(),
// called with the user's own session so auth.uid() and role checks apply.
// Import rules are PROPOSED defaults pending Vivek's confirmation.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { isStrictImportEnabled } from "@/lib/strict-import/flag";
import { base64ToBytes } from "@/lib/strict-import/hash";
import { loadSheetJs, MAX_STRICT_FILE_BYTES } from "@/lib/strict-import/parse";
import { STRICT_TEMPLATE_STATUS, STRICT_TEMPLATE_VERSION } from "@/lib/strict-import/template";
import {
  runCommit,
  runPreview,
  StrictImportError,
  type ImportRpcResult,
  type StrictImportDeps,
} from "@/lib/strict-import/service";
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
    enabled: isStrictImportEnabled(process.env),
    hasImportRole: () => hasAnyRole(context, IMPORT_ROLES),
    findCustomers: async (norms) => {
      const out: { customer_name: string; normalized_name: string }[] = [];
      for (let i = 0; i < norms.length; i += 200) {
        const { data, error } = await supabase
          .from("customers")
          .select("customer_name, normalized_name")
          .in("normalized_name", norms.slice(i, i + 200));
        if (error) throw dbError(error, "strict-import.depsFor");
        out.push(...(data ?? []));
      }
      return out;
    },
    isFileImported: async (sha) => {
      const { data, error } = await supabase.from("import_batches").select("id").eq("file_sha256", sha).limit(1);
      if (error) return null; // e.g. SCRUM-103 migration not applied yet
      return (data ?? []).length > 0;
    },
    callImport: async (payload) => {
      const { data, error } = await supabase.rpc("import_transactions_batch", {
        ...payload,
        p_rows: payload.p_rows as unknown as Json,
        p_customer_names: payload.p_customer_names as unknown as Json,
      });
      if (error) throw dbError(error, "strict-import.depsFor");
      return data as unknown as ImportRpcResult;
    },
    loadXlsx: loadSheetJs,
  };
}

type Failure = { ok: false; code: StrictImportError["code"]; message: string; reasons: string[] };

function asFailure(e: unknown): Failure {
  if (e instanceof StrictImportError) return { ok: false, code: e.code, message: e.message, reasons: e.reasons };
  throw e;
}

const fileInput = z.object({
  filename: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1).max(MAX_BASE64, "File is larger than 5 MB"),
});

export const getStrictImportStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const deps = depsFor(context);
    return {
      enabled: deps.enabled,
      canImport: deps.enabled ? await deps.hasImportRole() : false,
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
      });
      return { ok: true as const, preview };
    } catch (e) {
      return asFailure(e);
    }
  });

export const commitStrictImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    fileInput
      .extend({
        expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
        warningsAcknowledged: z.boolean(),
        approvedNewCustomers: z.array(z.string().max(200)).max(5000),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    try {
      const result = await runCommit(depsFor(context), {
        filename: data.filename,
        bytes: base64ToBytes(data.contentBase64),
        expectedSha256: data.expectedSha256,
        warningsAcknowledged: data.warningsAcknowledged,
        approvedNewCustomers: data.approvedNewCustomers,
      });
      return { ok: true as const, result };
    } catch (e) {
      return asFailure(e);
    }
  });
