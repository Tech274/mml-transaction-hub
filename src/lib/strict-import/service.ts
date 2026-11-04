// SCRUM-103: preview and commit logic for the strict importer, with every
// outside dependency passed in. The server functions in
// src/lib/strict-import.functions.ts are thin wrappers around these, so the
// rules are unit-tested without a database.
//
// The server never trusts the browser's preview: submit receives the exact
// file bytes again, checks they hash to the previewed SHA-256, and re-runs
// parse -> Healer -> validate before staging (SCRUM-131). Nothing is written to
// transactions until an approver signs off (approval.ts, approve_import()).
import { parseStrictBytes, type XlsxLike } from "./parse";
import { providerCloudType } from "@/lib/cloud-provider";
import { type BatchKind, type ProviderRowInfo, type RowIssue, type StrictSummary } from "./validate";
import { STRICT_TEMPLATE_STATUS, STRICT_TEMPLATE_VERSION } from "./template";
import { sha256Hex } from "./hash";
import { AppError, dbError, logError } from "@/lib/app-error";
import { planCustomers, type CustomerPlan, type ExistingCustomer, type PriorImport, type RpcRow } from "./commit-plan";
import { HEALER_VERSION, type ChosenDateOrder, type DateOrderReport } from "./healer";
import {
  healerFixCounts,
  healerFixesOf,
  providerRowsOf,
  reviewImport,
  stageCorrections,
  stageSummaryOf,
  type HealerFix,
  type HealerFixCounts,
  type HealerReport,
  type ImportReview,
  type ReviewSummary,
  type StagedRow,
} from "./review";

/** @deprecated SCRUM-131: the server no longer calls import_transactions_batch; commit happens only on approval. */
export interface ImportRpcPayload {
  /** SCRUM-129: file summary derived from the rows (private_cloud / public_cloud / mixed). Never a literal or default. */
  p_kind: BatchKind;
  p_filename: string;
  p_file_sha256: string;
  p_template_version: string;
  p_rows: RpcRow[];
  p_customer_names: string[];
}

/** What import_transactions_batch returns (now only through approve_import -> commit_import). */
export interface ImportRpcResult {
  batch_id: string;
  inserted: number;
  /** SCRUM-129 (20261006061000): echoed by the DB. Absent only on the pre-SCRUM-129 function. */
  kind?: BatchKind;
  private_rows?: number;
  public_rows?: number;
  total_selling: number | string;
  total_input: number | string;
}

/** SCRUM-131: payload for public.stage_import(). */
export interface StageRpcPayload {
  p_kind: BatchKind;
  p_filename: string;
  p_file_sha256: string;
  p_template_version: string;
  p_healer_version: string;
  p_rows: StagedRow[];
  p_corrections: ReturnType<typeof stageCorrections>;
  p_summary: Record<string, unknown>;
  /** SCRUM-131 (070600): the uploader acknowledged a repeat file. Without it a repeat is refused (warning). */
  p_acknowledge_repeat: boolean;
}

export interface RepeatOf {
  source: "batch" | "stage";
  id: string;
  at: string;
  status?: string;
}

export interface StageRpcResult {
  stage_id: string;
  rows_sha256: string;
  expires_at: string;
  repeat_of: RepeatOf | null;
  row_count: number;
  /** SCRUM-131 (070600): true when this stage is a repeat the uploader acknowledged. */
  repeat_acknowledged?: boolean;
}

export interface StrictImportDeps {
  hasImportRole: () => Promise<boolean>;
  /** SCRUM-131: every existing customer (name + normalized_name) for the Healer's name matching. */
  listCustomers: () => Promise<ExistingCustomer[]>;
  /** Earliest batch with this hash, or null when the file is new or the lookup failed. A failed lookup does not block. */
  priorImport: (sha256: string) => Promise<PriorImport | null>;
  /** SCRUM-131: a pending upload of the same file, or null. A failed lookup does not block. */
  pendingImport?: (sha256: string) => Promise<PriorImport | null>;
  /** SCRUM-131: stage the healed rows for Chief's sign-off. Nothing is written to transactions. */
  callStage: (payload: StageRpcPayload) => Promise<StageRpcResult>;
  loadXlsx: () => Promise<XlsxLike>;
}

export interface StrictFileInput {
  filename: string;
  bytes: Uint8Array;
  /**
   * SCRUM-131 date fix: the uploader's date order when every DD-MM-style date in the file is ambiguous
   * (preview.dateOrder.needsChoice). The server re-runs the Healer with it and re-checks it against the file:
   * ignored when the file proves its own order or has no ambiguous date, a blocker when it contradicts the file.
   */
  dateOrder?: ChosenDateOrder | null;
}

export interface PreviewResult {
  templateVersion: string;
  templateStatus: string;
  fileSha256: string;
  sheetName: string | null;
  /**
   * SCRUM-131: plus healerFixCount and per-rule counts (each a filter over healerFixes). Always set by
   * runPreview; optional in the type only so older fixtures still compile.
   */
  summary: StrictSummary & Partial<HealerFixCounts>;
  /** SCRUM-131: blockers (Healer + validator). Any blocker means the file cannot be submitted. */
  rowErrors: RowIssue[];
  /** SCRUM-129: per-row provider outcome from the server check (stored provider, cloud type, alias applied). */
  providerRows: ProviderRowInfo[];
  /** SCRUM-131: Healer fixes per row (contract for the preview table; see SCRUM-131-PR.md). Always set by runPreview. */
  healerFixes?: HealerFix[];
  /** SCRUM-131: warnings (Healer + validator). The file can still be submitted. */
  warnings: RowIssue[];
  customers: CustomerPlan;
  /** Set when this exact file was imported before. SCRUM-131: a WARNING only (approved default). */
  priorImport: PriorImport | null;
  /** SCRUM-131: a pending upload of the same file (warning). */
  pendingImport?: PriorImport | null;
  /** Reasons the file cannot be submitted for approval. */
  blockers: string[];
  /** SCRUM-131: the Healer report (fixed vs flagged, with originals). */
  healer?: HealerReport;
  /** SCRUM-131: sign-off summary (split, totals, Complete/Incomplete). */
  review?: ReviewSummary;
  /** SCRUM-131: true when nothing blocks submitting for approval. Always set by runPreview. */
  canSubmit?: boolean;
  /** SCRUM-131: repeat-file warning text, or null. */
  repeatFileWarning?: string | null;
  /**
   * SCRUM-131 date fix: how DD-MM-style dates were read. needsChoice = ask the uploader for DD-MM-YYYY or
   * MM-DD-YYYY and preview again with dateOrder. Always set by runPreview (same object as healer.dateOrder).
   */
  dateOrder?: DateOrderReport;
}

/** SCRUM-131: what a "repeat_file" refusal carries, so the UI can offer "Submit anyway". */
export interface RepeatFileDetails {
  /** The earlier import of the same bytes (batch), or the upload already waiting (stage). */
  repeatOf: RepeatOf | null;
  /** true: submit again with acknowledgeRepeatFile: true to send it anyway (policy 'warn', the default).
   *  false: policy 'block', the file cannot be sent again. */
  canAcknowledge: boolean;
}

export class StrictImportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "disabled"
      | "forbidden"
      | "invalid_file"
      | "blocked"
      | "file_changed"
      | "db_error"
      | "reconcile"
      | "approval_required"
      | "not_configured"
      | "repeat_file",
    public readonly reasons: string[] = [],
    /** SCRUM-131: for code "repeat_file", the earlier import and whether acknowledging it is allowed. */
    public readonly repeat?: RepeatFileDetails,
  ) {
    super(message);
    this.name = "StrictImportError";
  }
}

async function guard(deps: StrictImportDeps) {
  if (!(await deps.hasImportRole())) throw new StrictImportError("Only Admin, Ops Lead or Ops User can import transactions.", "forbidden");
}

/** parse -> Healer -> validate on the exact bytes. The server always re-runs this (authoritative). */
async function analyse(deps: StrictImportDeps, input: StrictFileInput) {
  const fileSha256 = await sha256Hex(input.bytes);
  let sheet;
  try {
    sheet = await parseStrictBytes(input.filename, input.bytes, deps.loadXlsx);
  } catch (e) {
    throw new StrictImportError((e as Error).message, "invalid_file");
  }
  const existing = await deps.listCustomers();
  const review = reviewImport(sheet.header, sheet.rows, {
    customers: existing,
    blankRowsIgnored: sheet.blankRowsIgnored,
    dateOrder: input.dateOrder ?? null,
  });
  const customers = planCustomers(review.validation.records, existing);
  const priorImport = await deps.priorImport(fileSha256);
  const pendingImport = deps.pendingImport ? await deps.pendingImport(fileSha256) : null;
  return { fileSha256, sheet, review, customers, priorImport, pendingImport };
}

export function repeatFileMessage(prior: PriorImport | null, pending: PriorImport | null): string | null {
  if (prior) return `Warning: this exact file was already imported on ${prior.importedOn} (batch ${prior.id}). Check it is not a double upload.`;
  if (pending) return `Warning: this exact file is already waiting for approval (uploaded ${pending.importedOn}).`;
  return null;
}

function issues(review: ImportReview) {
  const strip = ({ tier: _t, code: _c, source: _s, ...rest }: HealerReport["blockers"][number]): RowIssue => rest;
  return { rowErrors: review.report.blockers.map(strip), warnings: review.report.warnings.map(strip) };
}

export async function runPreview(deps: StrictImportDeps, input: StrictFileInput): Promise<PreviewResult> {
  await guard(deps);
  const { fileSha256, sheet, review, customers, priorImport, pendingImport } = await analyse(deps, input);
  const { rowErrors, warnings } = issues(review);
  const healerFixes = healerFixesOf(review);
  const providerRows = providerRowsOf(review);
  return {
    templateVersion: STRICT_TEMPLATE_VERSION,
    templateStatus: STRICT_TEMPLATE_STATUS,
    fileSha256,
    sheetName: sheet.sheetName ?? null,
    summary: {
      ...review.validation.summary,
      errorCount: rowErrors.length,
      warningCount: warnings.length,
      // Validation runs on healed rows, so count aliases from the file's own spelling (= providerRows).
      providerAliasesApplied: providerRows.filter((r) => r.aliasApplied).length,
      ...healerFixCounts(healerFixes),
    },
    rowErrors,
    providerRows,
    healerFixes,
    warnings,
    customers,
    priorImport,
    pendingImport,
    blockers: review.blockers,
    healer: review.report,
    review: review.summary,
    canSubmit: review.canSubmit,
    repeatFileWarning: repeatFileMessage(priorImport, pendingImport),
    dateOrder: review.report.dateOrder,
  };
}

export interface SubmitInput extends StrictFileInput {
  expectedSha256: string;
  /**
   * SCRUM-131: the uploader saw the repeat-file warning and wants to send the file anyway. Without it a
   * repeat (same SHA-256 already imported or waiting) is refused with code "repeat_file"; with it the stage
   * records who acknowledged it and when (shown to the approver).
   */
  acknowledgeRepeatFile?: boolean;
}

export interface SubmitResult {
  stageId: string;
  fileSha256: string;
  rowsSha256: string;
  expiresAt: string;
  repeatOf: RepeatOf | null;
  /** SCRUM-131: true when this upload is a repeat the uploader acknowledged. */
  repeatAcknowledged: boolean;
  rows: number;
  kind: BatchKind;
  privateRows: number;
  publicRows: number;
  incompleteRows: number;
  correctionCount: number;
  healerVersion: string;
  templateVersion: string;
  /** SCRUM-131 date fix: the order the server read DD-MM-style dates with, and who decided it (null = not needed). */
  dateOrder: { used: ChosenDateOrder | null; source: "file" | "uploader" | null };
}

/**
 * SCRUM-131: the uploader submits the file for sign-off. The server re-reads the bytes, re-runs
 * parse -> Healer -> validate, refuses a file with any blocker, and stages the healed rows with
 * stage_import(). Nothing is written to transactions; Chief approves (or rejects) in the queue.
 */
export async function runSubmit(deps: StrictImportDeps, input: SubmitInput): Promise<SubmitResult> {
  await guard(deps);
  const { fileSha256, review, priorImport, pendingImport } = await analyse(deps, input);
  if (fileSha256 !== input.expectedSha256) {
    throw new StrictImportError("The file is not the one you previewed. Run preview again.", "file_changed");
  }
  if (!review.canSubmit) throw new StrictImportError("Submit refused", "blocked", review.blockers);
  const kind = review.summary.batchKind;
  if (kind === null) throw new StrictImportError("Submit refused", "blocked", ["No row has a valid Cloud Provider."]);
  const acknowledge = input.acknowledgeRepeatFile === true;
  // Repeat file = a warning the uploader must acknowledge (decided). The database checks it again.
  if (!acknowledge && (priorImport || pendingImport)) {
    const msg = repeatFileMessage(priorImport, pendingImport)!;
    const repeatOf: RepeatOf = priorImport
      ? { source: "batch", id: priorImport.id, at: priorImport.importedOn }
      : { source: "stage", id: pendingImport!.id, at: pendingImport!.importedOn, status: "pending" };
    throw new StrictImportError(msg, "repeat_file", [msg], { repeatOf, canAcknowledge: true });
  }
  // Defence in depth: every staged row's type follows its provider, and no price is NULL.
  if (review.stagedRows.some((r) => providerCloudType(r.healed.cloud_provider) !== r.healed.lab_type)) {
    throw new StrictImportError("Submit refused", "blocked", ["Cloud Provider and cloud type disagree."]);
  }
  if (review.stagedRows.some((r) => r.healed.input_cost === null || r.healed.selling_cost === null)) {
    throw new StrictImportError("Submit refused", "blocked", ["A price is missing after healing."]);
  }
  const payload: StageRpcPayload = {
    p_kind: kind,
    p_filename: input.filename.slice(0, 255),
    p_file_sha256: fileSha256,
    p_template_version: STRICT_TEMPLATE_VERSION,
    p_healer_version: HEALER_VERSION,
    p_rows: review.stagedRows,
    p_corrections: stageCorrections(review),
    p_summary: stageSummaryOf(review),
    p_acknowledge_repeat: acknowledge,
  };
  let res: StageRpcResult;
  try {
    res = await deps.callStage(payload);
  } catch (e) {
    const msg = (e as Error).message;
    if (/not configured/i.test(msg)) throw new StrictImportError(`Import approval is not set up yet: ${msg}`, "not_configured");
    if (/repeat file not acknowledged/i.test(msg)) {
      throw new StrictImportError(msg, "repeat_file", [msg], { repeatOf: repeatOfFromError(e), canAcknowledge: true });
    }
    if (/already imported or is waiting/i.test(msg)) {
      throw new StrictImportError(msg, "repeat_file", [msg], { repeatOf: repeatOfFromError(e), canAcknowledge: false });
    }
    throw new StrictImportError(`Submit failed, nothing was staged: ${msg}`, "db_error");
  }
  if (res.row_count !== review.summary.rows) {
    throw new StrictImportError(`Staging mismatch: expected ${review.summary.rows} rows, the database staged ${res.row_count}.`, "reconcile");
  }
  return {
    stageId: res.stage_id,
    fileSha256,
    rowsSha256: res.rows_sha256,
    expiresAt: res.expires_at,
    repeatOf: res.repeat_of ?? null,
    repeatAcknowledged: res.repeat_acknowledged === true,
    rows: review.summary.rows,
    kind,
    privateRows: review.summary.privateRows,
    publicRows: review.summary.publicRows,
    incompleteRows: review.summary.incompleteRows,
    correctionCount: review.summary.correctionCount,
    healerVersion: HEALER_VERSION,
    templateVersion: STRICT_TEMPLATE_VERSION,
    dateOrder: { used: review.report.dateOrder.used, source: review.report.dateOrder.source },
  };
}

/**
 * stage_import's own refusals (approval not configured, repeat file) are messages written for users, and
 * runSubmit maps them to codes, so they pass through unchanged (with DETAIL = the earlier import). Anything
 * else is logged and replaced by the friendly message (SCRUM-96). Before this, dbError turned the repeat
 * refusal (23505) into "This record already exists." and runSubmit could not recognise it.
 */
const STAGE_USER_MESSAGES = /not configured|already imported or is waiting|repeat file not acknowledged/i;
export function stageRpcError(error: { message: string; code?: string; details?: string | null }): Error {
  if (STAGE_USER_MESSAGES.test(error.message)) {
    logError(error, "strict-import.stage");
    return Object.assign(new AppError(error.message, error.code), { details: error.details ?? null });
  }
  return dbError(error, "strict-import.stage");
}

/** The earlier import named in a stage_import repeat error (PostgREST passes DETAIL through as `details`). */
function repeatOfFromError(e: unknown): RepeatOf | null {
  const raw = (e as { details?: unknown; detail?: unknown }).details ?? (e as { detail?: unknown }).detail;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw) as Partial<RepeatOf>;
    return v && typeof v.id === "string" && (v.source === "batch" || v.source === "stage") ? (v as RepeatOf) : null;
  } catch {
    return null;
  }
}

/** SCRUM-131: uploaders cannot commit. Kept so old callers get a clear answer instead of a write. */
export const APPROVAL_REQUIRED_MESSAGE =
  "Imports now need sign-off. Submit the file for approval; it is imported when an approver (Chief) approves it.";

export interface CommitResult {
  batchId: string;
  inserted: number;
  /** SCRUM-129 split as stored. */
  kind: BatchKind;
  privateRows: number;
  publicRows: number;
  totalSellingCents: number;
  totalInputCents: number;
  templateVersion: string;
  templateStatus: string;
}

export function toCentsExact(v: number | string): number {
  const s = String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Unexpected amount from database: ${s}`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -cents : cents;
}
