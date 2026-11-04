// SCRUM-131 tests only: the narrow UntypedDb view (src/lib/strict-import/db-client.ts) backed by PGlite, so
// the server-function logic in approval-queries.ts runs against the real migrations, RLS and SECURITY DEFINER
// functions as a given user. Each call runs in its own transaction as that user (like one PostgREST request).
// `readOnly: true` runs every request in a READ ONLY transaction: any write fails. Every SQL text is logged.
// `maxRows` mimics PostgREST's db-max-rows (Supabase default 1000): a table read never returns more rows than that,
// whatever range was asked for.
import type { PGlite } from "@electric-sql/pglite";
import type { Actor } from "./local-db";
import type { DbError, UntypedDb, UntypedQuery } from "@/lib/strict-import/db-client";

export interface PgUntypedDb extends UntypedDb {
  log: string[];
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

function isoDates(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

export function pgUntypedDb(db: PGlite, actor: Actor, opts: { readOnly?: boolean; maxRows?: number } = {}): PgUntypedDb {
  const log: string[] = [];
  // One PGlite connection: requests run one after another (Promise.all callers still work).
  let chain: Promise<unknown> = Promise.resolve();
  function run<R>(sql: string, params: unknown[]): Promise<{ data: R[] | null; error: DbError | null }> {
    const next = chain.then(() => runNow<R>(sql, params));
    chain = next.catch(() => undefined);
    return next;
  }
  async function runNow<R>(sql: string, params: unknown[]): Promise<{ data: R[] | null; error: DbError | null }> {
    log.push(sql);
    await db.exec(opts.readOnly ? "begin read only" : "begin");
    try {
      const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await db.exec(`set local role ${actor.role}`);
      const r = await db.query<Record<string, unknown>>(sql, params);
      await db.exec("commit");
      return { data: r.rows.map(isoDates) as R[], error: null };
    } catch (e) {
      await db.exec("rollback");
      return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } };
    }
  }

  function query<T>(table: string): UntypedQuery<T> {
    let columns = "*";
    const where: string[] = [];
    const params: unknown[] = [];
    const orders: string[] = [];
    let limitN: number | null = null;
    let offsetN = 0;
    const sql = () => {
      const cap = opts.maxRows === undefined ? limitN : Math.min(limitN ?? opts.maxRows, opts.maxRows);
      const order = orders.length ? ` order by ${orders.join(", ")}` : "";
      const limit = `${cap === null ? "" : ` limit ${cap}`}${offsetN ? ` offset ${offsetN}` : ""}`;
      return `select ${columns} from public.${ident(table)}${where.length ? ` where ${where.join(" and ")}` : ""}${order}${limit}`;
    };
    const exec = async () => {
      const r = await run<Record<string, unknown>>(sql(), params);
      return { data: (r.data as unknown as T) ?? null, error: r.error };
    };
    const q: UntypedQuery<T> = {
      select(cols) {
        columns = cols
          .split(",")
          .map((c) => ident(c.trim()))
          .join(", ");
        return q;
      },
      eq(col, v) {
        params.push(v);
        where.push(`${ident(col)} = $${params.length}`);
        return q;
      },
      in(col, vs) {
        params.push(vs);
        where.push(`${ident(col)}::text = any($${params.length}::text[])`);
        return q;
      },
      is(col) {
        where.push(`${ident(col)} is null`);
        return q;
      },
      order(col, o) {
        orders.push(`${ident(col)} ${o?.ascending === false ? "desc" : "asc"}`);
        return q;
      },
      limit(n) {
        limitN = Math.trunc(n);
        return q;
      },
      range(from, to) {
        limitN = Math.trunc(to - from + 1);
        offsetN = Math.trunc(from);
        return q;
      },
      maybeSingle() {
        return exec().then((r) => ({ data: (Array.isArray(r.data) ? (r.data[0] ?? null) : null) as never, error: r.error }));
      },
      then(onF, onR) {
        return exec().then(onF, onR);
      },
    };
    return q;
  }

  return {
    log,
    rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const named = keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ");
      // PostgREST sends JSON arrays; here a JS array becomes a Postgres array literal (e.g. app_role[]).
      const vals = keys.map((k) => {
        const v = args[k];
        return Array.isArray(v) ? `{${v.map((x) => `"${String(x).replace(/["\\]/g, "\\$&")}"`).join(",")}}` : v;
      });
      return run<{ r: T }>(`select public.${ident(fn)}(${named}) as r`, vals).then((res) => ({ data: res.data ? (res.data[0]?.r ?? null) : null, error: res.error }));
    },
    from: query,
  };
}
