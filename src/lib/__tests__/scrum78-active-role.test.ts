// SCRUM-78: the pending role-check migration is not on the live path. This applies it
// to the in-process Postgres (synthetic users only) and checks the rollback.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createLocalDb } from "@/test-support/local-db";

const ROOT = path.resolve(__dirname, "../../..");
const PENDING = path.join(ROOT, "supabase/migrations-pending/scrum78_role_check_respects_active.sql");
const ROLLBACK = path.join(ROOT, "supabase/migrations-pending/scrum78_role_check_respects_active.rollback.sql");

const ACTIVE = "00000000-0000-4000-8000-0000000000a1";
const INACTIVE = "00000000-0000-4000-8000-0000000000a2";

let db: PGlite;

async function flag(userId: string, fn: "has_role" | "has_any_role", role: string): Promise<boolean> {
  const sql = fn === "has_role"
    ? `select public.has_role($1::uuid, $2::public.app_role) as ok`
    : `select public.has_any_role($1::uuid, ARRAY[$2::public.app_role]) as ok`;
  const r = await db.query<{ ok: boolean }>(sql, [userId, role]);
  return r.rows[0].ok;
}

async function grants(fn: "has_role(uuid, public.app_role)" | "has_any_role(uuid, public.app_role[])") {
  const r = await db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(
    `select has_function_privilege('anon', $1, 'execute') as anon,
            has_function_privilege('authenticated', $1, 'execute') as authenticated,
            has_function_privilege('service_role', $1, 'execute') as service_role`,
    [`public.${fn}`],
  );
  return r.rows[0];
}

beforeAll(async () => {
  db = await createLocalDb();
  await db.query("insert into auth.users (id, email) values ($1, 'active@example.test'), ($2, 'inactive@example.test')", [ACTIVE, INACTIVE]);
  await db.exec("delete from public.user_roles");
  await db.query("insert into public.user_roles (user_id, role) values ($1, 'viewer'::public.app_role), ($2, 'viewer'::public.app_role)", [ACTIVE, INACTIVE]);
  await db.query("update public.profiles set is_active = false where id = $1", [INACTIVE]);
}, 120_000);

describe("pending has_role / has_any_role active check", () => {
  it("denies an inactive user, leaves an active user unchanged, and rollback restores the old check", async () => {
    const beforeRole = await grants("has_role(uuid, public.app_role)");
    const beforeAny = await grants("has_any_role(uuid, public.app_role[])");

    expect(await flag(ACTIVE, "has_any_role", "viewer")).toBe(true);
    expect(await flag(INACTIVE, "has_any_role", "viewer")).toBe(true);
    expect(await flag(ACTIVE, "has_role", "viewer")).toBe(true);
    expect(await flag(INACTIVE, "has_role", "viewer")).toBe(true);

    await db.exec(readFileSync(PENDING, "utf8"));

    expect(await flag(ACTIVE, "has_any_role", "viewer")).toBe(true);
    expect(await flag(INACTIVE, "has_any_role", "viewer")).toBe(false);
    expect(await flag(ACTIVE, "has_role", "viewer")).toBe(true);
    expect(await flag(INACTIVE, "has_role", "viewer")).toBe(false);
    expect(await flag(ACTIVE, "has_any_role", "admin")).toBe(false);

    const attrs = await db.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[] | null }>(
      `select p.proname, p.prosecdef, p.provolatile, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('has_role', 'has_any_role')
        order by p.proname`,
    );
    expect(attrs.rows).toHaveLength(2);
    for (const row of attrs.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.provolatile).toBe("s");
      expect(row.proconfig?.some((c) => c.replace(/\s/g, "").startsWith("search_path="))).toBe(true);
    }
    expect(await grants("has_role(uuid, public.app_role)")).toEqual(beforeRole);
    expect(await grants("has_any_role(uuid, public.app_role[])")).toEqual(beforeAny);
    expect(beforeAny.anon).toBe(false);
    expect(beforeAny.authenticated).toBe(true);

    await db.exec(readFileSync(ROLLBACK, "utf8"));

    expect(await flag(ACTIVE, "has_any_role", "viewer")).toBe(true);
    expect(await flag(INACTIVE, "has_any_role", "viewer")).toBe(true);
    expect(await flag(ACTIVE, "has_role", "viewer")).toBe(true);
    expect(await flag(INACTIVE, "has_role", "viewer")).toBe(true);
    expect(await grants("has_any_role(uuid, public.app_role[])")).toEqual(beforeAny);
  });
});
