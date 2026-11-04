// SCRUM-131: Bulk Upload "Send {n} rows for sign-off". Uploaders no longer import directly:
// commitStrictImport always answers approval_required, so the screen calls submitStrictImport,
// which re-runs the check on the server and stages the healed rows for an approver (Chief).
// Nothing reaches transactions until the approver signs it off. Pure state helpers; the
// component only renders them.
import type { RepeatOf, StrictImportError, SubmitResult } from "./service";
import { cloudPreviewSummary, type CloudCounts } from "./cloud-preview";

export type SignOffState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "submitted"; result: SubmitResult }
  | {
      status: "error";
      code: StrictImportError["code"] | "network";
      message: string;
      reasons: string[];
      /** code "repeat_file" only: the earlier import, and whether "Submit anyway" is allowed. */
      repeat?: { repeatOf: RepeatOf | null; canAcknowledge: boolean };
    };

export const SIGN_OFF_IDLE: SignOffState = { status: "idle" };

/** submitStrictImport's answer, as returned by the server function. */
export type SubmitResponse =
  | { ok: true; result: SubmitResult }
  | {
      ok: false;
      code: StrictImportError["code"];
      message: string;
      reasons: string[];
      /** code "repeat_file": the earlier batch or waiting upload of the same bytes. */
      repeatOf?: RepeatOf | null;
      /** code "repeat_file": true = may re-send with acknowledgeRepeatFile (policy 'warn'). */
      canAcknowledge?: boolean;
    };

export function signOffAfter(res: SubmitResponse): SignOffState {
  if (res.ok) return { status: "submitted", result: res.result };
  const base = {
    status: "error" as const,
    code: res.code,
    message: res.message,
    reasons: res.reasons,
  };
  if (res.code !== "repeat_file") return base;
  return {
    ...base,
    repeat: { repeatOf: res.repeatOf ?? null, canAcknowledge: res.canAcknowledge === true },
  };
}

export function signOffAfterThrow(e: unknown): SignOffState {
  const message = e instanceof Error && e.message ? e.message : "Could not reach the server.";
  return { status: "error", code: "network", message, reasons: [] };
}

function rowsWord(n: number): string {
  return n === 1 ? "row" : "rows";
}

/** "Send 342 rows for sign-off" / "Sending for sign-off…" / "Sent for sign-off". */
export function signOffButtonLabel(rows: number, state: SignOffState): string {
  if (state.status === "pending") return "Sending for sign-off…";
  if (state.status === "submitted") return "Sent for sign-off";
  return `Send ${rows} ${rowsWord(rows)} for sign-off`;
}

/**
 * These errors need a new preview or a change to the file; sending the same bytes again cannot
 * succeed. Others (database, not configured, network) may be retried.
 */
type SignOffErrorCode = Extract<SignOffState, { status: "error" }>["code"];
const FINAL_ERRORS: ReadonlySet<SignOffErrorCode> = new Set<SignOffErrorCode>([
  "file_changed",
  "blocked",
  "forbidden",
  "invalid_file",
  "repeat_file",
  "disabled",
]);

export function signOffCanRetry(state: SignOffState): boolean {
  return state.status === "error" && !FINAL_ERRORS.has(state.code);
}

// ---------------------------------------------------------------------------
// Repeat file (SCRUM-131 contract): submitStrictImport refuses a file whose bytes were imported or
// sent before with code "repeat_file", repeatOf and canAcknowledge. The normal button stays final
// for it; a separate "Submit anyway (repeat of …)" re-sends with acknowledgeRepeatFile: true when the
// server allows it (policy 'warn'). Under policy 'block' a new file is needed.
// ---------------------------------------------------------------------------

/** "batch 1a2b3c4d" (an import) / "upload 1a2b3c4d" (one still waiting) / "an earlier upload". */
export function repeatOfLabel(r: RepeatOf | null): string {
  if (!r) return "an earlier upload";
  return `${r.source === "batch" ? "batch" : "upload"} ${r.id.slice(0, 8)}`;
}

export type RepeatFileAction =
  | { kind: "acknowledge"; label: string; note: string }
  | { kind: "new_file"; message: string };

/** What the screen offers after a repeat_file refusal, or null for any other state. */
export function repeatFileAction(state: SignOffState): RepeatFileAction | null {
  if (state.status !== "error" || state.code !== "repeat_file") return null;
  const of = repeatOfLabel(state.repeat?.repeatOf ?? null);
  if (state.repeat?.canAcknowledge === true) {
    return {
      kind: "acknowledge",
      label: `Submit anyway (repeat of ${of})`,
      note: "Only if this is not a double upload. The approver sees that you confirmed the repeat.",
    };
  }
  return {
    kind: "new_file",
    message: `This file repeats ${of} and repeats are blocked. A new file is needed: fix the file or upload a different one.`,
  };
}

/** The acknowledge button is usable only for an allowed repeat_file refusal. */
export function canSubmitAnyway(serverCanSubmit: boolean, state: SignOffState): boolean {
  return serverCanSubmit && repeatFileAction(state)?.kind === "acknowledge";
}

/** The button is enabled only when the server says the file can be submitted and nothing is in flight. */
export function canSendForSignOff(serverCanSubmit: boolean, state: SignOffState): boolean {
  if (!serverCanSubmit) return false;
  if (state.status === "idle") return true;
  return signOffCanRetry(state);
}

/** Footnote under the button. Counts are the server's summary. */
export function signOffFootnote(counts: CloudCounts | null, errorCount: number): string {
  if (!counts || errorCount > 0) return "All or nothing: any row error stops the whole file.";
  return `All or nothing: after sign-off, ${counts.privateCount} Private cloud and ${counts.publicCount} Public cloud rows will be saved. Nothing is saved before then.`;
}

/** "342 rows sent for sign-off: 336 Private cloud · 6 Public cloud". */
export function submittedTitle(
  r: Pick<SubmitResult, "rows" | "privateRows" | "publicRows">,
): string {
  return `${r.rows} ${rowsWord(r.rows)} sent for sign-off: ${cloudPreviewSummary({
    privateCount: r.privateRows,
    publicCount: r.publicRows,
  })}`;
}

/** Second line of the confirmation; the expiry date is formatted by the caller. */
export function submittedDetail(
  r: Pick<SubmitResult, "incompleteRows" | "correctionCount"> &
    Partial<Pick<SubmitResult, "repeatAcknowledged">>,
  expires: string,
): string {
  const parts = ["Nothing is saved until an approver signs it off."];
  if (r.repeatAcknowledged) {
    parts.push("Sent as a repeat file you confirmed; the approver sees that.");
  }
  if (r.correctionCount > 0) {
    parts.push(
      `${r.correctionCount} Healer ${r.correctionCount === 1 ? "fix" : "fixes"} sent with it.`,
    );
  }
  if (r.incompleteRows > 0) {
    parts.push(
      `${r.incompleteRows} ${rowsWord(r.incompleteRows)} will be Incomplete (price missing or 0, or a required field blank).`,
    );
  }
  parts.push(`Expires ${expires} if nobody signs it off.`);
  return parts.join(" ");
}

/** Error title: "Submit refused" from the server reads better as a sentence about this file. */
export function signOffErrorTitle(state: Extract<SignOffState, { status: "error" }>): string {
  if (state.code === "blocked") return "This file cannot be sent for sign-off";
  return state.message;
}
