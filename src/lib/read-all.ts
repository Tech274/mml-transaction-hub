// SCRUM-70: read every row of a query instead of the first 1,000.
// Supabase/PostgREST returns at most 1,000 rows per request by default, so a
// plain `.select()` over transactions silently drops everything after row
// 1,000, and KPI totals computed from it are wrong without any warning.
import { fetchAllPages } from "@/lib/paging";

export const READ_ALL_PAGE = 1000;
export const READ_ALL_MAX_ROWS = 100_000;

// Minimal shape of a Supabase query builder that supports .range().
interface RangeQuery<T> {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * `build` must return a *fresh* query each call, with its filters and a deterministic
 * order (e.g. `.order("id")`), so pages never overlap or skip rows.
 * If there are more than `maxRows` rows it throws instead of returning partial totals.
 */
export async function readAllRows<T>(build: () => RangeQuery<T>, what: string, maxRows = READ_ALL_MAX_ROWS): Promise<T[]> {
  const { rows, truncated } = await fetchAllPages<T>(
    async (from, to) => {
      const { data, error } = await build().range(from, to);
      if (error) throw error;
      return data ?? [];
    },
    READ_ALL_PAGE,
    maxRows,
  );
  if (truncated) {
    throw new Error(`${what}: more than ${maxRows.toLocaleString("en-IN")} rows. Totals would be incomplete, so they are not shown. Contact engineering.`);
  }
  return rows;
}
