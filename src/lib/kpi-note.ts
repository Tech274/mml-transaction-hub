// SCRUM-131 (spec §129.4a, D9; plan §4.2 / G3): incomplete rows are INCLUDED in every
// KPI total. Each affected KPI shows a short note under the value, "12 incomplete · ₹1.2L",
// with the long form "Includes 12 incomplete rows · ₹1,20,000" as its title. Hidden when k = 0.
import { fmtCurrency, fmtCurrencyCompact, fmtNumber } from "@/lib/format";

/** Short form for the tile. `value` null = count-only KPI. Null when k = 0 (hidden). */
export function incompleteNote(count: number, value: number | null): string | null {
  if (!(count > 0)) return null;
  const rows = `${fmtNumber(count)} incomplete`;
  return value == null ? rows : `${rows} · ${fmtCurrencyCompact(value)}`;
}

/** Long form for title/hover. Null when k = 0. */
export function incompleteNoteTitle(count: number, value: number | null): string | null {
  if (!(count > 0)) return null;
  const rows = `Includes ${fmtNumber(count)} incomplete ${count === 1 ? "row" : "rows"}`;
  return value == null ? rows : `${rows} · ${fmtCurrency(value)}`;
}

/** Both forms, for SummaryKpi's `note` / `noteTitle` props. */
export function incompleteNoteProps(
  count: number,
  value: number | null,
): { note: string | null; noteTitle: string | null } {
  return { note: incompleteNote(count, value), noteTitle: incompleteNoteTitle(count, value) };
}
