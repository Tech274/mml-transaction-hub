// SCRUM-70: the same synthetic transactions must give the same totals on every
// surface that computes them (Dashboard/Reports, snapshot job, MCP reports_summary).
// Synthetic data only.
import { describe, it, expect } from "vitest";
import { computeTotals, groupByKey, type ReportRow } from "../reports-metrics";
import { aggregateSnapshots } from "../sync.server";

function synthetic(n: number): ReportRow[] {
  const providers = ["AWS", "Azure", "GCP"];
  const lobs = ["VILT", "Standalone", "Integrated"];
  return Array.from({ length: n }, (_, i) => ({
    month: (i % 12) + 1,
    year: 2026,
    repository_type: i % 5 === 0 ? "private_cloud" : "public_cloud",
    cloud_provider: providers[i % 3],
    line_of_business: lobs[i % 3],
    customer_name: `Synthetic Customer ${i % 17}`,
    lab_name: `Synthetic Lab ${i % 7}`,
    total_users: (i % 9) + 1,
    input_cost: ((i * 37) % 1000) + 0.25,
    selling_cost: ((i * 53) % 1500) + 0.75,
    start_date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
    end_date: `2026-${String((i % 12) + 1).padStart(2, "0")}-28`,
  }));
}

// The MCP reports_summary formula (src/lib/mcp/tools/reports-summary.ts).
function mcpSummary(rows: ReportRow[]) {
  const revenue = rows.reduce((a, r) => a + Number(r.selling_cost ?? 0), 0);
  const cost = rows.reduce((a, r) => a + Number(r.input_cost ?? 0), 0);
  const profit = revenue - cost;
  return { revenue, cost, profit, margin_pct: revenue > 0 ? (profit / revenue) * 100 : 0, transactions: rows.length };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("KPI reconciliation (synthetic, 2,345 rows: more than one 1,000-row page)", () => {
  const rows = synthetic(2345);
  const totals = computeTotals(rows);

  it("Dashboard/Reports totals equal the snapshot job's totals", () => {
    const snaps = aggregateSnapshots(rows.map((r) => ({ ...r })));
    const snapRevenue = snaps.reduce((a, s) => a + s.revenue, 0);
    const snapCost = snaps.reduce((a, s) => a + s.cost, 0);
    const snapCount = snaps.reduce((a, s) => a + s.transactions_count, 0);
    expect(round2(snapRevenue)).toBe(round2(totals.revenue));
    expect(round2(snapCost)).toBe(round2(totals.cost));
    expect(snapCount).toBe(totals.count);
  });

  it("MCP reports_summary formula matches Dashboard/Reports", () => {
    const m = mcpSummary(rows);
    expect(round2(m.revenue)).toBe(round2(totals.revenue));
    expect(round2(m.profit)).toBe(round2(totals.profit));
    expect(m.margin_pct).toBeCloseTo(totals.margin, 9);
    expect(m.transactions).toBe(totals.count);
  });

  it("per-provider, per-customer and per-month breakdowns add up to the total", () => {
    for (const key of [(r: ReportRow) => r.cloud_provider, (r: ReportRow) => r.customer_name, (r: ReportRow) => `${r.year}-${r.month}`]) {
      const g = groupByKey(rows, key);
      expect(round2(g.reduce((a, x) => a + x.revenue, 0))).toBe(round2(totals.revenue));
      expect(round2(g.reduce((a, x) => a + x.cost, 0))).toBe(round2(totals.cost));
      expect(g.reduce((a, x) => a + x.rows.length, 0)).toBe(rows.length);
    }
  });

  it("profit = revenue - cost and margin = profit / revenue", () => {
    expect(totals.profit).toBeCloseTo(totals.revenue - totals.cost, 6);
    expect(totals.margin).toBeCloseTo((totals.profit / totals.revenue) * 100, 9);
    expect(computeTotals([]).margin).toBe(0);
  });

  it("KNOWN DIFFERENCE (pending finance decision): period is year/month on Dashboard/Reports but start_date year in MCP", () => {
    // A line entered for Jan 2026 whose lab started in Dec 2025.
    const r: ReportRow = { ...rows[0], year: 2026, month: 1, start_date: "2025-12-15" };
    const inReports2026 = [r].filter((x) => x.year === 2026).length;
    const inMcp2026 = [r].filter((x) => (x.start_date ?? "").startsWith("2026")).length;
    expect(inReports2026).toBe(1);
    expect(inMcp2026).toBe(0);
  });
});
