// SCRUM-131 (Peter's ask): ONE Complete/Incomplete rule everywhere. Synthetic cases only.
//  - TS: isTransactionComplete(row) === !isIncompleteTransaction(row)
//  - SQL: the generated column transactions.is_complete (expression read back from the catalog after all
//    migrations, plus the held-back supabase/migrations-pending/scrum131_is_complete_rule.sql "REQUIRES CHIEF GO", loaded explicitly) and import_row_is_incomplete(jsonb)
//    (20261006070000) agree with TS.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createLocalDb } from "@/test-support/local-db";
import { INCOMPLETE_PRICE_FIELDS, REQUIRED_TRANSACTION_FIELDS, isIncompleteTransaction, isTransactionComplete } from "@/lib/transaction-completeness";

type Case = {
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  cloud_provider: string | null;
  input_cost: number | null;
  selling_cost: number | null;
  system_config: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
};

const BASE: Case = {
  potential_id: "SYN-PAR-1",
  month: 3,
  year: 2026,
  customer_name: "Parity Synthetic Co",
  lab_name: "Parity Lab",
  cloud_provider: "AWS",
  input_cost: 10,
  selling_cost: 20,
  system_config: "8GB 2vCPUs",
  line_of_business: "VILT",
  start_date: "2026-03-01",
  end_date: "2026-03-31",
  total_users: 5,
};

const BLANKS = [null, "", " ", "\t", "\u00a0", " \u2003 ", "\ufeff"];

function cases(): Case[] {
  const out: Case[] = [BASE];
  for (const f of ["potential_id", "customer_name", "lab_name", "cloud_provider", "system_config", "line_of_business"] as const) {
    for (const b of BLANKS) out.push({ ...BASE, [f]: b });
    out.push({ ...BASE, [f]: "  padded value  " });
  }
  for (const f of ["month", "year", "total_users"] as const) out.push({ ...BASE, [f]: null });
  for (const f of ["start_date", "end_date"] as const) out.push({ ...BASE, [f]: null });
  for (const f of INCOMPLETE_PRICE_FIELDS) for (const v of [null, 0, 0.01, 1, 99999.99]) out.push({ ...BASE, [f]: v });
  // Deterministic mixed combinations.
  let seed = 131;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  for (let i = 0; i < 300; i++) {
    out.push({
      potential_id: pick(["SYN-P", ...BLANKS]),
      month: pick([1, 12, null]),
      year: pick([2026, null]),
      customer_name: pick(["Mixed Synthetic", ...BLANKS]),
      lab_name: pick(["Mixed Lab", null, " "]),
      cloud_provider: pick(["AWS", "SAP", "Oracle", null, " "]),
      input_cost: pick([null, 0, 0.5, 100]),
      selling_cost: pick([null, 0, 0.5, 100]),
      system_config: pick([null, "4GB", " "]),
      line_of_business: pick([null, "VILT"]),
      start_date: pick([null, "2026-01-01"]),
      end_date: pick([null, "2026-01-31"]),
      total_users: pick([null, 0, 3]),
    });
  }
  return out;
}

describe("is_complete parity (TS rule = DB column = staged-row function)", () => {
  let db: PGlite;
  let expr: string;
  const all = cases();

  beforeAll(async () => {
    // The held migration is NOT in supabase/migrations (Chief GO); load it explicitly for the parity check.
    db = await createLocalDb({ extraSqlFiles: ["supabase/migrations-pending/scrum131_is_complete_rule.sql"] });
    const r = await db.query<{ e: string }>(
      `select pg_get_expr(d.adbin, d.adrelid) e
         from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = 'public.transactions'::regclass and a.attname = 'is_complete'`,
    );
    expr = r.rows[0].e;
  }, 120_000);

  it("the case set covers both outcomes and every required field", () => {
    expect(all.filter((c) => isIncompleteTransaction(c)).length).toBeGreaterThan(50);
    expect(all.filter((c) => !isIncompleteTransaction(c)).length).toBeGreaterThan(20);
    for (const f of REQUIRED_TRANSACTION_FIELDS) expect(all.some((c) => c[f] === null)).toBe(true);
  });

  it("TS: isTransactionComplete === !isIncompleteTransaction for every case and either cloud kind", () => {
    for (const c of all) {
      for (const lab_type of ["public_cloud", "private_cloud", null]) {
        expect(isTransactionComplete({ ...c, lab_type })).toBe(!isIncompleteTransaction(c));
      }
    }
  });

  it("SQL: the stored is_complete expression gives the same answer as TS for every case", async () => {
    expect(expr).toMatch(/input_cost/);
    expect(expr).not.toMatch(/system_config|line_of_business|total_users|start_date|end_date/);
    const res = await db.query<{ i: number; v: boolean }>(
      `select (x->>'i')::int i, (${expr}) v
         from jsonb_array_elements($1::jsonb) x,
              lateral jsonb_to_record(x) as t(potential_id text, month integer, year integer, customer_name text,
                lab_name text, cloud_provider text, input_cost numeric, selling_cost numeric, system_config text,
                line_of_business text, start_date date, end_date date, total_users integer, lab_type text)`,
      [JSON.stringify(all.map((c, i) => ({ ...c, i })))],
    );
    expect(res.rows).toHaveLength(all.length);
    const mismatches = res.rows.filter((r) => r.v !== !isIncompleteTransaction(all[r.i])).map((r) => all[r.i]);
    expect(mismatches).toEqual([]);
  });

  it("SQL: rows actually stored in transactions get the same is_complete as TS", async () => {
    const storable = all
      .filter((c) => ["AWS", "SAP", "Oracle"].includes(c.cloud_provider ?? "") && (c.line_of_business === null || c.line_of_business === "VILT") && c.total_users !== 0)
      .slice(0, 120);
    await db.exec("begin");
    try {
      const got: { want: boolean; v: boolean }[] = [];
      for (const c of storable) {
        const labType = ["SAP", "Oracle"].includes(c.cloud_provider!) ? "private_cloud" : "public_cloud";
        const r = await db.query<{ is_complete: boolean }>(
          `insert into public.transactions (potential_id, month, year, customer_name, lab_name, lab_type, repository_type,
             cloud_provider, system_config, line_of_business, start_date, end_date, total_users, input_cost, selling_cost)
           values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning is_complete`,
          [c.potential_id, c.month, c.year, c.customer_name, c.lab_name, labType, c.cloud_provider, c.system_config, c.line_of_business, c.start_date, c.end_date, c.total_users, c.input_cost, c.selling_cost],
        );
        got.push({ want: !isIncompleteTransaction(c), v: r.rows[0].is_complete });
      }
      expect(got.filter((g) => g.want !== g.v)).toEqual([]);
      expect(got.some((g) => g.v) && got.some((g) => !g.v)).toBe(true);
    } finally {
      await db.exec("rollback");
    }
  });

  it("SQL: import_row_is_incomplete(jsonb) agrees with isIncompleteTransaction (prices as staged strings too)", async () => {
    const rows = all.map((c) => ({ ...c, input_cost: c.input_cost === null ? null : c.input_cost.toFixed(2), selling_cost: c.selling_cost === null ? null : c.selling_cost.toFixed(2) }));
    const res = await db.query<{ i: number; v: boolean }>(
      "select (ord - 1)::int i, public.import_row_is_incomplete(x) v from jsonb_array_elements($1::jsonb) with ordinality as e(x, ord)",
      [JSON.stringify(rows)],
    );
    const mismatches = res.rows.filter((r) => r.v !== isIncompleteTransaction(rows[r.i])).map((r) => rows[r.i]);
    expect(mismatches).toEqual([]);
  });
});
