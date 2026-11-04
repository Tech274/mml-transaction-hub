// SCRUM-128 C6: the Private cloud view's data shaping, moved verbatim out of
// private-cloud-summary.tsx (plan R1). buildPrivateSummary takes an optional `now`
// (default new Date(), as before).
import { MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { isIncompleteTransaction, splitByCompleteness } from "@/lib/transaction-completeness";
import { PRIVATE_CLOUD_PROVIDERS } from "@/lib/cloud-provider";
import {
  completenessTabCounts,
  filterByCompletenessTab,
  type CompletenessTab,
} from "@/lib/completeness-tabs";
import { dataMonthsOf, kpiPeriodFor, rowsInKpiPeriod } from "@/lib/kpi-period";

export type BatchRow = {
  id: string;
  batch_code: string;
  name: string | null;
  status: string;
  revenue_total: number | null;
  estimated_cost_total: number | null;
  actual_cost_total: number | null;
  flags: string[] | null;
  needs_recompute: boolean;
  updated_at: string;
};

export type TxRow = {
  id: string;
  lab_batch_id: string | null;
  potential_id: string | null;
  lab_name: string | null;
  cloud_provider: string | null;
  total_users: number | null;
  customer_name: string | null;
  month: number | null;
  year: number | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_auto: number | null;
  input_cost_actual_alloc: number | null;
};

export function formatBatchStatus(status: string): string {
  const map: Record<string, string> = {
    open: "Open",
    closed_actual: "Closed",
    closed_estimate: "Closed (Estimate)",
    pending: "Pending",
  };
  return map[status] ?? status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const EXAMPLE_BATCHES: BatchRow[] = [
  {
    id: "pb-1",
    batch_code: "LB-PRIV-0929-A",
    name: "Azure FinOps Cohort",
    status: "open",
    revenue_total: 285000,
    estimated_cost_total: 169500,
    actual_cost_total: 162300,
    flags: ["cost_locked"],
    needs_recompute: false,
    updated_at: "2026-09-29T05:28:00Z",
  },
  {
    id: "pb-2",
    batch_code: "LB-PRIV-0929-B",
    name: "Cloud Security Bootcamp",
    status: "closed_actual",
    revenue_total: 212000,
    estimated_cost_total: 132400,
    actual_cost_total: 128000,
    flags: [],
    needs_recompute: false,
    updated_at: "2026-09-28T15:20:00Z",
  },
  {
    id: "pb-3",
    batch_code: "LB-PRIV-0929-C",
    name: "Data Platform Residency",
    status: "open",
    revenue_total: 196000,
    estimated_cost_total: 118000,
    actual_cost_total: 112200,
    flags: [],
    needs_recompute: true,
    updated_at: "2026-09-27T11:45:00Z",
  },
];

export const EXAMPLE_TRANSACTIONS: TxRow[] = [
  {
    id: "t1",
    potential_id: "DEMO-PRIV-1",
    lab_name: "Demo Lab",
    cloud_provider: "MakeMyLabs Private Cloud",
    total_users: 20,
    lab_batch_id: "pb-1",
    customer_name: "Cognizant",
    month: 9,
    year: 2026,
    selling_cost: 98000,
    input_cost: 60000,
    input_cost_auto: null,
    input_cost_actual_alloc: 58200,
  },
  {
    id: "t2",
    potential_id: "DEMO-PRIV-2",
    lab_name: "Demo Lab",
    cloud_provider: "MakeMyLabs Private Cloud",
    total_users: 20,
    lab_batch_id: "pb-1",
    customer_name: "Infosys",
    month: 9,
    year: 2026,
    selling_cost: 93000,
    input_cost: 51000,
    input_cost_auto: null,
    input_cost_actual_alloc: 47200,
  },
  {
    id: "t3",
    potential_id: "DEMO-PRIV-3",
    lab_name: "Demo Lab",
    cloud_provider: "MakeMyLabs Private Cloud",
    total_users: 20,
    lab_batch_id: "pb-1",
    customer_name: "TCS",
    month: 9,
    year: 2026,
    selling_cost: 94000,
    input_cost: 57500,
    input_cost_auto: null,
    input_cost_actual_alloc: 56900,
  },
  {
    id: "t4",
    potential_id: "DEMO-PRIV-4",
    lab_name: "Demo Lab",
    cloud_provider: "Oracle",
    total_users: 20,
    lab_batch_id: "pb-2",
    customer_name: "Wipro",
    month: 8,
    year: 2026,
    selling_cost: 106000,
    input_cost: 65000,
    input_cost_auto: null,
    input_cost_actual_alloc: 64200,
  },
  {
    id: "t5",
    potential_id: "DEMO-PRIV-5",
    lab_name: "Demo Lab",
    cloud_provider: "Oracle",
    total_users: 20,
    lab_batch_id: "pb-2",
    customer_name: "HCL",
    month: 8,
    year: 2026,
    selling_cost: 106000,
    input_cost: 64000,
    input_cost_auto: null,
    input_cost_actual_alloc: 63800,
  },
  {
    id: "t6",
    potential_id: "DEMO-PRIV-6",
    lab_name: "Demo Lab",
    cloud_provider: "SAP",
    total_users: 20,
    lab_batch_id: "pb-3",
    customer_name: "Accenture",
    month: 7,
    year: 2026,
    selling_cost: 98000,
    input_cost: 56000,
    input_cost_auto: null,
    input_cost_actual_alloc: 55300,
  },
  {
    id: "t7",
    potential_id: "DEMO-PRIV-7",
    lab_name: "Demo Lab",
    cloud_provider: "MakeMyLabs Private Cloud",
    total_users: 20,
    lab_batch_id: "pb-3",
    customer_name: "Capgemini",
    month: 7,
    year: 2026,
    selling_cost: 98000,
    input_cost: 57000,
    input_cost_auto: null,
    input_cost_actual_alloc: 56900,
  },
];

export function lineCost(
  row: Pick<TxRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">,
): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

// SCRUM-131 (plan §4.11): transaction figures are built from the rows of the selected tab
// (All / Complete / Incomplete). Batch figures are batch-level and not filtered by the tab;
// reconciliation always uses all lines.
export function buildPrivateSummary(
  batches: BatchRow[],
  tx: TxRow[],
  allTx: TxRow[],
  now: Date = new Date(),
) {
  const batchIdSet = new Set(batches.map((batch) => batch.id));
  const inBatches = tx.filter((row) => row.lab_batch_id && batchIdSet.has(row.lab_batch_id)).length;
  const txRevenue = tx.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
  const txCost = tx.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
  const txUsers = tx.reduce((sum, row) => addNullable(sum, row.total_users), 0);
  const completeness = splitByCompleteness(tx, lineCost);
  const incompleteRows = tx.filter((row) => isIncompleteTransaction(row));
  const incompleteRevenue = incompleteRows.reduce(
    (sum, row) => addNullable(sum, row.selling_cost),
    0,
  );
  const incompleteCost = incompleteRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
  const incompleteUsers = incompleteRows.reduce((sum, row) => addNullable(sum, row.total_users), 0);
  // Provider split inside Private cloud: the three private providers first, then anything else stored.
  const providerMap = new Map<string, { rows: number; revenue: number }>();
  for (const name of PRIVATE_CLOUD_PROVIDERS) providerMap.set(name, { rows: 0, revenue: 0 });
  for (const row of tx) {
    const name = row.cloud_provider?.trim() || "No provider";
    const cur = providerMap.get(name) ?? { rows: 0, revenue: 0 };
    cur.rows += 1;
    cur.revenue = addNullable(cur.revenue, row.selling_cost);
    providerMap.set(name, cur);
  }
  const providerSplit = [...providerMap.entries()].map(([name, v]) => ({ name, ...v }));
  const nowYear = now.getFullYear();
  const availableYears = tx
    .map((row) => row.year)
    .filter((value): value is number => typeof value === "number");
  const year = availableYears.includes(nowYear)
    ? nowYear
    : (availableYears.sort((a, b) => b - a)[0] ?? nowYear);
  const revenue = batches.reduce((sum, row) => addNullable(sum, row.revenue_total), 0);
  const actualCost = batches.reduce((sum, row) => addNullable(sum, row.actual_cost_total), 0);
  const estimatedCost = batches.reduce((sum, row) => addNullable(sum, row.estimated_cost_total), 0);
  const profit = revenue - actualCost;
  const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;

  const byMonth = Array.from({ length: 12 }, (_, idx) => {
    const month = idx + 1;
    const monthRows = tx.filter((row) => row.year === year && row.month === month);
    const monthRevenue = monthRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
    const monthCost = monthRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
    const monthMargin = monthRevenue > 0 ? ((monthRevenue - monthCost) / monthRevenue) * 100 : 0;
    return {
      month: MONTH_NAMES[idx].slice(0, 3),
      monthLabel: `${MONTH_NAMES[idx].slice(0, 3)} ${String(year).slice(2)}`,
      revenue: monthRevenue,
      cost: monthCost,
      marginPct: Number(monthMargin.toFixed(1)),
    };
  });

  const statusMap = new Map<string, number>();
  for (const batch of batches) {
    const label = formatBatchStatus(batch.status);
    statusMap.set(label, (statusMap.get(label) ?? 0) + 1);
  }

  const byBatchLineActual = new Map<string, number>();
  // Batch reconciliation compares batch totals with ALL their lines, whatever the tab.
  for (const row of allTx) {
    if (!row.lab_batch_id) continue;
    byBatchLineActual.set(
      row.lab_batch_id,
      addNullable(byBatchLineActual.get(row.lab_batch_id) ?? 0, row.input_cost_actual_alloc),
    );
  }
  const reconciliation = batches.map((batch) => {
    const lineActual = byBatchLineActual.get(batch.id) ?? 0;
    const batchActual = Number(batch.actual_cost_total ?? 0);
    const batchEstimate = Number(batch.estimated_cost_total ?? 0);
    const diff = Math.abs(lineActual - batchActual);
    return {
      ...batch,
      lineActual,
      reconciled: diff < 0.01,
      batchActual,
      batchEstimate,
    };
  });

  const customerRevenue = new Map<string, number>();
  for (const row of tx) {
    const customer = row.customer_name ?? "Unknown";
    customerRevenue.set(
      customer,
      addNullable(customerRevenue.get(customer) ?? 0, row.selling_cost),
    );
  }
  const topCustomers = [...customerRevenue.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const locked = batches.filter((batch) =>
    (batch.flags ?? []).some((flag) => flag.toLowerCase().includes("lock")),
  ).length;
  const recomputePending = batches.filter((batch) => batch.needs_recompute).length;

  return {
    batches,
    tx,
    inBatches,
    txRevenue,
    txCost,
    txUsers,
    completeness,
    incompleteRevenue,
    incompleteCost,
    incompleteUsers,
    providerSplit,
    year,
    revenue,
    actualCost,
    estimatedCost,
    profit,
    marginPct,
    byMonth,
    statusSplit: [...statusMap.entries()].map(([name, value]) => ({ name, value })),
    reconciliation,
    topCustomers,
    locked,
    recomputePending,
  };
}

/**
 * The page pipeline (was the component's useMemo chain, unchanged). Transaction rows are filtered
 * to the period each label states; batch tiles are batch-level (no month on a batch) and use the
 * all-time cloud.batches rule. Tab counts come from the completeness period's rows.
 */
export function privateCloudView(
  allTx: TxRow[],
  batches: BatchRow[],
  tab: CompletenessTab,
  now: Date = new Date(),
) {
  const months = dataMonthsOf(allTx);
  const totalsPeriod = kpiPeriodFor("cloud.totals", months);
  const completenessPeriod = kpiPeriodFor("cloud.completeness", months);
  const batchesPeriod = kpiPeriodFor("cloud.batches");
  const batchStatePeriod = kpiPeriodFor("cloud.batchState");
  const view = buildPrivateSummary(
    batches,
    filterByCompletenessTab(rowsInKpiPeriod(allTx, totalsPeriod), tab),
    allTx,
    now,
  );
  const completenessRows = rowsInKpiPeriod(allTx, completenessPeriod);
  const cardSplit = splitByCompleteness(completenessRows, lineCost);
  const tabCounts = completenessTabCounts(completenessRows);
  return {
    totalsPeriod,
    completenessPeriod,
    batchesPeriod,
    batchStatePeriod,
    view,
    cardSplit,
    tabCounts,
  };
}
