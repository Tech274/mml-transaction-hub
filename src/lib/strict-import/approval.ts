// SCRUM-131: Chief's sign-off on staged imports. Pure logic with every outside dependency passed in,
// so the rules are unit-tested without a database. The server functions in
// src/lib/import-approvals.functions.ts are thin wrappers.
//
// Enforcement is in TWO places:
//  1. here (API): only an approver may approve or reject; never their own upload; only a pending,
//     unexpired stage; the hashes the approver saw must be sent back; and
//  2. in the database (authoritative): approve_import() / reject_import() / cancel_import() are
//     SECURITY DEFINER and repeat every check; import_transactions_batch() is no longer executable by
//     any client role; commit_import() only runs inside approve_import(); import_stages has a CHECK
//     that decided_by <> uploaded_by. A bug or bypass here still cannot commit an import.
import type { Json } from "@/integrations/supabase/types";
import type { BatchKind } from "./validate";
import { toCentsExact, type ImportRpcResult } from "./service";

export type StageStatus = "pending" | "approved" | "committed" | "rejected" | "expired";

export interface ImportStage {
  id: string;
  status: StageStatus;
  kind: BatchKind;
  filename: string;
  file_sha256: string;
  rows_sha256: string;
  template_version: string;
  healer_version: string;
  row_count: number;
  warning_row_count: number;
  correction_count: number;
  private_count: number;
  public_count: number;
  incomplete_count: number;
  incomplete_selling: number | string;
  incomplete_input: number | string;
  total_users: number;
  total_selling: number | string;
  total_input: number | string;
  summary: { [key: string]: Json | undefined };
  repeat_of: { [key: string]: Json | undefined } | null;
  /** SCRUM-131 (070600): the uploader acknowledged the repeat-file warning ("Submit anyway"): who and when. */
  repeat_acknowledged_by?: string | null;
  repeat_acknowledged_at?: string | null;
  uploaded_by: string;
  uploaded_at: string;
  expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  committed_batch_id: string | null;
}

export interface ApprovalDeps {
  userId: string;
  isApprover: () => Promise<boolean>;
  getStage: (id: string) => Promise<ImportStage | null>;
  approve: (args: { stageId: string; fileSha256: string; rowsSha256: string; reason: string | null }) => Promise<ImportRpcResult & { stage_id?: string }>;
  reject: (args: { stageId: string; reason: string | null }) => Promise<void>;
  cancel: (stageId: string) => Promise<void>;
  /** Injected clock (ms) so expiry is testable; defaults to Date.now in the server wrapper. */
  now: () => number;
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    public readonly code: "forbidden" | "self_approval" | "not_found" | "not_pending" | "expired" | "changed" | "db_error" | "reconcile",
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

export const REASON_MAX = 1000;

function checkPendingFor(stage: ImportStage | null, deps: ApprovalDeps, action: "approve" | "reject"): ImportStage {
  if (!stage) throw new ApprovalError("Import not found (or you cannot see it).", "not_found");
  if (stage.uploaded_by === deps.userId) {
    throw new ApprovalError(
      action === "approve" ? "You cannot approve your own upload. Another approver must sign it off." : "You cannot reject your own upload. Cancel it instead.",
      "self_approval",
    );
  }
  if (stage.status === "pending" && Date.parse(stage.expires_at) < deps.now()) {
    throw new ApprovalError(`This import expired on ${stage.expires_at}. Ask the uploader to submit the file again.`, "expired");
  }
  if (stage.status !== "pending") throw new ApprovalError(`This import is ${stage.status}, not pending.`, "not_pending");
  return stage;
}

export interface ApproveInput {
  stageId: string;
  fileSha256: string;
  rowsSha256: string;
  reason?: string | null;
}

export interface ApproveResult {
  stageId: string;
  batchId: string;
  inserted: number;
  kind: BatchKind;
  privateRows: number;
  publicRows: number;
  totalSellingCents: number;
  totalInputCents: number;
}

/** Approve = commit, in one DB transaction. Reconciles the result with the stage the approver saw. */
export async function runApprove(deps: ApprovalDeps, input: ApproveInput): Promise<ApproveResult> {
  if (!(await deps.isApprover())) throw new ApprovalError("Only an import approver (Chief) can approve imports.", "forbidden");
  const stage = checkPendingFor(await deps.getStage(input.stageId), deps, "approve");
  if (stage.file_sha256 !== input.fileSha256 || stage.rows_sha256 !== input.rowsSha256) {
    throw new ApprovalError("This import changed since you opened it. Reload and review it again.", "changed");
  }
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, REASON_MAX) : null;
  let res: ImportRpcResult & { stage_id?: string };
  try {
    res = await deps.approve({ stageId: stage.id, fileSha256: input.fileSha256, rowsSha256: input.rowsSha256, reason });
  } catch (e) {
    throw new ApprovalError(`Approval failed, nothing was imported: ${(e as Error).message}`, "db_error");
  }
  const result: ApproveResult = {
    stageId: stage.id,
    batchId: res.batch_id,
    inserted: res.inserted,
    kind: (res.kind ?? stage.kind) as BatchKind,
    privateRows: res.private_rows ?? -1,
    publicRows: res.public_rows ?? -1,
    totalSellingCents: toCentsExact(res.total_selling),
    totalInputCents: toCentsExact(res.total_input),
  };
  if (
    result.inserted !== stage.row_count ||
    result.kind !== stage.kind ||
    result.privateRows !== stage.private_count ||
    result.publicRows !== stage.public_count ||
    result.totalSellingCents !== toCentsExact(stage.total_selling) ||
    result.totalInputCents !== toCentsExact(stage.total_input)
  ) {
    // Should be impossible: commit_import() reconciles inside the same transaction and rolls back.
    throw new ApprovalError(
      `Approved import ${stage.id} stored something different from what was approved (batch ${result.batchId}). Contact engineering.`,
      "reconcile",
    );
  }
  return result;
}

export async function runReject(deps: ApprovalDeps, input: { stageId: string; reason?: string | null }): Promise<void> {
  if (!(await deps.isApprover())) throw new ApprovalError("Only an import approver (Chief) can reject imports.", "forbidden");
  checkPendingFor(await deps.getStage(input.stageId), deps, "reject");
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, REASON_MAX) : null;
  try {
    await deps.reject({ stageId: input.stageId, reason });
  } catch (e) {
    throw new ApprovalError(`Reject failed: ${(e as Error).message}`, "db_error");
  }
}

/** The uploader withdraws their own pending upload (nothing is left behind). */
export async function runCancel(deps: ApprovalDeps, stageId: string): Promise<void> {
  const stage = await deps.getStage(stageId);
  if (!stage) throw new ApprovalError("Import not found (or you cannot see it).", "not_found");
  if (stage.uploaded_by !== deps.userId) throw new ApprovalError("Only the uploader can cancel an upload.", "forbidden");
  if (stage.status !== "pending") throw new ApprovalError(`This import is ${stage.status}, not pending.`, "not_pending");
  try {
    await deps.cancel(stageId);
  } catch (e) {
    throw new ApprovalError(`Cancel failed: ${(e as Error).message}`, "db_error");
  }
}

/** "expires in 6d 23h" / "expired". Pure, for the queue card. */
export function expiresIn(expiresAt: string, nowMs: number): string {
  const ms = Date.parse(expiresAt) - nowMs;
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `expires in ${d}d ${h % 24}h` : `expires in ${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}
