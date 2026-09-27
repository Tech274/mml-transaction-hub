// SCRUM-57: an in-process Postgres (PGlite, WASM) with every migration in supabase/migrations
// applied on top of a small Supabase stand-in (supabase/tests/local/platform-stub.sql).
// Tests only. It never connects to sandbox or live and holds synthetic data only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const ROOT = path.resolve(__dirname, "../..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const STUB = path.join(ROOT, "supabase/tests/local/platform-stub.sql");

/** pg_cron / pg_net are not available in PGlite; the stub provides the functions the migrations call. */
function prepare(sql: string): string {
  return sql.replace(/create extension if not exists pg_(cron|net)[^;]*;/gi, "");
}

export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export async function createLocalDb(opts: { extraSqlFiles?: string[] } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(readFileSync(STUB, "utf8"));
  for (const f of migrationFiles()) {
    try {
      await db.exec(prepare(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  for (const f of opts.extraSqlFiles ?? []) await db.exec(readFileSync(path.resolve(ROOT, f), "utf8"));
  return db;
}

export type Actor = { role: "anon" } | { role: "authenticated"; userId: string } | { role: "service_role" };

/**
 * Runs `fn` as the given actor inside a transaction that is always rolled back,
 * the same way PostgREST sets the role and JWT claims for a request.
 */
export async function asActor<T>(db: PGlite, actor: Actor, fn: (q: PGlite) => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${actor.role}`);
    return await fn(db);
  } finally {
    await db.exec("rollback");
  }
}

/** Resolves to the Postgres error code, or "ok" when the statement succeeded. */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
}
