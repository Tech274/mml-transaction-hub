// SCRUM-131 (John 06:25): "All · Complete · Incomplete" tabs on the Public and Private
// cloud views. isIncompleteTransaction is the only rule, so tab counts always match the
// Completeness card (splitByCompleteness uses the same predicate).
import { isIncompleteTransaction, type CompletenessRow } from "@/lib/transaction-completeness";

export const COMPLETENESS_TABS = ["all", "complete", "incomplete"] as const;
export type CompletenessTab = (typeof COMPLETENESS_TABS)[number];

export const COMPLETENESS_TAB_LABEL: Record<CompletenessTab, string> = {
  all: "All",
  complete: "Complete",
  incomplete: "Incomplete",
};

/** URL value -> tab. Anything unknown is "all" (the default). */
export function parseCompletenessTab(value: unknown): CompletenessTab {
  return value === "complete" || value === "incomplete" ? value : "all";
}

/** Tab -> URL value ("all" is omitted from the URL). */
export function completenessTabSearch(tab: CompletenessTab): "complete" | "incomplete" | undefined {
  return tab === "all" ? undefined : tab;
}

/** FilterSummary text for a filtered tab, e.g. "Showing 12 incomplete rows". Null for All. */
export function completenessFilterSummary(tab: CompletenessTab, count: number): string | null {
  if (tab === "all") return null;
  return `Showing ${count.toLocaleString("en-IN")} ${tab} ${count === 1 ? "row" : "rows"}`;
}

/** The per-tile incomplete note only makes sense on All (on a filtered tab it is 0 or the whole value). */
export function noteCountForTab(tab: CompletenessTab, incompleteCount: number): number {
  return tab === "all" ? incompleteCount : 0;
}

export function filterByCompletenessTab<T extends CompletenessRow>(
  rows: readonly T[],
  tab: CompletenessTab,
): T[] {
  if (tab === "all") return rows.slice();
  const wantIncomplete = tab === "incomplete";
  return rows.filter((row) => isIncompleteTransaction(row) === wantIncomplete);
}

export function completenessTabCounts(
  rows: readonly CompletenessRow[],
): Record<CompletenessTab, number> {
  let incomplete = 0;
  for (const row of rows) if (isIncompleteTransaction(row)) incomplete += 1;
  return { all: rows.length, complete: rows.length - incomplete, incomplete };
}
