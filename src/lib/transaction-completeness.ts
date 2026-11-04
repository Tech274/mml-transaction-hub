// SCRUM-103 / SCRUM-131: which transactions are Complete on All Transactions and the cloud views.
// ONE rule: isIncompleteTransaction (below). isTransactionComplete = !isIncompleteTransaction, and the DB
// generated column transactions.is_complete uses the same rule since
// supabase/migrations-pending/scrum131_is_complete_rule.sql (NOT APPLIED; held back until Chief's GO,
// Eng decision U1). Until then the DB column keeps the SCRUM-103 rule; code must not depend on it.
// Parity (TS vs SQL) is tested in src/lib/__tests__/scrum131-is-complete-parity.test.ts.
//
// NULL and blank or whitespace text are empty (isBlankField: the server's is_blank_text whitespace set,
// so NBSP-only counts as blank in the badge AND in the /transactions query). System columns (id, timestamps, created_by,
// import_batch_id, source_line, …) are not part of completeness.

/**
 * SCRUM-103 field list (the OLD is_complete rule). No longer decides completeness; kept for callers
 * that list captured fields. Use REQUIRED_TRANSACTION_FIELDS / isIncompleteTransaction.
 */
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

/** SCRUM-103: the extra field per kind (OLD rule; no longer decides completeness). */
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

// ---------------------------------------------------------------------------
// Eng QC P-N1 (SCRUM-131): ONE blank rule, the server's.
// Server: public.is_blank_text(p) in
// supabase/migrations/20261006070000_scrum131_import_staging_approval.sql (CREATE OR REPLACE FUNCTION
// public.is_blank_text; line 277 on 269b9f9, 271 on eedae34; tests find it by content):
//   p IS NULL OR btrim(p, U&' \0009\000A\000B\000C\000D\00A0\1680\2000...\200A\2028\2029\202F\205F\3000\FEFF') = ''
// used by import_row_is_incomplete and by the held is_complete rule (supabase/migrations-pending/
// scrum131_is_complete_rule.sql). The import
// side (isBlankCell / healer text.trim) uses JS trim(), which trims exactly this set.
// BLANK_CHAR_CLASS lists the same 25 code points as a regex class written with ASCII-only \uXXXX
// escapes, which JS RegExp and Postgres ARE (PostgREST `match` = `~`) read the same way, so the
// badge (isBlankField) and the /transactions DB filter (BLANK_TEXT_REGEX) share one definition.
// Postgres `\s` (the old "^\\s*$") misses U+00A0, U+2007, U+202F and U+FEFF.
// ---------------------------------------------------------------------------

/** The is_blank_text btrim set (25 code points) as the body of a regex character class. */
export const BLANK_CHAR_CLASS =
  "\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/**
 * Regex for "blank": empty or only is_blank_text characters. Sent as-is to PostgREST `match` /
 * `not.match` (Postgres `~`, ARE syntax) and used by isBlankField. Contains no PostgREST-reserved
 * characters (, . : ( )), so it needs no quoting inside or=().
 */
export const BLANK_TEXT_REGEX = `^[${BLANK_CHAR_CLASS}]*$`;

const BLANK_TEXT_RE = new RegExp(BLANK_TEXT_REGEX);

/**
 * True when a field is blank by the SERVER's rule (public.is_blank_text): null/undefined, or a
 * string made only of the is_blank_text whitespace set (NBSP, tab, newline, ideographic space, ...).
 * Non-strings (numbers, dates) are blank only when null.
 */
export function isBlankField(value: unknown): boolean {
  if (value == null) return true;
  return typeof value === "string" && BLANK_TEXT_RE.test(value);
}

/** Older name, kept for callers and the SQL comment that cite it. Same as isBlankField. */
export function isEmptyBusinessValue(value: unknown): boolean {
  return isBlankField(value);
}

/**
 * The stored cloud kind of a row, or null when neither lab_type nor repository_type
 * holds a known key. SCRUM-129: never falls back to public. (transactions.lab_type is
 * NOT NULL with a CHECK on the two keys, so null only happens for partial rows.)
 */
export function transactionKind(row: {
  lab_type?: string | null;
  repository_type?: string | null;
}): CloudKind | null {
  if (row.lab_type === "private_cloud" || row.repository_type === "private_cloud")
    return "private_cloud";
  if (row.lab_type === "public_cloud" || row.repository_type === "public_cloud")
    return "public_cloud";
  return null;
}

/**
 * SCRUM-131: Complete = not Incomplete (isIncompleteTransaction): both prices > 0 and every REQUIRED
 * field present. Same rule as the DB is_complete column. Kind no longer matters (lab_type is NOT NULL
 * and checked by classify_transaction; non-critical blanks such as system_config do not count).
 */
export function isTransactionComplete(
  row: {
    lab_type?: string | null;
    repository_type?: string | null;
  } & Partial<Record<CompletenessField, unknown>>,
): boolean {
  return !isIncompleteTransaction(row);
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
export function selectTransactions<
  T extends { id: string; created_at: string } & Parameters<typeof isTransactionComplete>[0],
>(
  rows: readonly T[],
  opts: {
    completeness: CompletenessFilter;
    sortMode: TransactionSortMode;
    scoreOf?: (id: string) => number;
  },
): T[] {
  const want = completenessEquals(opts.completeness);
  const filtered =
    want == null ? rows.slice() : rows.filter((row) => isTransactionComplete(row) === want);
  return sortTransactionRows(filtered, opts.sortMode, opts.scoreOf);
}

// ---------------------------------------------------------------------------
// SCRUM-131: Complete / Incomplete split (spec §129.4a, D8, John 06:11 IST).
//
// DERIVED, not stored: there is no "price stored as 0 placeholder" column or flag
// (Chris, 6 Oct 2026), so a row flips to Complete as soon as it is edited.
// Per Chief (SCRUM-131 comment 11437) a missing price is stored as 0 as a placeholder.
//
// A row is Incomplete when EITHER:
//   1. input_cost or selling_cost is null, blank or <= 0 (both stored price columns;
//      both views total revenue = selling_cost and an input cost); or
//   2. a REQUIRED field is blank: REQUIRED_TRANSACTION_FIELDS.
// Non-critical blanks (System Config, Line of Business, start/end date, Total Users)
// do NOT make a row Incomplete. Complete = not incomplete.
// Pure TS: the server (Chris, C7) calls the same helper.
// Incomplete rows still count in every KPI total; views show "Includes {k} incomplete rows".
//
// isTransactionComplete above is !isIncompleteTransaction, and the DB is_complete column is
// regenerated with this rule in migrations-pending/scrum131_is_complete_rule.sql (held back until Chief's GO).
// ---------------------------------------------------------------------------

/**
 * Required fields (spec §129.4a starting set; Chris confirms the final list).
 * Spec name -> column: Potential ID -> potential_id, Month -> month, Year -> year,
 * Customer -> customer_name, Lab -> lab_name, Cloud Provider -> cloud_provider.
 */
export const REQUIRED_TRANSACTION_FIELDS = [
  "potential_id",
  "month",
  "year",
  "customer_name",
  "lab_name",
  "cloud_provider",
] as const;
export type RequiredTransactionField = (typeof REQUIRED_TRANSACTION_FIELDS)[number];

/** Price columns checked for null / <= 0. */
export const INCOMPLETE_PRICE_FIELDS = ["input_cost", "selling_cost"] as const;
export type IncompletePriceField = (typeof INCOMPLETE_PRICE_FIELDS)[number];

export type IncompleteReason = "price_missing_or_zero" | "required_blank";

export type CompletenessRow = Partial<
  Record<RequiredTransactionField | IncompletePriceField, unknown>
>;

function isMissingOrZeroPrice(value: unknown): boolean {
  if (isBlankField(value)) return true;
  const n = typeof value === "number" ? value : Number(value);
  return !Number.isFinite(n) || n <= 0;
}

/** Why a row is Incomplete (empty array = Complete). */
export function incompleteReasons(row: CompletenessRow): IncompleteReason[] {
  const reasons: IncompleteReason[] = [];
  if (INCOMPLETE_PRICE_FIELDS.some((f) => isMissingOrZeroPrice(row[f])))
    reasons.push("price_missing_or_zero");
  if (REQUIRED_TRANSACTION_FIELDS.some((f) => isBlankField(row[f]))) reasons.push("required_blank");
  return reasons;
}

/** SCRUM-131: the ONE Incomplete rule (see the block comment above). */
export function isIncompleteTransaction(row: CompletenessRow): boolean {
  return incompleteReasons(row).length > 0;
}

export type CompletenessTotals = {
  count: number;
  users: number;
  inputCost: number;
  sellingCost: number;
};

function emptyTotals(): CompletenessTotals {
  return { count: 0, users: 0, inputCost: 0, sellingCost: 0 };
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Count and total rows by Complete / Incomplete. `inputCostOf` lets a view keep its
 * own input-cost measure (e.g. actual alloc ?? input_cost ?? auto); defaults to input_cost.
 */
export function splitByCompleteness<T extends CompletenessRow & { total_users?: unknown }>(
  rows: readonly T[],
  inputCostOf: (row: T) => number | null | undefined = (row) => num(row.input_cost),
): { complete: CompletenessTotals; incomplete: CompletenessTotals } {
  const complete = emptyTotals();
  const incomplete = emptyTotals();
  for (const row of rows) {
    const bucket = isIncompleteTransaction(row) ? incomplete : complete;
    bucket.count += 1;
    bucket.users += num(row.total_users);
    bucket.inputCost += num(inputCostOf(row));
    bucket.sellingCost += num(row.selling_cost);
  }
  return { complete, incomplete };
}

/** Columns a view must select so isIncompleteTransaction and splitByCompleteness can decide. */
export const COMPLETENESS_SELECT_COLUMNS = [
  ...REQUIRED_TRANSACTION_FIELDS,
  ...INCOMPLETE_PRICE_FIELDS,
  "total_users",
] as const;

// ---------------------------------------------------------------------------
// The same rule as a PostgREST query (read-side filter, no DB change), so the /transactions
// list and its Incomplete count filter server-side before pagination without reading
// is_complete. Generated from REQUIRED_TRANSACTION_FIELDS and INCOMPLETE_PRICE_FIELDS.
// ---------------------------------------------------------------------------

/** Required fields stored as numbers (blank = NULL only). The rest are text (isBlankField). */
export const REQUIRED_NUMERIC_FIELDS: readonly RequiredTransactionField[] = ["month", "year"];

// Text blank = `is.null` OR `match.BLANK_TEXT_REGEX` (defined with isBlankField above), which is
// is_blank_text exactly: checked on Postgres 17 for every BMP code point (Eng QC P-N1).

export type CompletenessQueryFilter = {
  column: string;
  operator: "gt" | "not.is" | "not.match";
  value: string;
};

/** AND-list for Complete: every price > 0 and every required field non-blank. */
export function completeQueryFilters(): CompletenessQueryFilter[] {
  const out: CompletenessQueryFilter[] = [];
  for (const f of INCOMPLETE_PRICE_FIELDS) out.push({ column: f, operator: "gt", value: "0" });
  for (const f of REQUIRED_TRANSACTION_FIELDS) {
    out.push({ column: f, operator: "not.is", value: "null" });
    if (!REQUIRED_NUMERIC_FIELDS.includes(f))
      out.push({ column: f, operator: "not.match", value: BLANK_TEXT_REGEX });
  }
  return out;
}

/** OR-string for Incomplete (the exact negation of completeQueryFilters). */
export function incompleteQueryOr(): string {
  const parts: string[] = [];
  for (const f of INCOMPLETE_PRICE_FIELDS) parts.push(`${f}.is.null`, `${f}.lte.0`);
  for (const f of REQUIRED_TRANSACTION_FIELDS) {
    parts.push(`${f}.is.null`);
    if (!REQUIRED_NUMERIC_FIELDS.includes(f)) parts.push(`${f}.match.${BLANK_TEXT_REGEX}`);
  }
  return parts.join(",");
}

type FilterableQuery<Q> = {
  filter: (column: string, operator: string, value: string) => Q;
  or: (filters: string) => Q;
};

/** Apply a Complete / Incomplete filter to a supabase-js query (no-op for "all"). */
export function applyCompletenessQuery<Q extends FilterableQuery<Q>>(
  query: Q,
  filter: CompletenessFilter | "complete" | "incomplete" | null,
): Q {
  if (filter === "complete") {
    let q = query;
    for (const c of completeQueryFilters()) q = q.filter(c.column, c.operator, c.value);
    return q;
  }
  if (filter === "incomplete") return query.or(incompleteQueryOr());
  return query;
}
