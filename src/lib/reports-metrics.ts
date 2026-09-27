// Pure metric helpers for the Reports view. Kept dependency-free so they can be
// unit-tested and reused by both the UI and Excel export.

export type ReportRow = {
  month: number;
  year: number;
  repository_type: string;
  cloud_provider: string;
  line_of_business: string;
  customer_name: string;
  lab_name: string;
  total_users: number;
  input_cost: number;
  selling_cost: number;
  start_date?: string | null;
  end_date?: string | null;
};

export function computeTotals(rows: ReportRow[]) {
  const revenue = rows.reduce((s, r) => s + Number(r.selling_cost ?? 0), 0);
  const cost = rows.reduce((s, r) => s + Number(r.input_cost ?? 0), 0);
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return { revenue, cost, profit, margin, count: rows.length };
}

export function groupByKey<T extends ReportRow>(
  rows: T[],
  keyFn: (r: T) => string,
) {
  const map = new Map<string, { key: string; rows: T[]; revenue: number; cost: number }>();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = map.get(k) ?? { key: k, rows: [], revenue: 0, cost: 0 };
    cur.rows.push(r);
    cur.revenue += Number(r.selling_cost ?? 0);
    cur.cost += Number(r.input_cost ?? 0);
    map.set(k, cur);
  }
  return Array.from(map.values()).map((g) => ({
    ...g,
    profit: g.revenue - g.cost,
    margin: g.revenue > 0 ? ((g.revenue - g.cost) / g.revenue) * 100 : 0,
  }));
}

// Simple monthly revenue forecast. Each transaction row is assumed to represent
// a monthly recurring line item (selling_cost / input_cost per month). We
// project forward from the given `from` month through each row's end_date,
// grouping totals by year-month.
export function computeForecast(
  rows: ReportRow[],
  from: Date = new Date(),
  horizonMonths = 12,
) {
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const buckets: { key: string; year: number; month: number; revenue: number; cost: number }[] = [];
  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      revenue: 0,
      cost: 0,
    });
  }

  for (const r of rows) {
    if (!r.end_date) continue;
    const end = new Date(r.end_date);
    if (isNaN(end.getTime())) continue;
    for (const b of buckets) {
      const bDate = new Date(b.year, b.month - 1, 1);
      const bEnd = new Date(b.year, b.month, 0);
      if (bDate > end) break;
      // start_date optional — only skip if strictly after bucket end
      if (r.start_date) {
        const sd = new Date(r.start_date);
        if (!isNaN(sd.getTime()) && sd > bEnd) continue;
      }
      b.revenue += Number(r.selling_cost ?? 0);
      b.cost += Number(r.input_cost ?? 0);
    }
  }

  return buckets.map((b) => ({
    ...b,
    profit: b.revenue - b.cost,
    margin: b.revenue > 0 ? ((b.revenue - b.cost) / b.revenue) * 100 : 0,
  }));
}

export function forecastByDimension(
  rows: ReportRow[],
  dim: "customer_name" | "lab_name" | "cloud_provider",
  from?: Date,
  horizonMonths = 12,
) {
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = (r as unknown as Record<string, string>)[dim] ?? "—";
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  return Array.from(groups.entries()).map(([key, subset]) => {
    const monthly = computeForecast(subset, from, horizonMonths);
    const revenue = monthly.reduce((s, m) => s + m.revenue, 0);
    const cost = monthly.reduce((s, m) => s + m.cost, 0);
    return {
      key,
      monthly,
      revenue,
      cost,
      profit: revenue - cost,
      margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}
