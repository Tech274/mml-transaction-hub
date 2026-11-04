// SCRUM-131 date fix: what the Bulk Upload preview shows about the file's date format. Pure; the
// component only renders it. The server decides (preview.dateOrder); the uploader's choice is sent back
// with preview and submit as dateOrder and re-checked on the server.
import type { ChosenDateOrder, DateOrderReport } from "./healer";

export const DATE_ORDER_OPTIONS: readonly { value: ChosenDateOrder; label: string }[] = [
  { value: "DMY", label: "DD-MM-YYYY (day first, e.g. 05-04-2026 = 5 April)" },
  { value: "MDY", label: "MM-DD-YYYY (month first, e.g. 05-04-2026 = 4 May)" },
];

const SHORT: Record<ChosenDateOrder, string> = { DMY: "DD-MM-YYYY", MDY: "MM-DD-YYYY" };

export type DateOrderPrompt =
  /** Ask: every DD-MM-style date is ambiguous and nothing was chosen. Submit stays blocked. */
  | { kind: "choose"; message: string }
  /** The uploader's choice is in use; they can change it. */
  | { kind: "chosen"; message: string; chosen: ChosenDateOrder }
  /** Nothing to show (no DD-MM dates, the file proves its order, or the file is blocked for another reason). */
  | null;

export function dateOrderPrompt(d: DateOrderReport | undefined | null): DateOrderPrompt {
  if (!d) return null;
  if (d.needsChoice) {
    const n = d.ambiguousCells;
    return {
      kind: "choose",
      message: `${n} ${n === 1 ? "date could" : "dates could"} be day-first or month-first and nothing in the file says which. Choose the date format used in this file:`,
    };
  }
  if (d.source === "uploader" && d.used) {
    return {
      kind: "chosen",
      message: `Dates read as ${SHORT[d.used]} (your choice).`,
      chosen: d.used,
    };
  }
  return null;
}

/**
 * SCRUM-131 date fix F1: the line the approver (and the uploader, on My uploads) sees when the uploader
 * picked the date format. Reads the stored stage summary: date_order.order is "dmy_chosen" / "mdy_chosen"
 * only when the uploader chose (stageSummaryOf, kept by import_stage_summary 070900). Null for anything
 * else: no date_order, a proven order ("dmy", "mdy"), "unknown", or an unexpected shape.
 */
export function stageDateOrderLine(
  summary: { [key: string]: unknown } | null | undefined,
  who: "uploader" | "you" = "uploader",
): string | null {
  const d = summary?.date_order;
  const order =
    d && typeof d === "object" && !Array.isArray(d) ? (d as { order?: unknown }).order : null;
  const used: ChosenDateOrder | null =
    order === "dmy_chosen" ? "DMY" : order === "mdy_chosen" ? "MDY" : null;
  if (!used) return null;
  const whose = who === "you" ? "your choice" : "uploader's choice";
  return `Dates read as ${SHORT[used]} (${whose}; nothing in the file proved the order)`;
}

/** "DD-MM-YYYY" / "MM-DD-YYYY". */
export function dateOrderLabel(o: ChosenDateOrder): string {
  return SHORT[o];
}

// S2 (John's QC): a failed re-check keeps the previous preview on screen. `shown` is the date format the
// shown preview was checked with (undefined = none); `chosen` is the uploader's latest pick.

/** Send (and "Submit anyway") only when the preview on screen was checked with the chosen format. */
export function previewMatchesChoice(
  shown: ChosenDateOrder | undefined,
  chosen: ChosenDateOrder | undefined,
): boolean {
  return shown === chosen;
}

/** A format button is clickable unless busy, or it is the chosen format and the preview already matches it. */
export function canPickDateOrder(
  option: ChosenDateOrder,
  chosen: ChosenDateOrder | undefined,
  shown: ChosenDateOrder | undefined,
  busy: boolean,
): boolean {
  if (busy) return false;
  return !(option === chosen && previewMatchesChoice(shown, chosen));
}

/** Under the picker after a failed re-check: why Send is off and how to retry. Null when the preview matches. */
export function staleDateOrderNote(
  shown: ChosenDateOrder | undefined,
  chosen: ChosenDateOrder | undefined,
): string | null {
  if (!chosen || previewMatchesChoice(shown, chosen)) return null;
  const was = shown ? `checked as ${SHORT[shown]}` : "checked without a date format";
  return `The preview below is still the one ${was}: the check with ${SHORT[chosen]} did not finish. Click ${SHORT[chosen]} to try again or pick the other format. Sending stays off until a check succeeds.`;
}
