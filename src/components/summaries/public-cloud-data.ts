// SCRUM-128 C6: the Public cloud view's data shaping, moved verbatim out of
// public-cloud-summary.tsx so dashboard-style value pins can cover it (plan R1: calculations are
// not touched). buildPublicSummary takes an optional `now` (default new Date(), as before).
import { MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { isIncompleteTransaction, splitByCompleteness } from "@/lib/transaction-completeness";
import {
  completenessTabCounts,
  filterByCompletenessTab,
  type CompletenessTab,
} from "@/lib/completeness-tabs";
import { dataMonthsOf, kpiPeriodFor, rowsInKpiPeriod } from "@/lib/kpi-period";

export type PublicCloudRow = {
  id: string;
  potential_id: string | null;
  customer_name: string | null;
  lab_name: string | null;
  cloud_provider: string | null;
  line_of_business: string | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_auto: number | null;
  input_cost_actual_alloc: number | null;
  total_users: number | null;
  start_date: string | null;
  end_date: string | null;
  public_credit_allocated: number | null;
  public_actual_consumption: number | null;
  public_unused_credit: number | null;
  month: number | null;
  year: number | null;
};

export const EXAMPLE_ROWS: PublicCloudRow[] = [
  {
    id: "tx-1",
    potential_id: "DEMO-PUB-001",
    customer_name: "Cognizant",
    lab_name: "DevOps Pro",
    cloud_provider: "Azure",
    line_of_business: "VILT",
    selling_cost: 67600,
    input_cost: 48200,
    input_cost_auto: null,
    input_cost_actual_alloc: 46850,
    total_users: 42,
    start_date: "2026-09-01",
    end_date: "2026-09-28",
    public_credit_allocated: 52000,
    public_actual_consumption: 46850,
    public_unused_credit: 5150,
    month: 9,
    year: 2026,
  },
  {
    id: "tx-2",
    potential_id: "DEMO-PUB-002",
    customer_name: "Infosys",
    lab_name: "Data Engineering",
    cloud_provider: "AWS",
    line_of_business: "Standalone",
    selling_cost: 57500,
    input_cost: 39100,
    input_cost_auto: null,
    input_cost_actual_alloc: 38920,
    total_users: 30,
    start_date: "2026-09-03",
    end_date: "2026-09-26",
    public_credit_allocated: 43000,
    public_actual_consumption: 38920,
    public_unused_credit: 4080,
    month: 9,
    year: 2026,
  },
  {
    id: "tx-3",
    potential_id: "DEMO-PUB-003",
    customer_name: "TCS",
    lab_name: "AI Foundations",
    cloud_provider: "Azure",
    line_of_business: "VILT",
    selling_cost: 96500,
    input_cost: 73400,
    input_cost_auto: null,
    input_cost_actual_alloc: 72130,
    total_users: 55,
    start_date: "2026-09-05",
    end_date: "2026-09-30",
    public_credit_allocated: 76000,
    public_actual_consumption: 72130,
    public_unused_credit: 3870,
    month: 9,
    year: 2026,
  },
  {
    id: "tx-4",
    potential_id: "DEMO-PUB-004",
    customer_name: "Wipro",
    lab_name: "Kubernetes Ops",
    cloud_provider: "GCP",
    line_of_business: "Standalone",
    selling_cost: 44600,
    input_cost: 28800,
    input_cost_auto: null,
    input_cost_actual_alloc: 28240,
    total_users: 24,
    start_date: "2026-08-02",
    end_date: "2026-08-22",
    public_credit_allocated: 31500,
    public_actual_consumption: 28240,
    public_unused_credit: 3260,
    month: 8,
    year: 2026,
  },
  {
    id: "tx-5",
    potential_id: "DEMO-PUB-005",
    customer_name: "Capgemini",
    lab_name: "Platform SRE",
    cloud_provider: "Azure",
    line_of_business: "Integrated",
    selling_cost: 35200,
    input_cost: 22900,
    input_cost_auto: null,
    input_cost_actual_alloc: 21980,
    total_users: 20,
    start_date: "2026-08-10",
    end_date: "2026-08-27",
    public_credit_allocated: 25000,
    public_actual_consumption: 21980,
    public_unused_credit: 3020,
    month: 8,
    year: 2026,
  },
];

export function lineCost(
  row: Pick<PublicCloudRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">,
): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

// SCRUM-131 (plan §4.11): every figure below the Completeness card is built from the rows
// of the selected tab (All / Complete / Incomplete), so the tabs filter the whole view.
export function buildPublicSummary(rows: PublicCloudRow[], now: Date = new Date()) {
  const nowTs = now.getTime();
  const nextWeekTs = nowTs + 7 * 24 * 60 * 60 * 1000;
  const currentYear = now.getFullYear();
  const availableYears = rows
    .map((row) => row.year)
    .filter((value): value is number => typeof value === "number");
  const chartYear = availableYears.includes(currentYear)
    ? currentYear
    : (availableYears.sort((a, b) => b - a)[0] ?? currentYear);
  const revenue = rows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
  const inputCost = rows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
  const profit = revenue - inputCost;
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
  const runningNow = rows.filter((row) => {
    if (!row.start_date || !row.end_date) return false;
    const start = new Date(row.start_date).getTime();
    const end = new Date(row.end_date).getTime();
    return start <= nowTs && end >= nowTs;
  }).length;
  const endingSoon = rows.filter((row) => {
    if (!row.end_date) return false;
    const end = new Date(row.end_date).getTime();
    return end >= nowTs && end <= nextWeekTs;
  }).length;
  const creditUsed = rows.reduce((sum, row) => addNullable(sum, row.public_actual_consumption), 0);
  // SCRUM-131: Complete / Incomplete (shared rule). Incomplete rows stay in every total above.
  const completeness = splitByCompleteness(rows, lineCost);
  const incompleteRows = rows.filter((row) => isIncompleteTransaction(row));
  const incompleteRevenue = incompleteRows.reduce(
    (sum, row) => addNullable(sum, row.selling_cost),
    0,
  );
  const incompleteCost = incompleteRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
  const incompleteCredit = incompleteRows.reduce(
    (sum, row) => addNullable(sum, row.public_actual_consumption),
    0,
  );

  const byMonth = Array.from({ length: 12 }, (_, idx) => {
    const month = idx + 1;
    const monthRows = rows.filter((row) => row.month === month && row.year === chartYear);
    const monthRevenue = monthRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
    const monthCost = monthRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
    return {
      month: MONTH_NAMES[idx].slice(0, 3),
      monthLabel: `${MONTH_NAMES[idx].slice(0, 3)} ${String(chartYear).slice(2)}`,
      revenue: monthRevenue,
      cost: monthCost,
    };
  });

  const providerRevenueMap = new Map<string, number>();
  const providerCreditMap = new Map<string, { used: number; allocated: number }>();
  const lobMap = new Map<string, number>();
  const statusMap = new Map<string, number>();
  const customerMap = new Map<string, number>();
  for (const row of rows) {
    // SCRUM-129: a blank provider is shown as "No provider" (needs fixing), never as a real provider.
    const provider = row.cloud_provider?.trim() || "No provider";
    providerRevenueMap.set(
      provider,
      addNullable(providerRevenueMap.get(provider) ?? 0, row.selling_cost),
    );
    const creditStats = providerCreditMap.get(provider) ?? { used: 0, allocated: 0 };
    creditStats.used = addNullable(creditStats.used, row.public_actual_consumption);
    creditStats.allocated = addNullable(creditStats.allocated, row.public_credit_allocated);
    providerCreditMap.set(provider, creditStats);

    const lob = row.line_of_business ?? "Unknown";
    lobMap.set(lob, (lobMap.get(lob) ?? 0) + 1);

    const customer = row.customer_name ?? "Unknown";
    customerMap.set(customer, addNullable(customerMap.get(customer) ?? 0, row.selling_cost));

    const start = row.start_date ? new Date(row.start_date).getTime() : null;
    const end = row.end_date ? new Date(row.end_date).getTime() : null;
    const status =
      start == null || end == null
        ? "Unscheduled"
        : start > nowTs
          ? "Upcoming"
          : end < nowTs
            ? "Completed"
            : "Running";
    statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
  }

  return {
    rows,
    revenue,
    inputCost,
    profit,
    marginPct,
    runningNow,
    endingSoon,
    creditUsed,
    completeness,
    incompleteRevenue,
    incompleteCost,
    incompleteProfit: incompleteRevenue - incompleteCost,
    incompleteCredit,
    chartYear,
    byMonth,
    providerRevenue: [...providerRevenueMap.entries()].map(([name, value]) => ({
      name,
      value,
    })),
    providerCredit: [...providerCreditMap.entries()].map(([name, value]) => ({
      name,
      used: value.used,
      allocated: value.allocated,
      utilizationPct:
        value.allocated > 0 ? Number(((value.used / value.allocated) * 100).toFixed(1)) : 0,
    })),
    lobSplit: [...lobMap.entries()].map(([name, value]) => ({ name, value })),
    statusSplit: [...statusMap.entries()].map(([name, value]) => ({ name, value })),
    topCustomers: [...customerMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };
}

/**
 * The page pipeline (was the component's useMemo chain, unchanged): periods from the rules table,
 * the view built from the tab-filtered rows of the totals period, and the completeness card and
 * tab counts from the completeness period. Tab counts therefore equal splitByCompleteness counts.
 */
export function publicCloudView(
  allRows: PublicCloudRow[],
  tab: CompletenessTab,
  now: Date = new Date(),
) {
  const months = dataMonthsOf(allRows);
  const totalsPeriod = kpiPeriodFor("cloud.totals", months);
  const livePeriod = kpiPeriodFor("cloud.live", months);
  const completenessPeriod = kpiPeriodFor("cloud.completeness", months);
  const view = buildPublicSummary(
    filterByCompletenessTab(rowsInKpiPeriod(allRows, totalsPeriod), tab),
    now,
  );
  const completenessRows = rowsInKpiPeriod(allRows, completenessPeriod);
  const cardSplit = splitByCompleteness(completenessRows, lineCost);
  const tabCounts = completenessTabCounts(completenessRows);
  return { totalsPeriod, livePeriod, completenessPeriod, view, cardSplit, tabCounts };
}
