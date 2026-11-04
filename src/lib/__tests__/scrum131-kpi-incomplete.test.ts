// SCRUM-131: server-side summaries expose the Incomplete count and value (Peter's shared rule).
import { describe, expect, it } from "vitest";
import { INCOMPLETE_RULE_COLUMNS, incompleteKpi } from "@/lib/kpi-incomplete";
import { REQUIRED_TRANSACTION_FIELDS, isIncompleteTransaction } from "@/lib/transaction-completeness";
import { synthetic131Rows } from "@/test-support/scrum131-fixture";

const src = import.meta.glob("/src/lib/mcp/tools/reports-summary.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const asTx = () =>
  synthetic131Rows().map((r) => ({
    potential_id: r.potentialId,
    month: r.month,
    year: r.year,
    customer_name: r.customer,
    lab_name: r.lab,
    cloud_provider: r.provider,
    total_users: r.users,
    input_cost: r.input,
    selling_cost: r.selling,
  }));

describe("incompleteKpi", () => {
  it("counts the synthetic file's 248 Incomplete rows and their value; nothing is excluded", () => {
    const rows = asTx();
    const k = incompleteKpi(rows, { canViewFinanceTotals: true });
    const inc = rows.filter((r) => isIncompleteTransaction(r));
    expect(k.incomplete_transactions).toBe(248);
    expect(k.complete_transactions).toBe(94);
    expect(k.incomplete_transactions + k.complete_transactions).toBe(rows.length);
    expect(k.incomplete_revenue).toBe(inc.reduce((a, r) => a + r.selling_cost, 0));
    expect(k.incomplete_input_cost).toBe(inc.reduce((a, r) => a + r.input_cost, 0));
    expect(k.incomplete_users).toBe(inc.reduce((a, r) => a + r.total_users, 0));
    expect(k.incomplete_note).toMatch(/^248 of 342 transactions are Incomplete/);
    expect(k.incomplete_note).toMatch(/included in these totals/);
  });

  it("hides the value when finance totals are hidden, and has no note when all rows are complete", () => {
    const rows = asTx();
    expect(incompleteKpi(rows, { canViewFinanceTotals: false })).toMatchObject({ incomplete_transactions: 248, incomplete_revenue: null, incomplete_input_cost: null });
    expect(incompleteKpi(rows.slice(248), { canViewFinanceTotals: true })).toMatchObject({ incomplete_transactions: 0, incomplete_note: null });
  });

  it("uses an injected input-cost function (effective cost) for the value", () => {
    const k = incompleteKpi(asTx(), { canViewFinanceTotals: true, inputCostOf: () => 1 });
    expect(k.incomplete_input_cost).toBe(248);
  });

  it("the column list covers every field the shared rule reads", () => {
    for (const f of [...REQUIRED_TRANSACTION_FIELDS, "input_cost", "selling_cost"]) expect(INCOMPLETE_RULE_COLUMNS).toContain(f);
  });

  it("reports_summary selects those fields and returns the Incomplete figures", () => {
    const code = src["/src/lib/mcp/tools/reports-summary.ts"];
    for (const f of REQUIRED_TRANSACTION_FIELDS) expect(code).toContain(f);
    expect(code).toContain("incompleteKpi(rows");
    expect(code).toContain("...incomplete");
  });
});
