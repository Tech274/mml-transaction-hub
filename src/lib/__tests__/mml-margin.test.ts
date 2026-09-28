import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createLocalDb, outcome } from "@/test-support/local-db";

const U = {
  admin: "00000000-0000-4000-8000-000000000001",
  ops: "00000000-0000-4000-8000-000000000003",
  viewer: "00000000-0000-4000-8000-000000000007",
} as const;
const CUSTOMER = "00000000-0000-4000-8000-0000000000c1";
const BATCH = "00000000-0000-4000-8000-0000000000b1";
const as = (userId: string) => ({ role: "authenticated" as const, userId });

let db: PGlite;

beforeAll(async () => {
  db = await createLocalDb();
  await db.query("insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)", [
    U.admin,
    "admin@example.test",
    U.ops,
    "ops@example.test",
    U.viewer,
    "viewer@example.test",
  ]);
  await db.exec("delete from public.user_roles");
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'admin'::app_role), ($2, 'ops_user'::app_role), ($3, 'viewer'::app_role)",
    [U.admin, U.ops, U.viewer],
  );
  await db.query(
    "insert into public.customers (id, customer_name, normalized_name, created_by) values ($1, 'Synthetic Co', 'synthetic co', $2)",
    [CUSTOMER, U.admin],
  );
}, 120_000);

async function insertLine(id: string, input: number | null, selling = 5500) {
  await db.query(
    `insert into public.transactions (
       id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type,
       cloud_provider, line_of_business, start_date, end_date, total_users, selling_cost, input_cost,
       created_by, lab_batch_id
     ) values ($1, $2, 9, 2026, $3, 'Synthetic Co', 'Azure Admin Batch Lab', 'public_cloud',
       'Azure', 'VILT', '2026-09-01', '2026-09-30', 10, $4, $5, $6, $7)`,
    [id, `SYN-${id.slice(-2)}`, CUSTOMER, selling, input, U.admin, BATCH],
  );
}

describe("margin routine", () => {
  it("fills 3 of 10 gaps with the batch mean and allocates the invoice", async () => {
    await db.query(
      `insert into public.lab_batches (id, batch_code, name, status, created_by)
       values ($1, 'LB-TEST-GAP', 'Vivek example', 'open', $2)`,
      [BATCH, U.admin],
    );
    for (let i = 1; i <= 10; i++) {
      const id = `00000000-0000-4000-8000-0000000000${i.toString(16).padStart(2, "0")}`;
      await insertLine(id, i <= 7 ? 2500 : null);
    }
    await db.query(
      `update public.lab_batches set status = 'closed_estimated', closed_at = now(), closed_by = $2 where id = $1`,
      [BATCH, U.admin],
    );
    await db.query(
      `insert into public.lab_batch_invoices (
         lab_batch_id, vendor, invoice_ref, invoice_date, currency, amount, amount_inr, is_final, source, created_by
       ) values ($1, 'Contoso Cloud', 'INV-TEST', '2026-09-20', 'INR', 25000, 25000, true, 'vendor_invoice', $2)`,
      [BATCH, U.admin],
    );
    const first = await db.query<{ recompute_lab_batch_costs: { status: string } }>(
      "select public.recompute_lab_batch_costs($1, 'invoice')",
      [BATCH],
    );
    expect(first.rows[0].recompute_lab_batch_costs.status).toBe("applied");

    const lines = await db.query<{
      input_cost: string | null;
      input_cost_auto: string | null;
      alloc: string | null;
    }>(
      "select input_cost::text, input_cost_auto::text, input_cost_actual_alloc::text as alloc from public.transactions where lab_batch_id = $1 order by id",
      [BATCH],
    );
    const autos = lines.rows.filter((r) => r.input_cost == null);
    expect(autos).toHaveLength(3);
    expect(autos.every((r) => Number(r.input_cost_auto) === 2500)).toBe(true);
    expect(lines.rows.every((r) => Number(r.alloc) === 2500)).toBe(true);

    const batch = await db.query<{ revenue: string; actual: string; auto_n: number }>(
      "select revenue_total::text as revenue, actual_cost_total::text as actual, auto_line_count as auto_n from public.lab_batches where id = $1",
      [BATCH],
    );
    expect(Number(batch.rows[0].revenue)).toBe(55000);
    expect(Number(batch.rows[0].actual)).toBe(25000);
    expect(batch.rows[0].auto_n).toBe(3);
    expect(Number(batch.rows[0].revenue) - Number(batch.rows[0].actual)).toBe(30000);

    const second = await db.query<{ recompute_lab_batch_costs: { status: string } }>(
      "select public.recompute_lab_batch_costs($1, 'nightly')",
      [BATCH],
    );
    expect(second.rows[0].recompute_lab_batch_costs.status).toBe("unchanged");
  });

  it("rejects a USD invoice without an FX rate", async () => {
    const other = "00000000-0000-4000-8000-0000000000b2";
    await db.query(
      "insert into public.lab_batches (id, batch_code, status) values ($1, 'LB-TEST-USD', 'closed_estimated')",
      [other],
    );
    const code = await outcome(
      db.query(
        `insert into public.lab_batch_invoices (
         lab_batch_id, vendor, invoice_date, currency, amount, amount_inr
       ) values ($1, 'Vendor', '2026-09-01', 'USD', 300, 300)`,
        [other],
      ),
    );
    expect(code).not.toBe("ok");
  });
});

describe("catalog and hybrid access", () => {
  it("hides drafts from a viewer and blocks an ops write of the auto-fill column", async () => {
    await db.query(
      `insert into public.lab_catalog (title, lab_type, status) values
         ('Published Lab', 'public_cloud', 'published'),
         ('Draft Lab', 'public_cloud', 'draft')`,
    );
    const viewerRows = await asActor(db, as(U.viewer), (q) =>
      q.query<{ title: string }>("select title from public.lab_catalog order by title"),
    );
    expect(viewerRows.rows.map((r) => r.title)).toEqual(["Published Lab"]);

    const tx = "00000000-0000-4000-8000-0000000000aa";
    await db.query(
      `insert into public.transactions (
         id, potential_id, month, year, customer_id, customer_name, lab_name, lab_type,
         cloud_provider, line_of_business, start_date, end_date, total_users, selling_cost, input_cost, created_by
       ) values ($1, 'SYN-GUARD', 9, 2026, $2, 'Synthetic Co', 'Guard Lab', 'public_cloud',
         'AWS', 'VILT', '2026-09-01', '2026-09-30', 2, 100, 40, $3)`,
      [tx, CUSTOMER, U.ops],
    );
    const denied = await asActor(db, as(U.ops), (q) =>
      outcome(q.query("update public.transactions set input_cost_auto = 9 where id = $1", [tx])),
    );
    expect(denied).toBe("42501");

    const tags = await asActor(db, as(U.ops), (q) =>
      q.query("select * from public.transaction_tags"),
    );
    expect(tags.rows).toEqual([]);
  });
});
