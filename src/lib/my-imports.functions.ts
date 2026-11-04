// SCRUM-131 (John, Option 2, 07:07): "My uploads" - a separate page OUTSIDE the approver gate. The caller sees
// only their OWN staged uploads (read-only; no expiry write, an overdue pending stage reads as "expired") and
// may cancel their own PENDING upload. No approve/reject here. Logic: src/lib/strict-import/approval-queries.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "@/lib/app-error";
import { ApprovalError } from "@/lib/strict-import/approval";
import { ApprovalQueryError, cancelMyStage, listMyStages, type MyImportStage } from "@/lib/strict-import/approval-queries";
import { untyped } from "@/lib/strict-import/db-client";

type Ctx = { supabase: unknown; userId: string };

export type { MyImportStage };

/** The caller's own uploads, newest first (max 100). READ-ONLY. */
export const listMyImportStages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyImportStage[]> => {
    const ctx = context as unknown as Ctx;
    try {
      return await listMyStages(untyped(ctx.supabase), ctx.userId);
    } catch (e) {
      if (e instanceof ApprovalQueryError) throw dbError(e.dbError, `my-imports.${e.where}`);
      throw e;
    }
  });

/** Cancel the caller's own pending upload (owner only, pending and unexpired only; the DB checks again). */
export const cancelMyImportStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ stageId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    try {
      await cancelMyStage(untyped(ctx.supabase), ctx.userId, data.stageId);
      return { ok: true as const };
    } catch (e) {
      if (e instanceof ApprovalError) return { ok: false as const, code: e.code, message: e.message };
      if (e instanceof ApprovalQueryError) throw dbError(e.dbError, `my-imports.${e.where}`);
      throw e;
    }
  });
