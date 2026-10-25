import { TOOL_TABLES, type ReadRequest, type UserDataAccess } from "./types";

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, value: unknown) => Query;
  gte: (column: string, value: unknown) => Query;
  lte: (column: string, value: unknown) => Query;
  ilike: (column: string, value: unknown) => Query;
  order: (column: string, opts: { ascending: boolean }) => Query;
  limit: (n: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/**
 * Reads through the invoking user's Supabase client, so RLS applies.
 * This module does not import the service-role client.
 */
export function accessFromSupabase(client: { from: (table: string) => Query }): UserDataAccess {
  return {
    async read(req: ReadRequest) {
      if (!(TOOL_TABLES as readonly string[]).includes(req.table)) {
        return { rows: [], error: "table is not allow-listed" };
      }
      let query = client.from(req.table).select(req.columns);
      for (const filter of req.filters) {
        if (filter.op === "eq") query = query.eq(filter.column, filter.value);
        else if (filter.op === "in") query = query.in(filter.column, filter.value as never);
        else if (filter.op === "gte") query = query.gte(filter.column, filter.value);
        else if (filter.op === "lte") query = query.lte(filter.column, filter.value);
        else query = query.ilike(filter.column, String(filter.value));
      }
      if (req.order) query = query.order(req.order.column, { ascending: req.order.ascending });
      const { data, error } = await query.limit(req.limit);
      if (error) return { rows: [], error: error.message ?? "read failed" };
      return { rows: (Array.isArray(data) ? data : []) as Record<string, unknown>[] };
    },
  };
}
