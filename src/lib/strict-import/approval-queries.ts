// SCRUM-131: the data side of the sign-off screens and of "My uploads", on the caller's OWN Supabase
// session (RLS and every SECURITY DEFINER check apply). The server functions in
// src/lib/import-approvals.functions.ts (approvers only) and src/lib/my-imports.functions.ts (the caller's own
// uploads) are thin wrappers around these, so the rules are tested against the real database in PGlite.
//
// Access rules (John, 07:06 / 07:07):
//  - Import approvals (queue, stage detail, approve, reject): approver MEMBERSHIP only
//    (is_import_approver: on the approver list and active). Role plays no part: a leadership-only approver
//    is allowed; an admin who is not on the list is refused.
//  - My uploads (a separate page outside the approver gate): the caller's OWN stages only, read-only, and
//    cancel of the caller's own PENDING, unexpired stage.
//  - Badge/status: read-only. Nothing on the status or My-uploads read path writes (no expire_import_stages);
//    a pending stage past expires_at is reported as expired in the read. Lazy expiry (the write) stays on
//    the write/open paths: submit (stage_import), queue load, stage open, approve.
import { ApprovalError, type ApprovalDeps, type ImportStage, type StageStatus } from "./approval";
import type { DbError, UntypedDb } from "./db-client";
import type { ImportRpcResult } from "./service";
import type { Json } from "@/integrations/supabase/types";

export const IMPORT_ROLES = ["admin", "ops_lead", "ops_user"] as const;

export const STAGE_COLUMNS =
  "id, status, kind, filename, file_sha256, rows_sha256, template_version, healer_version, row_count, warning_row_count, " +
  "correction_count, private_count, public_count, incomplete_count, incomplete_selling, incomplete_input, total_users, " +
  "total_selling, total_input, summary, repeat_of, repeat_acknowledged_by, repeat_acknowledged_at, uploaded_by, uploaded_at, " +
  "expires_at, decided_by, decided_at, decision_reason, committed_batch_id";

/** Thrown for unexpected database errors; the server function wrapper turns it into a logged, friendly error. */
export class ApprovalQueryError extends Error {
  constructor(
    public readonly where: string,
    public readonly dbError: DbError,
  ) {
    super(`${where}: ${dbError.message}`);
    this.name = "ApprovalQueryError";
  }
}

function check<T>(res: { data: T | null; error: DbError | null }, where: string): T | null {
  if (res.error) throw new ApprovalQueryError(where, res.error);
  return res.data;
}

export async function isImportApprover(db: UntypedDb, userId: string): Promise<boolean> {
  return check(await db.rpc<boolean>("is_import_approver", { p_uid: userId }), "isApprover") === true;
}

async function requireApprover(db: UntypedDb, userId: string): Promise<void> {
  if (!(await isImportApprover(db, userId))) {
    throw new ApprovalError("Import approvals are for import approvers only.", "forbidden");
  }
}

/** Lazy expiry (no cron job). A WRITE: only on the open/write paths, never on the badge or My uploads read. */
async function expireStale(db: UntypedDb): Promise<void> {
  check(await db.rpc("expire_import_stages"), "expire");
}

// ---------------------------------------------------------------------------------------------------------
// Status (nav badge + gates). READ-ONLY.

export interface ImportApprovalStatus {
  /** On the import approver list (and active), whatever the role. Gates the Import approvals nav item and routes. */
  isApprover: boolean;
  /** Holds an import role (admin, ops_lead, ops_user), i.e. may submit files. Gates "My uploads". */
  canUpload: boolean;
  /** Imports waiting for sign-off (pending and not past expires_at). 0 for non-approvers. */
  pendingCount: number;
  /** The caller's unread in-app notifications. */
  unreadNotifications: number;
}

/**
 * ONE round trip: import_approval_status() (migration 20261006070700), a STABLE SECURITY DEFINER function.
 * No INSERT/UPDATE/DELETE and no expire_import_stages on this path (tested in a READ ONLY transaction). The
 * SCRUM-128 sidebar calls it for every signed-in user about once a minute.
 */
export async function readImportApprovalStatus(db: UntypedDb, _userId?: string): Promise<ImportApprovalStatus> {
  const raw = check(
    await db.rpc<{ is_approver?: boolean; can_upload?: boolean; pending_count?: number; unread_notifications?: number }>("import_approval_status"),
    "status",
  );
  return {
    isApprover: raw?.is_approver === true,
    canUpload: raw?.can_upload === true,
    pendingCount: raw?.pending_count ?? 0,
    unreadNotifications: raw?.unread_notifications ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Import approvals (approvers only).

export type QueueScope = "pending" | "recent";

/** The queue: pending imports, or the 100 most recent of any status. Approvers only. */
export async function listApprovalQueue(db: UntypedDb, userId: string, scope: QueueScope) {
  await requireApprover(db, userId);
  await expireStale(db);
  let q = db.from<ImportStage[]>("import_stages").select(STAGE_COLUMNS);
  if (scope === "pending") q = q.eq("status", "pending");
  const stages = (check(await q.order("uploaded_at", { ascending: false }).limit(100), "queue.list") ?? []) as ImportStage[];
  const names = stages.length > 0 ? await stagePeople(db, stages.map((s) => s.id)) : {};
  return { stages, names, isApprover: true as const, userId };
}

export async function getStage(db: UntypedDb, id: string): Promise<ImportStage | null> {
  const data = check(await db.from<ImportStage[]>("import_stages").select(STAGE_COLUMNS).eq("id", id).maybeSingle(), "getStage");
  return (data as ImportStage | null) ?? null;
}

export interface StageRowView {
  source_line: number;
  healed: { [key: string]: Json | undefined };
  original: Record<string, string>;
  warnings: string[];
  is_incomplete: boolean;
}

export interface CorrectionView {
  source_line: number;
  field: string;
  rule: string;
  original_value: string | null;
  healed_value: string;
  healer_version: string;
  transaction_id: string | null;
}

/** The sign-off detail. Approvers only (an admin who is not on the list is refused, although RLS lets admins read). */
export async function getApprovalStageDetail(db: UntypedDb, userId: string, id: string, nowMs: number = Date.now()) {
  await requireApprover(db, userId);
  await expireStale(db);
  const stage = await getStage(db, id);
  if (!stage) return { ok: false as const, message: "Import not found." };
  // QC S5: PostgREST caps every read at db-max-rows (1000 on Supabase), so read in pages of 1000 on a unique order.
  const [rows, corrections] = await Promise.all([
    readAllPages<StageRowView>("detail.rows", (from, to) =>
      db
        .from<StageRowView[]>("import_stage_rows")
        .select("source_line, healed, original, warnings, is_incomplete")
        .eq("stage_id", id)
        .order("source_line", { ascending: true })
        .range(from, to),
    ),
    readAllPages<CorrectionView>("detail.corrections", (from, to) =>
      db
        .from<CorrectionView[]>("import_corrections")
        .select("source_line, field, rule, original_value, healed_value, healer_version, transaction_id")
        .eq("stage_id", id)
        .order("source_line", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  const names = await stagePeople(db, [stage.id]);
  const uploaderName = names[stage.uploaded_by] ?? null;
  const isUploader = stage.uploaded_by === userId;
  return {
    ok: true as const,
    stage,
    rows,
    corrections,
    /** Display name of the uploader (profiles), for the repeat-file acknowledgement line; null when unknown. */
    uploaderName,
    isApprover: true as const,
    isUploader,
    // No self-approval: the uploader never decides (the server and the database refuse it too).
    canDecide: !isUploader && stage.status === "pending" && Date.parse(stage.expires_at) >= nowMs,
  };
}

/**
 * Display names of the people on these stages (uploader, decider, repeat acknowledgement), via
 * import_stage_people (20261006071100): profiles is own-row/admin only, so a leadership approver could not read them.
 * Names are display only; a failure gives {} (the screens fall back to "the uploader" / the id).
 */
export async function stagePeople(db: UntypedDb, stageIds: string[]): Promise<Record<string, string>> {
  const { data, error } = await db.rpc<Record<string, string>>("import_stage_people", { p_stage_ids: stageIds });
  return error || !data || typeof data !== "object" ? {} : data;
}

/** Page size of the sign-off reads: PostgREST's db-max-rows on Supabase. */
export const DETAIL_PAGE = 1000;
/** Upper bound on pages (5,000 rows; corrections can be several per row). */
const DETAIL_MAX_PAGES = 200;

/** Reads every row of a query in pages of DETAIL_PAGE (the query must have a unique order). */
export async function readAllPages<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < DETAIL_MAX_PAGES; p++) {
    const from = p * DETAIL_PAGE;
    const res = await page(from, from + DETAIL_PAGE - 1);
    const chunk = (check(res, label) ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < DETAIL_PAGE) return out;
  }
  throw new ApprovalQueryError(label, { message: `more than ${DETAIL_PAGE * DETAIL_MAX_PAGES} records` });
}

/** approve / reject: runApprove / runReject check membership (isApprover) and every stage rule; the DB repeats them. */
export function approvalDepsFor(db: UntypedDb, userId: string, now: () => number = Date.now): ApprovalDeps {
  return {
    userId,
    isApprover: () => isImportApprover(db, userId),
    getStage: (id) => getStage(db, id),
    approve: async ({ stageId, fileSha256, rowsSha256, reason }) => {
      const { data, error } = await db.rpc<ImportRpcResult & { stage_id: string }>("approve_import", {
        p_stage_id: stageId,
        p_file_sha256: fileSha256,
        p_rows_sha256: rowsSha256,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("approve_import returned nothing");
      return data;
    },
    reject: async ({ stageId, reason }) => {
      const { error } = await db.rpc("reject_import", { p_stage_id: stageId, p_reason: reason });
      if (error) throw new Error(error.message);
    },
    cancel: async (stageId) => {
      const { error } = await db.rpc("cancel_import", { p_stage_id: stageId });
      if (error) throw new Error(error.message);
    },
    now,
  };
}

// ---------------------------------------------------------------------------------------------------------
// My uploads (the caller's own stages). READ-ONLY list + owner-only cancel.

export interface MyImportStage {
  id: string;
  filename: string;
  /** As stored, except a pending stage past expires_at reads as "expired" (computed in the read; nothing written). */
  status: StageStatus;
  uploadedAt: string;
  expiresAt: string;
  rowCount: number;
  privateRows: number;
  publicRows: number;
  incompleteRows: number;
  warningRows: number;
  /** Healer fixes on this upload (= import_corrections rows). */
  healerFixCount: number;
  /** Healer fixes per rule, e.g. { "date.reorder_to_iso": 684, "customer.match_existing": 11 }. */
  healerFixesByRule: Record<string, number>;
  repeatOf: { [key: string]: Json | undefined } | null;
  repeatAcknowledgedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  committedBatchId: string | null;
  /** Pending and not past expires_at: the owner may cancel it. */
  canCancel: boolean;
}

const MY_STAGE_COLUMNS =
  "id, filename, status, uploaded_at, expires_at, row_count, private_count, public_count, incomplete_count, warning_row_count, " +
  "correction_count, summary, repeat_of, repeat_acknowledged_at, decided_at, decision_reason, committed_batch_id";

type MyStageRow = Pick<
  ImportStage,
  | "id"
  | "filename"
  | "status"
  | "uploaded_at"
  | "expires_at"
  | "row_count"
  | "private_count"
  | "public_count"
  | "incomplete_count"
  | "warning_row_count"
  | "correction_count"
  | "summary"
  | "repeat_of"
  | "repeat_acknowledged_at"
  | "decided_at"
  | "decision_reason"
  | "committed_batch_id"
>;

/** A pending stage past its expiry is expired, whether or not the lazy expiry has written it yet. */
export function effectiveStatus(s: { status: StageStatus; expires_at: string }, nowMs: number): StageStatus {
  return s.status === "pending" && Date.parse(s.expires_at) < nowMs ? "expired" : s.status;
}

function fixesByRule(summary: MyStageRow["summary"]): Record<string, number> {
  const raw = summary?.fixed_by_rule;
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && v > 0) out[k] = v;
  }
  return out;
}

/** The caller's own uploads, newest first (max 100). READ-ONLY: no expire_import_stages, no write of any kind. */
export async function listMyStages(db: UntypedDb, userId: string, nowMs: number = Date.now()): Promise<MyImportStage[]> {
  const rows = (check(
    await db.from<MyStageRow[]>("import_stages").select(MY_STAGE_COLUMNS).eq("uploaded_by", userId).order("uploaded_at", { ascending: false }).limit(100),
    "mine.list",
  ) ?? []) as MyStageRow[];
  return rows.map((r) => {
    const status = effectiveStatus(r, nowMs);
    return {
      id: r.id,
      filename: r.filename,
      status,
      uploadedAt: r.uploaded_at,
      expiresAt: r.expires_at,
      rowCount: r.row_count,
      privateRows: r.private_count,
      publicRows: r.public_count,
      incompleteRows: r.incomplete_count,
      warningRows: r.warning_row_count,
      healerFixCount: r.correction_count,
      healerFixesByRule: fixesByRule(r.summary),
      repeatOf: r.repeat_of,
      repeatAcknowledgedAt: r.repeat_acknowledged_at ?? null,
      decidedAt: r.decided_at,
      decisionReason: r.decision_reason,
      committedBatchId: r.committed_batch_id,
      canCancel: status === "pending",
    };
  });
}

/**
 * Peter's My uploads page (95292f4) contract: listImportStages({scope:"mine"}) -> { stages, names, isApprover,
 * userId } with ImportStage rows (STAGE_COLUMNS, incl. summary.fixed_by_rule). The caller's OWN stages only, any
 * status, newest first (max 100). READ-ONLY: no expire_import_stages; an overdue pending stage reads as "expired".
 * Open to every signed-in user (no approver check); RLS limits the rows to the caller's own as well.
 */
export async function listOwnStagesForMine(db: UntypedDb, userId: string, nowMs: number = Date.now()) {
  const rows = (check(
    await db.from<ImportStage[]>("import_stages").select(STAGE_COLUMNS).eq("uploaded_by", userId).order("uploaded_at", { ascending: false }).limit(100),
    "mine.stages",
  ) ?? []) as ImportStage[];
  const stages = rows.map((s) => ({ ...s, status: effectiveStatus(s, nowMs) }));
  const names = stages.length > 0 ? await stagePeople(db, stages.map((s) => s.id)) : {};
  return { stages, names, isApprover: await isImportApprover(db, userId), userId };
}

/** Cancel the caller's OWN PENDING (unexpired) upload. Checked here; cancel_import() checks owner + pending again. */
export async function cancelMyStage(db: UntypedDb, userId: string, stageId: string, nowMs: number = Date.now()): Promise<void> {
  const own = check(
    await db.from<MyStageRow[]>("import_stages").select("id, status, expires_at").eq("id", stageId).eq("uploaded_by", userId).maybeSingle(),
    "mine.get",
  ) as Pick<MyStageRow, "id" | "status" | "expires_at"> | null;
  if (!own) throw new ApprovalError("Only your own upload can be cancelled.", "forbidden");
  const status = effectiveStatus(own, nowMs);
  if (status === "expired") throw new ApprovalError("This upload has expired; there is nothing to cancel.", "expired");
  if (status !== "pending") throw new ApprovalError(`This upload is ${status}, not pending, so it cannot be cancelled.`, "not_pending");
  const { error } = await db.rpc("cancel_import", { p_stage_id: stageId });
  if (error) throw new ApprovalError(`Cancel failed: ${error.message}`, "db_error");
}
