// SCRUM-131: Chief's sign-off API: the pending-approvals queue, the sign-off detail (Healer report),
// approve / reject, the read-only status for the nav badge, and in-app notifications.
// Queue, detail, approve and reject are for APPROVERS ONLY, by membership (is_import_approver), whatever the
// role (John 07:06/07:07). The caller's own uploads ("My uploads": list + cancel) are open to every uploader:
// listImportStages({scope:"mine"}) + cancelImport here (Peter's page), or listMyImportStages /
// cancelMyImportStage in my-imports.functions.ts (same logic).
// Enforced here AND in the database (approve_import / reject_import / cancel_import are SECURITY
// DEFINER and repeat every check; see src/lib/strict-import/approval.ts). All calls use the caller's
// own session, so RLS decides what each user can see.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "@/lib/app-error";
import { ApprovalError, runApprove, runReject, type ImportStage } from "@/lib/strict-import/approval";
import {
  ApprovalQueryError,
  approvalDepsFor,
  cancelMyStage,
  getApprovalStageDetail,
  listApprovalQueue,
  listOwnStagesForMine,
  readImportApprovalStatus,
  type CorrectionView,
  type ImportApprovalStatus,
  type StageRowView,
} from "@/lib/strict-import/approval-queries";
import { untyped } from "@/lib/strict-import/db-client";

type Ctx = { supabase: unknown; userId: string };

type Failure = { ok: false; code: ApprovalError["code"]; message: string };
function asFailure(e: unknown): Failure {
  if (e instanceof ApprovalError) return { ok: false, code: e.code, message: e.message };
  if (e instanceof ApprovalQueryError) throw dbError(e.dbError, `import-approvals.${e.where}`);
  throw e;
}

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const stageId = z.string().uuid();
const reason = z.string().max(1000).optional().nullable();

/**
 * Nav badge + gates. READ-ONLY (never runs expire_import_stages): `isApprover` (approver list, any role),
 * `canUpload` (import role; gates "My uploads"), `pendingCount` (pending and not past expiry; 0 for
 * non-approvers), `unreadNotifications`.
 */
export const getImportApprovalStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ImportApprovalStatus> => {
    const ctx = context as unknown as Ctx;
    try {
      return await readImportApprovalStatus(untyped(ctx.supabase), ctx.userId);
    } catch (e) {
      if (e instanceof ApprovalQueryError) throw dbError(e.dbError, `import-approvals.${e.where}`);
      throw e;
    }
  });

/**
 * One shape for every scope (the pre-membership contract Peter's pages use): { stages, names, isApprover, userId }.
 * scope "pending" | "recent": the queue, approvers only (by membership); runs the lazy expiry on page open.
 *   A non-approver gets { stages: [], names: {}, isApprover: false } (nothing is read).
 * scope "mine": the caller's own uploads (My uploads), any signed-in user, READ-ONLY (no expiry write; an
 *   overdue pending stage reads as "expired"). Rows are ImportStage (STAGE_COLUMNS, incl. summary.fixed_by_rule).
 * A database error throws (the friendly SCRUM-96 message), as before.
 */
export const listImportStages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ scope: z.enum(["pending", "mine", "recent"]).default("pending") }).parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<ImportStageList> => {
    const ctx = context as unknown as Ctx;
    const db = untyped(ctx.supabase);
    try {
      if (data.scope === "mine") return await listOwnStagesForMine(db, ctx.userId);
      return await listApprovalQueue(db, ctx.userId, data.scope);
    } catch (e) {
      if (e instanceof ApprovalError && e.code === "forbidden") return { stages: [], names: {}, isApprover: false, userId: ctx.userId };
      if (e instanceof ApprovalQueryError) throw dbError(e.dbError, `import-approvals.${e.where}`);
      throw e;
    }
  });

export interface ImportStageList {
  stages: ImportStage[];
  names: Record<string, string>;
  isApprover: boolean;
  userId: string;
}

export type { StageRowView, CorrectionView };

/** The sign-off detail (approvers only): stage header, Healer corrections (fixed), staged rows with warnings (flagged). */
export const getImportStage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: stageId }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    try {
      return await getApprovalStageDetail(untyped(ctx.supabase), ctx.userId, data.id);
    } catch (e) {
      return asFailure(e);
    }
  });

export const approveImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ stageId, fileSha256: sha, rowsSha256: sha, reason }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    try {
      const result = await runApprove(approvalDepsFor(untyped(ctx.supabase), ctx.userId), data);
      return { ok: true as const, result };
    } catch (e) {
      return asFailure(e);
    }
  });

export const rejectImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ stageId, reason }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    try {
      await runReject(approvalDepsFor(untyped(ctx.supabase), ctx.userId), data);
      return { ok: true as const };
    } catch (e) {
      return asFailure(e);
    }
  });

/**
 * Cancel the caller's OWN PENDING upload (Peter's My uploads page). Any uploader, approver or not: owner only,
 * pending and unexpired only, checked here (cancelMyStage) and again by cancel_import() in the database.
 * Returns { ok: true } or { ok: false, code: "forbidden" | "expired" | "not_pending" | "db_error", message }.
 * cancelMyImportStage (my-imports.functions.ts) is the same call under the My-uploads name.
 */
export const cancelImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ stageId }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    try {
      await cancelMyStage(untyped(ctx.supabase), ctx.userId, data.stageId);
      return { ok: true as const };
    } catch (e) {
      return asFailure(e);
    }
  });

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

/** In-app notifications (approved channel). */
export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data, error } = await untyped(ctx.supabase)
      .from<NotificationView[]>("user_notifications")
      .select("id, kind, title, body, link, created_at, read_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw dbError(error, "import-approvals.notifications");
    return (data ?? []) as NotificationView[];
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid().optional() }).parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const db = untyped(ctx.supabase);
    const { error } = data.id ? await db.rpc("mark_notification_read", { p_id: data.id }) : await db.rpc("mark_all_notifications_read");
    if (error) throw dbError(error, "import-approvals.markRead");
    return { ok: true as const };
  });
