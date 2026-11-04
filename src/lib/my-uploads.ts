// SCRUM-131 (John, Option 2): "My uploads", a separate page OUTSIDE the approver gate. The
// signed-in user sees ONLY their own import stages and may cancel their own PENDING stage.
//
// Server calls (Chris's approval contract, SCRUM-131-PR.md "Approval, status and My uploads"):
//   - listImportStages({ scope: "mine" }) -> { stages, names, isApprover, userId }: the caller's own
//     stages, any status, newest first, READ-ONLY (no expire_import_stages; an overdue pending stage
//     reads as "expired"). Kept over listMyImportStages(): same ImportStage rows as the approver
//     pages (Chris kept it for this page in 3b4c8bf), so the row model and its tests stay as they are.
//   - cancelImport({ stageId }) -> { ok: true } | { ok: false, code: "forbidden" | "expired" |
//     "not_pending" | "db_error", message }: owner + pending + unexpired, checked by the server and
//     again by cancel_import() in the database.
// Gate: canUpload from getImportApprovalStatus() (uploaderFlagFrom below).
import type { ImportStage, StageStatus } from "@/lib/strict-import/approval";
import { STATUS_LABELS, statusVariant } from "@/lib/strict-import/approval-view";
import { stageDateOrderLine } from "@/lib/strict-import/date-order-view";
import { HEALER_RULES, type HealerRule } from "@/lib/strict-import/healer";
import type { HealerFixCounts } from "@/lib/strict-import/review";

export const MY_UPLOADS_PATH = "/my-uploads";

// ---------------------------------------------------------------------------
// Uploader flag (gate): getImportApprovalStatus().canUpload, the server's final flag (holds an
// import role: admin, ops_lead, ops_user). Unknown or failed status = false.
// ---------------------------------------------------------------------------
export function uploaderFlagFrom(status: { canUpload?: boolean } | null | undefined): boolean {
  return status?.canUpload === true;
}

export function isMyUploadsPath(pathname: string): boolean {
  return pathname === MY_UPLOADS_PATH || pathname.startsWith(`${MY_UPLOADS_PATH}/`);
}

// ---------------------------------------------------------------------------
// Server adapter
// ---------------------------------------------------------------------------
/** cancelImport failure codes (contract); any other code is shown with the server's message. */
export type CancelFailureCode = "forbidden" | "expired" | "not_pending" | "db_error";
export type CancelOutcome =
  | { ok: true }
  | { ok: false; code: CancelFailureCode | (string & {}); message: string };

export interface MyUploadsServer {
  /** The caller's own stages (any status), newest first. */
  listOwnStages(): Promise<{ stages: ImportStage[]; userId: string }>;
  /** Cancel the caller's own pending stage (the server enforces own + pending). */
  cancelOwnPending(stageId: string): Promise<CancelOutcome>;
}

/** Call shapes of Chris's server fns as the page receives them from useServerFn. */
export interface ChrisImportApprovalFns {
  listImportStages: (opts: { data: { scope: "mine" } }) => Promise<{
    stages: ImportStage[];
    userId: string;
    names?: Record<string, string>;
    isApprover?: boolean;
  }>;
  cancelImport: (opts: {
    data: { stageId: string };
  }) => Promise<{ ok: true } | { ok: false; code: string; message: string }>;
}

export function myUploadsServer(fns: ChrisImportApprovalFns): MyUploadsServer {
  return {
    async listOwnStages() {
      const res = await fns.listImportStages({ data: { scope: "mine" } });
      // The server already filters on uploaded_by; this keeps the page own-only even if a
      // future scope change returned more.
      return { userId: res.userId, stages: res.stages.filter((s) => s.uploaded_by === res.userId) };
    },
    async cancelOwnPending(stageId) {
      const res = await fns.cancelImport({ data: { stageId } });
      return res.ok ? { ok: true } : { ok: false, code: res.code, message: res.message };
    },
  };
}

/**
 * What the page does after a cancel: the toast text, and whether the list is reloaded. "expired" and
 * "not_pending" mean the row on screen is out of date, so the list is reloaded as well.
 */
export function cancelOutcomeView(
  res: CancelOutcome,
  filename: string,
): { ok: boolean; message: string; refresh: boolean } {
  if (res.ok) return { ok: true, message: `Upload cancelled: ${filename}`, refresh: true };
  switch (res.code) {
    case "forbidden":
      return { ok: false, message: "You can only cancel your own uploads.", refresh: false };
    case "expired":
      return {
        ok: false,
        message: `${filename} has already expired, so there is nothing to cancel. The list is refreshed.`,
        refresh: true,
      };
    case "not_pending":
      return {
        ok: false,
        message: `${filename} is no longer waiting for sign-off (it was approved, rejected or cancelled). The list is refreshed.`,
        refresh: true,
      };
    case "db_error":
      return {
        ok: false,
        message: "Could not cancel the upload because of a database error. Try again in a moment.",
        refresh: false,
      };
    default:
      return { ok: false, message: res.message || "Could not cancel the upload.", refresh: false };
  }
}

/**
 * Load on open, Refresh button, and after a cancel. The "mine" list is read-only now, but the page
 * still does not poll: a manual Refresh is enough for one's own uploads.
 */
export const MY_UPLOADS_QUERY_OPTIONS = {
  queryKey: ["my-uploads"] as const,
  refetchInterval: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: 30_000,
} as const;

// ---------------------------------------------------------------------------
// Row view model
// ---------------------------------------------------------------------------
export interface MyUploadRow {
  id: string;
  filename: string;
  status: StageStatus;
  statusLabel: string;
  statusVariant: ReturnType<typeof statusVariant>;
  rows: number;
  privateRows: number;
  publicRows: number;
  incompleteRows: number;
  healer: HealerFixCounts;
  /** "695 fixes: 684 dates · 11 names", or "No fixes". */
  healerSummary: string;
  /** SCRUM-131 date fix F1: "Dates read as DD-MM-YYYY (your choice; …)" when the uploader picked it; else null. */
  dateOrderNote: string | null;
  submittedAt: string;
  /** Shown while waiting for sign-off. */
  expiresAt: string | null;
  /** Extra line under the status, e.g. for Expired: what happened and what to do. */
  statusNote: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  /** Import batch id once the stage is approved and imported. */
  batchId: string | null;
  canCancel: boolean;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Healer counts from summary.fixed_by_rule. Contract: every stage row carries all six HEALER_RULES
 * keys (0 when unused), recomputed by the database from import_corrections (070900), so the total is
 * their sum (= correction_count). A missing key reads as 0.
 */
export function stageHealerCounts(stage: Pick<ImportStage, "summary">): HealerFixCounts {
  const raw = stage.summary?.fixed_by_rule;
  const by = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<
    Record<HealerRule, unknown>
  >;
  const n = (rule: HealerRule) => num(by[rule]);
  return {
    healerFixCount: HEALER_RULES.reduce((sum, rule) => sum + n(rule), 0),
    dateFixes: n("date.reorder_to_iso"),
    nameFixes: n("customer.match_existing"),
    providerFixes: n("provider.alias"),
    priceFixes: n("price.blank_to_zero") + n("price.invalid_to_zero"),
    textFixes: n("text.trim"),
  };
}

export function healerSummaryText(c: HealerFixCounts): string {
  if (c.healerFixCount === 0) return "No fixes";
  const parts = [
    [c.dateFixes, "date", "dates"],
    [c.nameFixes, "name", "names"],
    [c.providerFixes, "provider", "providers"],
    [c.priceFixes, "price", "prices"],
    [c.textFixes, "spacing", "spacing"],
  ] as const;
  const detail = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(" · ");
  const head = `${c.healerFixCount} ${c.healerFixCount === 1 ? "fix" : "fixes"}`;
  return detail ? `${head}: ${detail}` : head;
}

/**
 * A pending stage past its expiry is shown as Expired. The server already returns "expired" for
 * these on the "mine" list; this keeps the row right if the page stays open past the expiry.
 */
function effectiveStatus(
  stage: Pick<ImportStage, "status" | "expires_at">,
  nowMs: number,
): StageStatus {
  if (stage.status === "pending" && Date.parse(stage.expires_at) < nowMs) return "expired";
  return stage.status;
}

export const EXPIRED_NOTE =
  "Nobody signed it off in time, so nothing was saved. Upload the file again to resend it.";

export function myUploadRow(stage: ImportStage, userId: string, nowMs: number): MyUploadRow {
  const status = effectiveStatus(stage, nowMs);
  const healer = stageHealerCounts(stage);
  return {
    id: stage.id,
    filename: stage.filename,
    status,
    statusLabel: STATUS_LABELS[status],
    statusVariant: statusVariant(status),
    rows: stage.row_count,
    privateRows: stage.private_count,
    publicRows: stage.public_count,
    incompleteRows: stage.incomplete_count,
    healer,
    healerSummary: healerSummaryText(healer),
    dateOrderNote: stageDateOrderLine(stage.summary, "you"),
    submittedAt: stage.uploaded_at,
    expiresAt: status === "pending" ? stage.expires_at : null,
    statusNote: status === "expired" ? EXPIRED_NOTE : null,
    decidedAt: stage.decided_at,
    decisionReason: stage.decision_reason,
    batchId:
      status === "committed" || status === "approved" ? (stage.committed_batch_id ?? null) : null,
    canCancel: stage.uploaded_by === userId && status === "pending",
  };
}

// ---------------------------------------------------------------------------
// Post-submit link (Bulk Upload confirmation)
// ---------------------------------------------------------------------------
export type PostSubmitLink =
  | { to: "/import-approvals/$stageId"; params: { stageId: string }; label: string }
  | { to: "/my-uploads"; label: string };

/** Approvers open the sign-off view; everyone else goes to My uploads (they cannot reach it). */
export function postSubmitLink(isApprover: boolean, stageId: string): PostSubmitLink {
  return isApprover
    ? { to: "/import-approvals/$stageId", params: { stageId }, label: "Open in Import approvals" }
    : { to: "/my-uploads", label: "Open My uploads" };
}
