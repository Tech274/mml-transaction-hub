// SCRUM-131: the new tables and functions (20261006070000) are not in the generated
// src/integrations/supabase/types.ts yet (regenerate after the migration is applied). Until then the
// server functions use this narrow, explicitly typed view of the user's own Supabase client: the
// same session, so auth.uid(), RLS and every SECURITY DEFINER check apply exactly as before.
export interface DbError {
  message: string;
  code?: string;
}

export interface UntypedQuery<T> extends PromiseLike<{ data: T | null; error: DbError | null }> {
  select(columns: string): UntypedQuery<T>;
  eq(column: string, value: unknown): UntypedQuery<T>;
  in(column: string, values: unknown[]): UntypedQuery<T>;
  is(column: string, value: null): UntypedQuery<T>;
  order(column: string, opts?: { ascending?: boolean }): UntypedQuery<T>;
  limit(n: number): UntypedQuery<T>;
  range(from: number, to: number): UntypedQuery<T>;
  maybeSingle(): PromiseLike<{ data: T extends (infer U)[] ? U | null : T | null; error: DbError | null }>;
}

export interface UntypedDb {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: T | null; error: DbError | null }>;
  from<T = unknown[]>(table: string): UntypedQuery<T>;
}

export function untyped(client: unknown): UntypedDb {
  return client as UntypedDb;
}
