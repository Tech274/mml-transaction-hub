// SCRUM-131: server-side KPI/summary responses expose how many rows are Incomplete and what they are
// worth, so the UI can show a note. Nothing is excluded: the totals still include Incomplete rows.
// The rule is Peter's shared isIncompleteTransaction (via splitByCompleteness); no second rule here.
import { splitByCompleteness, type CompletenessRow } from "./transaction-completeness";

/** Columns a summary query must select for the Incomplete rule (required fields + both prices). */
export const INCOMPLETE_RULE_COLUMNS = "potential_id, month, year, customer_name, lab_name, cloud_provider, input_cost, selling_cost" as const;

export interface IncompleteKpi {
  /** Incomplete rows (price missing or <= 0, or a required field blank). Included in every total. */
  incomplete_transactions: number;
  complete_transactions: number;
  incomplete_users: number;
  /** Revenue (selling) and input cost of the Incomplete rows; null when finance totals are hidden. */
  incomplete_revenue: number | null;
  incomplete_input_cost: number | null;
  /** Ready-to-show sentence, or null when every row is complete. */
  incomplete_note: string | null;
}

export function incompleteKpi<T extends CompletenessRow & { total_users?: unknown }>(
  rows: readonly T[],
  opts: { canViewFinanceTotals: boolean; inputCostOf?: (row: T) => number | null | undefined },
): IncompleteKpi {
  const { complete, incomplete } = splitByCompleteness(rows, opts.inputCostOf);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    incomplete_transactions: incomplete.count,
    complete_transactions: complete.count,
    incomplete_users: incomplete.users,
    incomplete_revenue: opts.canViewFinanceTotals ? round2(incomplete.sellingCost) : null,
    incomplete_input_cost: opts.canViewFinanceTotals ? round2(incomplete.inputCost) : null,
    incomplete_note:
      incomplete.count === 0
        ? null
        : `${incomplete.count} of ${rows.length} transactions are Incomplete (a price missing or 0, or a required field blank). They are included in these totals.`,
  };
}
