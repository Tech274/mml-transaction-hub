// SCRUM-128 C7: the Reports page aggregations, moved verbatim out of components/reports-view.tsx
// (plan R1: calculations are not touched) so tests can pin them. The base totals and forecast stay
// in lib/reports-metrics.ts.
import { MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { reportLineCost, type ReportRow } from "@/lib/reports-metrics";
import { kpiPeriodFor, type KpiPeriod } from "@/lib/kpi-period";

type Row = ReportRow;
export const REPORTS_ALL = "__all__";
const ALL = REPORTS_ALL;

/** Year / provider / LOB filter ("__all__" = no filter). */
export function filterReportRows(
  rows: readonly Row[],
  year: string,
  provider: string,
  lob: string,
): Row[] {
  return rows.filter(
    (r) =>
      (year === ALL || r.year === Number(year)) &&
      (provider === ALL || r.cloud_provider === provider) &&
      (lob === ALL || r.line_of_business === lob),
  );
}

/** Revenue by provider per calendar month (Cloud cost chart). */
export function reportsByMonthProvider(filtered: readonly Row[]) {
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

/** Top 10 labs by revenue. */
export function reportsTopLabs(filtered: readonly Row[]) {
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

/** Revenue, cost and profit per provider. */
export function reportsProviderTotals(filtered: readonly Row[]) {
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

/** Customer profitability, most profitable first. */
export function reportsCustomers(filtered: readonly Row[]) {
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

/** Margin by line of business. */
export function reportsMarginByLob(filtered: readonly Row[]) {
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

/** Margin by provider (from reportsProviderTotals). */
export function reportsMarginByProvider(providerTotals: ReturnType<typeof reportsProviderTotals>) {
  return providerTotals.map((p) => ({
    key: p.provider,
    revenue: p.spend,
    cost: p.cost,
    profit: p.profit,
    margin: p.spend > 0 ? (p.profit / p.spend) * 100 : 0,
  }));
}

/** The period the totals tiles cover: the chosen calendar year, or the "reports.totals" rule. */
export function reportsFilterPeriod(year: string): KpiPeriod {
  return year === ALL
    ? kpiPeriodFor("reports.totals")
    : { kind: "year", year: Number(year), basis: "calendar" };
}
