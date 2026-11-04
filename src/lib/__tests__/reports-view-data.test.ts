// SCRUM-128 C7: pins for the Reports aggregations, written BEFORE the Reports rewrite. The oracles
// below are the pre-C7 useMemo bodies of components/reports-view.tsx, copied verbatim (generated
// from git, not retyped).
import { describe, expect, it } from "vitest";
import { MONTH_NAMES, YEARS } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { computeTotals, reportLineCost, type ReportRow } from "@/lib/reports-metrics";
import {
  REPORTS_ALL as ALL,
  filterReportRows,
  reportsByMonthProvider,
  reportsCustomers,
  reportsMarginByLob,
  reportsFilterPeriod,
  reportsMarginByProvider,
  reportsProviderTotals,
  reportsTopLabs,
} from "@/lib/reports-view-data";

type Row = ReportRow;

// ---- pre-C7 code, verbatim -------------------------------------------------------------------
function oldFilter(rows: Row[], year: string, provider: string, lob: string) {
  return rows.filter(
    (r) =>
      (year === ALL || r.year === Number(year)) &&
      (provider === ALL || r.cloud_provider === provider) &&
      (lob === ALL || r.line_of_business === lob),
  );
}
function old_byMonthProvider(filtered: Row[]) {
  const providerSet = Array.from(
    new Set(filtered.map((r) => r.cloud_provider).filter(Boolean)),
  ).sort();
  return {
    providers: providerSet,
    data: MONTH_NAMES.map((label, i) => {
      const rec: Record<string, string | number> = { month: label };
      for (const p of providerSet) {
        rec[p] = filtered
          .filter((r) => r.month === i + 1 && r.cloud_provider === p)
          .reduce((s, r) => addNullable(s, r.selling_cost), 0);
      }
      return rec;
    }),
  };
}
function old_topLabs(filtered: Row[]) {
  const map = new Map<string, { lab: string; provider: string; spend: number; users: number }>();
  for (const r of filtered) {
    const key = `${r.lab_name}||${r.cloud_provider}`;
    const cur = map.get(key) ?? {
      lab: r.lab_name,
      provider: r.cloud_provider,
      spend: 0,
      users: 0,
    };
    cur.spend = addNullable(cur.spend, r.selling_cost);
    cur.users = addNullable(cur.users, r.total_users);
    map.set(key, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 10);
}
function old_providerTotals(filtered: Row[]) {
  const map = new Map<string, { provider: string; spend: number; cost: number; profit: number }>();
  for (const r of filtered) {
    const cur = map.get(r.cloud_provider) ?? {
      provider: r.cloud_provider,
      spend: 0,
      cost: 0,
      profit: 0,
    };
    cur.spend = addNullable(cur.spend, r.selling_cost);
    cur.cost = addNullable(cur.cost, reportLineCost(r));
    cur.profit = cur.spend - cur.cost;
    map.set(r.cloud_provider, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
}
function old_customers(filtered: Row[]) {
  const map = new Map<
    string,
    {
      customer: string;
      revenue: number;
      cost: number;
      profit: number;
      margin: number;
      tx: number;
      users: number;
    }
  >();
  for (const r of filtered) {
    const cur = map.get(r.customer_name) ?? {
      customer: r.customer_name,
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
      tx: 0,
      users: 0,
    };
    cur.revenue = addNullable(cur.revenue, r.selling_cost);
    cur.cost = addNullable(cur.cost, reportLineCost(r));
    cur.tx += 1;
    cur.users = addNullable(cur.users, r.total_users);
    cur.profit = cur.revenue - cur.cost;
    cur.margin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;
    map.set(r.customer_name, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.profit - a.profit);
}
function old_marginByLob(filtered: Row[]) {
  const map = new Map<string, { key: string; revenue: number; cost: number }>();
  for (const r of filtered) {
    const cur = map.get(r.line_of_business) ?? { key: r.line_of_business, revenue: 0, cost: 0 };
    cur.revenue = addNullable(cur.revenue, r.selling_cost);
    cur.cost = addNullable(cur.cost, reportLineCost(r));
    map.set(r.line_of_business, cur);
  }
  return Array.from(map.values())
    .map((x) => ({
      key: x.key,
      revenue: x.revenue,
      cost: x.cost,
      profit: x.revenue - x.cost,
      margin: x.revenue > 0 ? ((x.revenue - x.cost) / x.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
function old_marginByProvider(providerTotals: ReturnType<typeof old_providerTotals>) {
  return providerTotals.map((p) => ({
    key: p.provider,
    revenue: p.spend,
    cost: p.cost,
    profit: p.profit,
    margin: p.spend > 0 ? (p.profit / p.spend) * 100 : 0,
  }));
}
// ----------------------------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const PROVIDERS = ["AWS", "Azure", "GCP", "Oracle", "SAP"];
function rows(seed: number): Row[] {
  const r = rng(seed);
  const maybe = <T>(v: T, p = 0.15) => (r() < p ? null : v);
  return Array.from({ length: Math.floor(r() * 60) }, (_, i) => ({
    id: `r-${seed}-${i}`,
    potential_id: `POT-${i}`,
    month: 1 + Math.floor(r() * 12),
    year: YEARS[Math.floor(r() * YEARS.length)],
    repository_type: r() < 0.5 ? "public_cloud" : "private_cloud",
    cloud_provider: PROVIDERS[Math.floor(r() * PROVIDERS.length)],
    line_of_business: ["VILT", "Standalone", "Integrated"][Math.floor(r() * 3)],
    customer_name: ["Acme Learning", "Beta Labs", "Gamma Skills", "Delta Edu"][Math.floor(r() * 4)],
    lab_name: ["Lab A", "Lab B", "Lab C", "Lab D", "Lab E", "Lab F"][Math.floor(r() * 6)],
    total_users: maybe(Math.floor(r() * 50)),
    input_cost: maybe(Math.round(r() * 90000)),
    input_cost_auto: maybe(Math.round(r() * 90000), 0.5),
    input_cost_actual_alloc: maybe(Math.round(r() * 90000), 0.7),
    selling_cost: maybe(Math.round(r() * 120000)),
    start_date: null,
    end_date: null,
    is_deleted: false,
  })) as unknown as Row[];
}

describe("SCRUM-128 C7 Reports aggregations", () => {
  it("equal the pre-C7 useMemo bodies on 200 random fixtures and every filter", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const all = rows(seed);
      for (const year of [ALL, String(YEARS[0]), String(YEARS[YEARS.length - 1])])
        for (const provider of [ALL, "AWS"])
          for (const lob of [ALL, "VILT"]) {
            const f = filterReportRows(all, year, provider, lob);
            expect(f).toEqual(oldFilter(all, year, provider, lob));
            expect(reportsByMonthProvider(f)).toEqual(old_byMonthProvider(f));
            expect(reportsTopLabs(f)).toEqual(old_topLabs(f));
            const pt = reportsProviderTotals(f);
            expect(pt).toEqual(old_providerTotals(f));
            expect(reportsCustomers(f)).toEqual(old_customers(f));
            expect(reportsMarginByLob(f)).toEqual(old_marginByLob(f));
            expect(reportsMarginByProvider(pt)).toEqual(old_marginByProvider(pt));
          }
    }
  });

  it("literal pins", () => {
    const base = rows(3)[0];
    const data = [
      {
        ...base,
        year: 2026,
        cloud_provider: "AWS",
        customer_name: "Acme Learning",
        selling_cost: 100000,
        input_cost: 60000,
        input_cost_auto: null,
        input_cost_actual_alloc: null,
        total_users: 10,
      },
      {
        ...base,
        year: 2026,
        cloud_provider: "Azure",
        customer_name: "Beta Labs",
        selling_cost: 50000,
        input_cost: 40000,
        input_cost_auto: null,
        input_cost_actual_alloc: null,
        total_users: 5,
      },
      {
        ...base,
        year: 2025,
        cloud_provider: "AWS",
        customer_name: "Acme Learning",
        selling_cost: 999,
        input_cost: 1,
        input_cost_auto: null,
        input_cost_actual_alloc: null,
        total_users: 1,
      },
    ] as Row[];
    const f = filterReportRows(data, "2026", ALL, ALL);
    expect(f).toHaveLength(2);
    const totals = computeTotals(f);
    expect(totals.revenue).toBe(150000);
    expect(totals.cost).toBe(100000);
    expect(totals.profit).toBe(50000);
    expect(totals.margin.toFixed(1)).toBe("33.3");
    expect(reportsProviderTotals(f).map((p) => [p.provider, p.spend, p.cost, p.profit])).toEqual([
      ["AWS", 100000, 60000, 40000],
      ["Azure", 50000, 40000, 10000],
    ]);
    expect(reportsCustomers(f)[0]).toMatchObject({
      customer: "Acme Learning",
      profit: 40000,
      margin: 40,
    });
  });

  it("the totals tiles name the filter period", () => {
    expect(reportsFilterPeriod("2026")).toEqual({ kind: "year", year: 2026, basis: "calendar" });
    expect(reportsFilterPeriod(ALL)).toEqual({ kind: "all-time" });
  });
});
