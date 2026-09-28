// SCRUM-103: which fields make a transaction Complete on All Transactions.
// Keep this list in step with the is_complete expression in
// supabase/migrations/20260928031000_scrum103_lenient_import.sql.
//
// A numeric 0 is a value. NULL and blank or whitespace text are empty.
// System columns (id, timestamps, created_by, import_batch_id, source_line, …)
// are not part of completeness.

/** Fields captured for every row, whatever the cloud kind. "customer" is customer_name. */
export const TRANSACTION_COMPLETENESS_FIELDS = [
  "potential_id",
  "month",
  "year",
  "customer_name",
  "lab_name",
  "line_of_business",
  "start_date",
  "end_date",
  "total_users",
  "input_cost",
  "selling_cost",
] as const;

/** The extra field that applies to that row's kind, and only that one. */
export const TRANSACTION_KIND_COMPLETENESS_FIELD = {
  public_cloud: "cloud_provider",
  private_cloud: "system_config",
} as const;

export type CompletenessField =
  | (typeof TRANSACTION_COMPLETENESS_FIELDS)[number]
  | (typeof TRANSACTION_KIND_COMPLETENESS_FIELD)[keyof typeof TRANSACTION_KIND_COMPLETENESS_FIELD];

export type CloudKind = keyof typeof TRANSACTION_KIND_COMPLETENESS_FIELD;

export type CompletenessFilter = "all" | "complete" | "incomplete";

export type TransactionSortMode = "recent" | "relevance";

export function isEmptyBusinessValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

export function transactionKind(row: {
  lab_type?: string | null;
  repository_type?: string | null;
}): CloudKind {
  if (row.lab_type === "private_cloud" || row.repository_type === "private_cloud") return "private_cloud";
  return "public_cloud";
}

/** Every business field for this row's kind has a value. */
export function isTransactionComplete(row: {
  lab_type?: string | null;
  repository_type?: string | null;
} & Partial<Record<CompletenessField, unknown>>): boolean {
  const kind = transactionKind(row);
  const fields: readonly CompletenessField[] = [
    ...TRANSACTION_COMPLETENESS_FIELDS,
    TRANSACTION_KIND_COMPLETENESS_FIELD[kind],
  ];
  return fields.every((field) => !isEmptyBusinessValue(row[field]));
}

/** null means do not filter. true/false is the is_complete equality sent to the query. */
export function completenessEquals(filter: CompletenessFilter): boolean | null {
  if (filter === "complete") return true;
  if (filter === "incomplete") return false;
  return null;
}

/**
 * What the list query asks the database for. The completeness predicate and the
 * sort are both applied before pagination. Fuzzy search sorts the already
 * filtered rows in the browser because relevance is not a column.
 */
export function transactionListPlan(opts: {
  completeness: CompletenessFilter;
  sortMode: TransactionSortMode;
  fuzzy: boolean;
}): {
  isComplete: boolean | null;
  serverOrder: { column: "created_at"; ascending: false } | null;
} {
  return {
    isComplete: completenessEquals(opts.completeness),
    serverOrder: opts.fuzzy ? null : { column: "created_at", ascending: false },
  };
}

export function sortTransactionRows<T extends { id: string; created_at: string }>(
  rows: readonly T[],
  sortMode: TransactionSortMode,
  scoreOf: (id: string) => number = () => 0,
): T[] {
  return rows.slice().sort((a, b) => {
    if (sortMode === "relevance") {
      const diff = scoreOf(b.id) - scoreOf(a.id);
      if (diff !== 0) return diff;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/** In-memory form of the same filter-then-sort the list query does. Used by tests. */
export function selectTransactions<T extends { id: string; created_at: string } & Parameters<typeof isTransactionComplete>[0]>(
  rows: readonly T[],
  opts: {
    completeness: CompletenessFilter;
    sortMode: TransactionSortMode;
    scoreOf?: (id: string) => number;
  },
): T[] {
  const want = completenessEquals(opts.completeness);
  const filtered = want == null ? rows.slice() : rows.filter((row) => isTransactionComplete(row) === want);
  return sortTransactionRows(filtered, opts.sortMode, opts.scoreOf);
}
