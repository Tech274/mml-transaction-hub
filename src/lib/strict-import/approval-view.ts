// SCRUM-131: pure display helpers for the pending-approvals queue and the sign-off detail
// (src/routes/_authenticated/import-approvals.*.tsx). No React, unit-tested.
import type { HealerRule } from "./healer";
import type { ImportStage, StageStatus } from "./approval";
import { PROPOSED_RULES } from "./template";

export const RULE_LABELS: Record<HealerRule, string> = {
  "date.reorder_to_iso": "Date to YYYY-MM-DD",
  "customer.match_existing": "Customer name matched to existing record",
  "provider.alias": "Provider name mapped",
  "price.blank_to_zero": "Blank price stored as 0",
  "price.invalid_to_zero": "Invalid price stored as 0",
  "text.trim": "Extra spaces removed",
};

export function ruleLabel(rule: string): string {
  return (RULE_LABELS as Record<string, string>)[rule] ?? rule;
}

export const STATUS_LABELS: Record<StageStatus, string> = {
  pending: "Waiting for sign-off",
  approved: "Approved",
  committed: "Approved and imported",
  rejected: "Rejected",
  expired: "Expired",
};

export function statusVariant(status: StageStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "committed" || status === "approved") return "default";
  if (status === "rejected") return "destructive";
  if (status === "expired") return "secondary";
  return "outline";
}

/** Template header for a stored field name ("customer_name" -> "Customer Name"). */
export function fieldHeader(field: string): string {
  return PROPOSED_RULES.columns.find((c) => c.field === field)?.header ?? field;
}

/** "(blank)" for a cell that was empty in the file. */
export function originalText(v: string | null | undefined): string {
  return v == null || v.trim() === "" ? "(blank)" : v;
}

/** One line under the file name: "342 rows · 336 Private cloud · 6 Public cloud". */
export function splitLine(s: Pick<ImportStage, "row_count" | "private_count" | "public_count">): string {
  return `${s.row_count} rows · ${s.private_count} Private cloud · ${s.public_count} Public cloud`;
}

/** Incomplete note (counted, never excluded). Null when every row is complete. */
export function incompleteLine(s: Pick<ImportStage, "incomplete_count" | "row_count">): string | null {
  if (!s.incomplete_count) return null;
  return `${s.incomplete_count} of ${s.row_count} rows are Incomplete (a price missing or 0, or a required field blank). They are imported and counted.`;
}

/**
 * Repeat-file warning for the approver, or null. SCRUM-131 (070600): names the earlier batch (or the upload
 * already waiting) and, when the uploader chose "Submit anyway", who acknowledged it and when:
 * "Repeat of batch 1a2b… (imported 2026-09-01), acknowledged by the uploader on 2026-10-06 07:05. Approving
 * imports its rows again."
 */
export function repeatLine(
  s: Pick<ImportStage, "repeat_of"> & Partial<Pick<ImportStage, "repeat_acknowledged_by" | "repeat_acknowledged_at" | "uploaded_by">>,
  names: Record<string, string> = {},
): string | null {
  const r = s.repeat_of;
  if (!r) return null;
  const id = typeof r.id === "string" ? r.id : "";
  const at = typeof r.at === "string" ? r.at.slice(0, 10) : "";
  const what =
    r.source === "stage"
      ? `Repeat of an upload already waiting for sign-off${id ? ` (${id.slice(0, 8)})` : ""}${at ? `, uploaded ${at}` : ""}`
      : `Repeat of batch ${id ? id.slice(0, 8) : "(unknown)"}${at ? ` (imported ${at})` : ""}`;
  let ack = ". Not acknowledged by the uploader";
  if (s.repeat_acknowledged_by) {
    const name = names[s.repeat_acknowledged_by];
    const who = s.repeat_acknowledged_by === s.uploaded_by ? `the uploader${name ? ` (${name})` : ""}` : (name ?? "the uploader");
    const when = s.repeat_acknowledged_at ? ` on ${String(s.repeat_acknowledged_at).slice(0, 16).replace("T", " ")}` : "";
    ack = `, acknowledged by ${who}${when}`;
  }
  return `${what}${ack}. Approving imports its rows again.`;
}

/** Count corrections per rule, in the fixed rule order, skipping zeros. */
export function correctionsSummary(corrections: readonly { rule: string }[]): { rule: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of corrections) counts.set(c.rule, (counts.get(c.rule) ?? 0) + 1);
  const order = Object.keys(RULE_LABELS);
  return [...counts.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 100 * +(order.indexOf(a[0]) < 0)) - (order.indexOf(b[0]) + 100 * +(order.indexOf(b[0]) < 0)))
    .map(([rule, count]) => ({ rule, label: ruleLabel(rule), count }));
}
