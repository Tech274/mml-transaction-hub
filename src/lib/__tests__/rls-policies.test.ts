// SCRUM-57 (G-02, G-13): access-rule (RLS) tests against a local in-process Postgres with every
// migration applied. Synthetic data only; never touches sandbox or live.
// See docs/rls-audit.md for the table-by-table audit these tests pin.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createLocalDb, outcome } from "@/test-support/local-db";

const U = {
  admin: "00000000-0000-4000-8000-000000000001",
  opsLead: "00000000-0000-4000-8000-000000000002",
  opsUser: "00000000-0000-4000-8000-000000000003",
  opsUser2: "00000000-0000-4000-8000-000000000004",
  finance: "00000000-0000-4000-8000-000000000005",
  leadership: "00000000-0000-4000-8000-000000000006",
  viewer: "00000000-0000-4000-8000-000000000007",
  noRole: "00000000-0000-4000-8000-000000000008",
} as const;
const ROLE_OF: Partial<Record<keyof typeof U, string>> = {
  admin: "admin", opsLead: "ops_lead", opsUser: "ops_user", opsUser2: "ops_user",
  finance: "finance", leadership: "leadership", viewer: "viewer",
};
const CUSTOMER = "00000000-0000-4000-8000-0000000000c1";
const TX_BY_OPS2 = "00000000-0000-4000-8000-0000000000a1";

const as = (userId: string) => ({ role: "authenticated" as const, userId });
const count = async (q: PGlite, table: string) => Number((await q.query<{ n: number }>(`select count(*)::int n from public.${table}`)).rows[0].n);

let db: PGlite;

beforeAll(async () => {
  db = await createLocalDb();
  for (const [k, id] of Object.entries(U)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${k}@example.test`]);
  }
  // handle_new_user makes the very first user admin; reset and assign roles explicitly.
  await db.exec("delete from public.user_roles");
  for (const [k, role] of Object.entries(ROLE_OF)) {
    await db.query("insert into public.user_roles (user_id, role) values ($1, $2::app_role)", [U[k as keyof typeof U], role]);
  }
  await db.query("insert into public.customers (id, customer_name, normalized_name, created_by) values ($1, 'Synthetic Co', 'synthetic co', $2)", [CUSTOMER, U.opsUser2]);
  await db.query(
    `insert into public.transactions (id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type, repository_type,
       cloud_provider, line_of_business, start_date, end_date, total_users, selling_cost, input_cost, created_by)
     values ($1, 'SYN-1', 3, 2026, $2, 'Synthetic Co', 'Lab A', 'public_cloud', 'public_cloud', 'AWS', 'VILT', '2026-03-01', '2026-03-31', 5, 250, 100, $3)`,
    [TX_BY_OPS2, CUSTOMER, U.opsUser2],
  );
  const run = await db.query<{ id: string }>("insert into public.sync_runs (kind, trigger_source, status) values ('snapshot', 'cron', 'success') returning id");
  await db.query(
    `insert into public.report_snapshots (run_id, year, month, customer_name, lab_name, cloud_provider, line_of_business, revenue, cost, profit)
     values ($1, 2026, 3, 'Synthetic Co', 'Lab A', 'AWS', 'VILT', 250, 100, 150)`,
    [run.rows[0].id],
  );
  await db.query("insert into public.freshdesk_tickets (id, subject, status) values (1001, 'Synthetic ticket', 'Open')");
}, 120_000);

describe("structure", () => {
  it("every table in public has row level security enabled", async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity`,
    );
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });

  it("anon holds no privilege on any public table", async () => {
    const r = await db.query<{ t: string }>(
      `select distinct table_name t from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(r.rows.map((x) => x.t)).toEqual([]);
  });

  it("no permissive policy lets anon/authenticated read or delete everything (USING true)", async () => {
    const r = await db.query<{ tablename: string; policyname: string; cmd: string }>(
      `select tablename, policyname, cmd from pg_policies
        where schemaname = 'public' and permissive = 'PERMISSIVE' and qual = 'true'
          and cmd in ('ALL','SELECT','DELETE','UPDATE')
          and roles && array['anon','authenticated','public']::name[]`,
    );
    expect(r.rows).toEqual([]);
  });

  it("every SECURITY DEFINER function pins search_path and none is executable by anon", async () => {
    const r = await db.query<{ proname: string; pinned: boolean; anon: boolean }>(
      `select p.proname, coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false) pinned,
              has_function_privilege('anon', p.oid, 'execute') anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef`,
    );
    expect(r.rows.filter((x) => !x.pinned).map((x) => x.proname)).toEqual([]);
    expect(r.rows.filter((x) => x.anon).map((x) => x.proname)).toEqual([]);
  });
});

describe("logged out (anon)", () => {
  it.each(["transactions", "customers", "report_snapshots", "sync_runs", "freshdesk_tickets", "profiles", "user_roles"])(
    "cannot read %s",
    async (t) => {
      expect(await asActor(db, { role: "anon" }, (q) => outcome(q.query(`select * from public.${t}`)))).toBe("42501");
    },
  );
  it("cannot run the fuzzy transaction search", async () => {
    expect(await asActor(db, { role: "anon" }, (q) => outcome(q.query("select * from public.fuzzy_search_transactions('syn', 0.1, 5)")))).toBe("42501");
  });
});

describe("signed in without any role (new accounts get none)", () => {
  it.each(["transactions", "customers", "report_snapshots", "sync_runs", "freshdesk_tickets", "ai_cc_inbox", "config_master", "role_permissions", "account_managers"])(
    "sees no rows in %s",
    async (t) => {
      expect(await asActor(db, as(U.noRole), (q) => count(q, t))).toBe(0);
    },
  );
  it("cannot grant itself a role", async () => {
    const r = await asActor(db, as(U.noRole), (q) => outcome(q.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [U.noRole])));
    expect(r).toBe("42501");
  });
  it.each(["report_snapshots", "sync_runs"])("cannot delete from %s", async (t) => {
    const after = await asActor(db, as(U.noRole), async (q) => {
      await outcome(q.query(`delete from public.${t}`));
      return null;
    });
    expect(after).toBeNull();
    expect(await count(db, t)).toBe(1);
  });
});

describe("finance data (transactions)", () => {
  it.each(["admin", "opsLead", "opsUser", "finance", "leadership", "viewer"] as const)("%s can read transactions", async (k) => {
    expect(await asActor(db, as(U[k]), (q) => count(q, "transactions"))).toBe(1);
  });
  it.each(["finance", "leadership", "viewer", "noRole"] as const)("%s cannot create a transaction", async (k) => {
    const r = await asActor(db, as(U[k]), (q) =>
      outcome(
        q.query(
          `insert into public.transactions (potential_id, month, year, customer_id, customer_name, lab_name, lab_type, repository_type,
             cloud_provider, line_of_business, start_date, end_date, total_users, selling_cost, created_by)
           values ('SYN-2', 3, 2026, $1, 'Synthetic Co', 'Lab B', 'public_cloud', 'public_cloud', 'AWS', 'VILT', '2026-03-01', '2026-03-31', 1, 10, $2)`,
          [CUSTOMER, U[k]],
        ),
      ),
    );
    expect(r).toBe("42501");
  });
  it("ops_user cannot edit a transaction someone else created; ops_lead can", async () => {
    const byOps = await asActor(db, as(U.opsUser), async (q) => {
      const r = await q.query("update public.transactions set total_users = 99 where id = $1", [TX_BY_OPS2]);
      return r.affectedRows;
    });
    expect(byOps).toBe(0);
    const byLead = await asActor(db, as(U.opsLead), async (q) => {
      const r = await q.query("update public.transactions set total_users = 99 where id = $1", [TX_BY_OPS2]);
      return r.affectedRows;
    });
    expect(byLead).toBe(1);
  });
  it("nobody deletes transactions from the browser (soft delete only)", async () => {
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query("delete from public.transactions")))).toBe("42501");
    expect(await count(db, "transactions")).toBe(1);
  });
});

describe("audit tables are written by triggers only", () => {
  it.each(["role_audit_log", "permission_audit_log", "customer_audit_log", "transaction_activity_log"])("admin cannot insert into %s", async (t) => {
    const r = await asActor(db, as(U.admin), (q) => outcome(q.query(`insert into public.${t} default values`)));
    expect(r).toBe("42501");
  });
  it("editing a transaction as ops_lead writes an activity row through the trigger", async () => {
    const n = await asActor(db, as(U.opsLead), async (q) => {
      await q.query("update public.transactions set lab_name = 'Lab A2' where id = $1", [TX_BY_OPS2]);
      await q.exec("reset role");
      return count(q, "transaction_activity_log");
    });
    expect(n).toBeGreaterThan(0);
  });
});

describe("profiles", () => {
  it("a user sees only their own profile", async () => {
    expect(await asActor(db, as(U.viewer), (q) => count(q, "profiles"))).toBe(1);
  });
  it("a user can change their own name but not their email or active flag", async () => {
    expect(await asActor(db, as(U.viewer), (q) => outcome(q.query("update public.profiles set full_name = 'X' where id = $1", [U.viewer])))).toBe("ok");
    expect(await asActor(db, as(U.viewer), (q) => outcome(q.query("update public.profiles set is_active = false where id = $1", [U.viewer])))).toBe("42501");
    expect(await asActor(db, as(U.viewer), (q) => outcome(q.query("update public.profiles set email = 'x@y.test' where id = $1", [U.viewer])))).toBe("42501");
  });
});

describe("Freshdesk tickets and AI Command Center tables", () => {
  it("roled users read tickets; nobody writes them from the browser", async () => {
    expect(await asActor(db, as(U.viewer), (q) => count(q, "freshdesk_tickets"))).toBe(1);
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query("update public.freshdesk_tickets set subject = 'x'")))).toBe("42501");
  });
  it.each(["ai_cc_inbox", "ai_cc_runs", "ai_cc_audit", "ai_cc_lab_requests"])("%s is read-only for signed-in users", async (t) => {
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query(`delete from public.${t}`)))).toBe("42501");
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query(`insert into public.${t} default values`)))).toBe("42501");
  });
});

describe("grants match policies (SCRUM-57 migration 20260928010000)", () => {
  it("authenticated holds no INSERT/UPDATE/DELETE privilege that no policy uses", async () => {
    const r = await db.query<{ t: string; p: string }>(
      `select g.table_name t, g.privilege_type p
         from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.grantee = 'authenticated'
          and g.privilege_type in ('INSERT','UPDATE','DELETE')
          and not exists (
            select 1 from pg_policies pol
             where pol.schemaname = 'public' and pol.tablename = g.table_name
               and pol.permissive = 'PERMISSIVE'
               and pol.roles && array['authenticated','public']::name[]
               and (pol.cmd = g.privilege_type or pol.cmd = 'ALL')
               and coalesce(pol.qual, '') <> 'false' and coalesce(pol.with_check, '') <> 'false')
        order by 1, 2`,
    );
    expect(r.rows.map((x) => `${x.t}.${x.p}`)).toEqual([]);
  });
  it("nobody signed in or out holds TRIGGER or REFERENCES on our tables", async () => {
    const r = await db.query<{ t: string }>(
      `select table_name t from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type in ('TRIGGER','REFERENCES')`,
    );
    expect(r.rows).toEqual([]);
  });
  it("signed-in users can still run the fuzzy transaction search", async () => {
    expect(await asActor(db, as(U.viewer), (q) => outcome(q.query("select * from public.fuzzy_search_transactions('syn', 0.1, 5)")))).toBe("ok");
  });
});

describe("agent identities are written by the server only (SCRUM-102, migration 20260928020000)", () => {
  const seed = async () => {
    await db.query(
      `insert into public.agent_identities (user_id, agent_name, agent_id, auto_matched) values
         ($1, 'Agent Ops', 11, true), ($2, 'Agent Two', 22, false)
       on conflict (user_id) do nothing`,
      [U.opsUser, U.opsUser2],
    );
  };
  it("a user reads only their own identity; admins read all", async () => {
    await seed();
    const own = await asActor(db, as(U.opsUser), (q) => q.query<{ agent_name: string }>("select agent_name from public.agent_identities"));
    expect(own.rows.map((r) => r.agent_name)).toEqual(["Agent Ops"]);
    const all = await asActor(db, as(U.admin), (q) => q.query("select 1 from public.agent_identities"));
    expect(all.rows.length).toBeGreaterThanOrEqual(2);
  });
  it("a user cannot insert, change or delete an identity directly, even their own", async () => {
    await seed();
    expect(await asActor(db, as(U.opsLead), (q) => outcome(q.query(
      "insert into public.agent_identities (user_id, agent_name, agent_id) values ($1, 'Someone Else', 99)", [U.opsLead])))).toBe("42501");
    expect(await asActor(db, as(U.opsUser), (q) => outcome(q.query(
      "update public.agent_identities set agent_name = 'Someone Else', agent_id = 99 where user_id = $1", [U.opsUser])))).toBe("42501");
    expect(await asActor(db, as(U.opsUser), (q) => outcome(q.query(
      "delete from public.agent_identities where user_id = $1", [U.opsUser])))).toBe("42501");
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query(
      "update public.agent_identities set agent_id = 99 where user_id = $1", [U.opsUser2])))).toBe("42501");
  });
  it("the server (service role) can still save an identity after its checks", async () => {
    const r = await asActor(db, { role: "service_role" }, (q) => outcome(q.query(
      `insert into public.agent_identities (user_id, agent_name, agent_id, auto_matched) values ($1, 'Agent Lead', 33, false)
       on conflict (user_id) do update set agent_name = excluded.agent_name, agent_id = excluded.agent_id`, [U.opsLead])));
    expect(r).toBe("ok");
  });
});

describe("MCP audit log (SCRUM-77, migration 20260928030000)", () => {
  it("signed-in users cannot write audit rows, not even their own; the server can", async () => {
    const row = `insert into public.mcp_tool_audit_log (user_id, tool_name, success) values ($1, 'whoami', true)`;
    expect(await asActor(db, as(U.opsUser), (q) => outcome(q.query(row, [U.opsUser])))).toBe("42501");
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query(row, [U.admin])))).toBe("42501");
    expect(await asActor(db, { role: "service_role" }, (q) => outcome(q.query(row, [U.opsUser])))).toBe("ok");
  });
  it("users read their own rows, admins read all, nobody edits or deletes", async () => {
    await db.query(`insert into public.mcp_tool_audit_log (user_id, tool_name, success) values ($1, 'whoami', true), ($2, 'whoami', true)`, [U.opsUser, U.viewer]);
    const own = await asActor(db, as(U.viewer), (q) => q.query<{ user_id: string }>("select user_id from public.mcp_tool_audit_log"));
    expect(new Set(own.rows.map((r) => r.user_id))).toEqual(new Set([U.viewer]));
    const all = await asActor(db, as(U.admin), (q) => q.query<{ user_id: string }>("select distinct user_id from public.mcp_tool_audit_log"));
    expect(all.rows.length).toBeGreaterThanOrEqual(2);
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query("update public.mcp_tool_audit_log set success = false")))).toBe("42501");
    expect(await asActor(db, as(U.admin), (q) => outcome(q.query("delete from public.mcp_tool_audit_log")))).toBe("42501");
  });
});

describe("existing sandbox SQL checks also pass locally", () => {
  it("supabase/tests/rls/scrum99_profiles_audit.sql", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const sql = readFileSync(path.resolve(__dirname, "../../..", "supabase/tests/rls/scrum99_profiles_audit.sql"), "utf8");
    await expect(db.exec(sql)).resolves.toBeDefined();
    await db.exec("rollback").catch(() => undefined);
  });

  // The lenient rules are in supabase/migrations/20260928031000_scrum103_lenient_import.sql
  // (applied to live 28 Sep), so the local database already has them. Only the
  // pending scrum103_customer_name_normalize.sql is injected, inside the sandbox
  // script's own transaction, and rolled back. It never touches live.
  it("supabase/tests/rls/scrum103_import_batch.sql", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../..");
    const customer = readFileSync(path.join(root, "supabase/migrations-pending/scrum103_customer_name_normalize.sql"), "utf8");
    const sql = readFileSync(path.join(root, "supabase/tests/rls/scrum103_import_batch.sql"), "utf8");
    const begin = sql.match(/^\s*BEGIN\s*;/m);
    expect(begin).not.toBeNull();
    // String#replace treats $$ in the replacement as a single $, which would
    // break the function bodies. A function return value is inserted as-is.
    const combined = sql.replace(begin![0], () => `${begin![0]}\n${customer}\n`);
    await expect(db.exec(combined)).resolves.toBeDefined();
    await db.exec("rollback").catch(() => undefined);
  });
});

// SCRUM-103: the pending customer-name file revokes EXECUTE on its two helpers from
// PUBLIC and anon. The import RPC (SECURITY DEFINER) and the customer trigger (runs as
// the caller) must still work for an ops user, and anon must not call the helpers.
describe("pending scrum103_customer_name_normalize.sql: helper grants", () => {
  let cdb: PGlite;
  beforeAll(async () => {
    cdb = await createLocalDb({ extraSqlFiles: ["supabase/migrations-pending/scrum103_customer_name_normalize.sql"] });
    await cdb.query("insert into auth.users (id, email) values ($1, 'ops@example.test'), ($2, 'viewer@example.test')", [U.opsUser, U.viewer]);
    await cdb.exec("delete from public.user_roles");
    await cdb.query("insert into public.user_roles (user_id, role) values ($1, 'ops_user'::app_role), ($2, 'viewer'::app_role)", [U.opsUser, U.viewer]);
  }, 120_000);

  it("anon and PUBLIC cannot execute the helpers; authenticated and service_role can", async () => {
    const r = await cdb.query<{ fn: string; anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(
      `select p.proname fn,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              coalesce(p.proacl::text, '') ~ '(^|[{,])=X/' pub
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('clean_customer_name', 'normalize_customer_name')
        order by 1`,
    );
    expect(r.rows).toEqual([
      { fn: "clean_customer_name", anon: false, auth: true, svc: true, pub: false },
      { fn: "normalize_customer_name", anon: false, auth: true, svc: true, pub: false },
    ]);
    expect(await asActor(cdb, { role: "anon" }, (q) => outcome(q.query("select public.normalize_customer_name('x')")))).toBe("42501");
    expect(await asActor(cdb, { role: "anon" }, (q) => outcome(q.query("select public.clean_customer_name('x')")))).toBe("42501");
  });

  it("an ops user creating a customer directly goes through the trigger with the new key", async () => {
    const got = await asActor(cdb, as(U.opsUser), async (q) => {
      await q.query("insert into public.customers (customer_name, created_by) values ($1, $2)", ["Grant" + String.fromCharCode(160) + "  Test   Co", U.opsUser]);
      return (await q.query<{ normalized_name: string }>("select normalized_name from public.customers where created_by = $1", [U.opsUser])).rows;
    });
    expect(got).toEqual([{ normalized_name: "grant test co" }]);
  });

  it("an ops user calling import_transactions_batch creates a missing customer (RPC caller path)", async () => {
    const got = await asActor(cdb, as(U.opsUser), async (q) => {
      const res = await q.query<{ r: { inserted: number } }>(
        `select public.import_transactions_batch('public_cloud', 'grants.xlsx', $1, '2.0.0-proposed',
           jsonb_build_array(jsonb_build_object('source_line', 2, 'customer_name', 'Rpc' || chr(160) || ' Grant  Labs', 'lab_name', 'Lab G')),
           '[]'::jsonb) r`,
        ["e".repeat(64)],
      );
      const c = await q.query<{ n: number }>("select count(*)::int n from public.customers where normalized_name = 'rpc grant labs'");
      const t = await q.query<{ n: number }>(
        "select count(*)::int n from public.transactions t join public.customers c on c.id = t.customer_id where c.normalized_name = 'rpc grant labs'",
      );
      return { inserted: res.rows[0].r.inserted, customers: c.rows[0].n, linked: t.rows[0].n };
    });
    expect(got).toEqual({ inserted: 1, customers: 1, linked: 1 });
  });

  it("a viewer still cannot call import_transactions_batch", async () => {
    const got = await asActor(cdb, as(U.viewer), (q) =>
      outcome(q.query("select public.import_transactions_batch('public_cloud', 'v.xlsx', $1, '2.0.0-proposed', jsonb_build_array(jsonb_build_object('source_line', 2, 'customer_name', 'V Co')), '[]'::jsonb)", ["f".repeat(64)])),
    );
    expect(got).toBe("42501");
  });

  it("bulk_import_runs accepts duplicate_strategy 'insert' and still rejects unknown values", async () => {
    const def = await cdb.query<{ d: string }>(
      "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'bulk_import_runs_duplicate_strategy_check'",
    );
    expect(def.rows[0].d).toContain("'insert'");
    expect(def.rows[0].d).not.toContain("'merge'");
  });
});
