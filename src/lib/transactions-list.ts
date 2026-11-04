// SCRUM-128 C7: the All transactions list's numbers, moved verbatim out of
// components/transactions-table.tsx (plan R1: calculations are not touched) so tests can pin them.
// transactionPageSummary is the "Page users / revenue / cost / profit" strip; transactionRowProfit
// the Profit cell; transactionExportRow one row of the Excel export.
import { MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { cloudTypeLabel } from "@/lib/cloud-provider";

export type RepoFilter = "all" | "public_cloud" | "private_cloud";

export type TransactionListRow = {
  id: string;
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  repository_type: string | null;
  cloud_provider: string | null;
  system_config?: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
  input_cost: number | null;
  selling_cost: number | null;
  created_at: string;
  updated_at: string;
};

type SummaryRow = Pick<TransactionListRow, "total_users" | "selling_cost" | "input_cost">;

/** The strip under the filters: sums over the rows on the current page. */
export function transactionPageSummary(rows: readonly SummaryRow[]) {
  return {
    users: rows.reduce((s, r) => addNullable(s, r.total_users), 0),
    revenue: rows.reduce((s, r) => addNullable(s, r.selling_cost), 0),
    cost: rows.reduce((s, r) => addNullable(s, r.input_cost), 0),
    profit: rows.reduce(
      (s, r) => s + addNullable(0, r.selling_cost) - addNullable(0, r.input_cost),
      0,
    ),
  };
}

/** Profit cell: null ("—") when both prices are missing. */
export function transactionRowProfit(r: Pick<SummaryRow, "selling_cost" | "input_cost">) {
  return r.selling_cost == null && r.input_cost == null
    ? null
    : addNullable(0, r.selling_cost) - addNullable(0, r.input_cost);
}

/** The file name stem of the Excel export. */
export function transactionExportName(repoFilter: RepoFilter): string {
  return repoFilter === "public_cloud"
    ? "public-cloud"
    : repoFilter === "private_cloud"
      ? "private-cloud"
      : "all-transactions";
}

/** One Excel row (column names unchanged). `score` is the fuzzy relevance when searching. */
export function transactionExportRow(
  r: TransactionListRow,
  repoFilter: RepoFilter,
  isFuzzy: boolean,
  score: number,
) {
  return {
    "Potential ID": r.potential_id,
    Month: r.month ? MONTH_NAMES[r.month - 1] : "",
    Year: r.year,
    Customer: r.customer_name,
    "Lab Name": r.lab_name,
    "Cloud type": cloudTypeLabel(r.repository_type),
    "Cloud Provider": r.cloud_provider,
    ...(repoFilter !== "public_cloud" ? { "System Config": r.system_config ?? "" } : {}),
    "Line of Business": r.line_of_business,
    "Start Date": r.start_date,
    "End Date": r.end_date,
    "Total Users": r.total_users,
    "Input Cost": r.input_cost,
    "Selling Cost": r.selling_cost,
    Profit:
      r.selling_cost == null && r.input_cost == null
        ? null
        : addNullable(0, r.selling_cost) - addNullable(0, r.input_cost),
    "Margin %":
      r.selling_cost != null && Number(r.selling_cost) > 0
        ? Number(
            (
              ((Number(r.selling_cost) - addNullable(0, r.input_cost)) / Number(r.selling_cost)) *
              100
            ).toFixed(2),
          )
        : null,
    ...(isFuzzy ? { "Relevance Score": Number(score.toFixed(4)) } : {}),
    "Created At": r.created_at,
    "Updated At": r.updated_at,
  };
}
