// SCRUM-62: the pre/post-change fingerprint (supabase/tests/reports/pre_change_fingerprint.sql)
// run against the local in-process Postgres with every migration applied. Synthetic data only.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createLocalDb } from "@/test-support/local-db";

const SQL = readFileSync(path.resolve(__dirname, "../../../supabase/tests/reports/pre_change_fingerprint.sql"), "utf8");
type Row = { section: string; object: string; n: number | string | null; fingerprint: string | null };
const key = (r: Row) => `${r.section}/${r.object}`;

let db: PGlite;
let tables: string[];

async function fingerprint(): Promise<Map<string, Row>> {
  const r = await db.query<Row>(SQL);
  return new Map(r.rows.map((row) => [key(row), row]));
}
function diff(a: Map<string, Row>, b: Map<string, Row>): string[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys]
    .filter((k) => JSON.stringify(a.get(k)) !== JSON.stringify(b.get(k)))
    .sort();
}

beforeAll(async () => {
  db = await createLocalDb();
  await db.exec("insert into storage.buckets (id, name) values ('bulk-imports', 'bulk-imports') on conflict do nothing");
  tables = (
    await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') order by 1`,
    )
  ).rows.map((r) => r.relname);
}, 120_000);

describe("pre-change fingerprint (SCRUM-62)", () => {
  it("is a single read-only statement (runs inside a READ ONLY transaction)", async () => {
    await db.exec("begin transaction read only");
    try {
      await expect(db.query(SQL)).resolves.toBeTruthy();
    } finally {
      await db.exec("rollback");
    }
    const code = SQL.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate|alter\s|drop\s|create\s|grant\s|revoke\s)/i);
  });

  it("covers every public table in each per-table section, plus functions, storage and migrations", async () => {
    const fp = await fingerprint();
    for (const section of ["data", "columns", "policies", "grants"]) {
      const got = [...fp.values()].filter((r) => r.section === section).map((r) => r.object).sort();
      expect(got, section).toEqual(tables);
    }
    expect(tables.length).toBeGreaterThan(20);
    expect(fp.get("functions/public.*")?.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(fp.get("storage/bulk-imports")).toMatchObject({ n: expect.anything() });
    expect(fp.get("migrations/supabase_migrations.schema_migrations")?.fingerprint).toBe("(no migration history table)");
    expect(Number(fp.get("data/customers")?.n)).toBe(0);
  });

  it("is stable: two runs with no change are identical", async () => {
    expect(diff(await fingerprint(), await fingerprint())).toEqual([]);
  });

  it("a data change moves only that table's data row", async () => {
    const before = await fingerprint();
    await db.exec("begin");
    try {
      await db.exec("insert into public.freshdesk_tickets (id, subject, status) values (424242, 'Synthetic', 'Open')");
      const after = await fingerprint();
      expect(diff(before, after)).toEqual(["data/freshdesk_tickets"]);
      expect(Number(after.get("data/freshdesk_tickets")?.n)).toBe(Number(before.get("data/freshdesk_tickets")?.n) + 1);
    } finally {
      await db.exec("rollback");
    }
  });

  it("a schema, policy, grant, function or storage change shows up in the right section", async () => {
    const before = await fingerprint();
    await db.exec("begin");
    try {
      await db.exec(`
        alter table public.sync_runs add column scratch_col integer;
        create policy scratch_policy on public.customers for select to authenticated using (false);
        grant insert on public.report_snapshots to authenticated;
        create function public.scratch_fn() returns int language sql as 'select 1';
        insert into storage.objects (bucket_id, name, metadata) values ('bulk-imports', 'a/b.csv', '{"eTag":"x"}');
      `);
      expect(diff(before, await fingerprint())).toEqual([
        "columns/sync_runs",
        "functions/public.*",
        "grants/report_snapshots",
        "policies/customers",
        "storage/bulk-imports",
      ]);
    } finally {
      await db.exec("rollback");
    }
    expect(diff(before, await fingerprint())).toEqual([]);
  });

  it("returns counts and hashes only, never row contents", async () => {
    await db.exec("begin");
    try {
      await db.exec("insert into public.freshdesk_tickets (id, subject, status) values (515151, 'VERY-SECRET-SUBJECT', 'Open')");
      const out = JSON.stringify((await db.query(SQL)).rows);
      expect(out).not.toContain("VERY-SECRET-SUBJECT");
    } finally {
      await db.exec("rollback");
    }
  });
});
