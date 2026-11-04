// SCRUM-128 C5: the Dashboard's data shaping, moved out of dashboard-super-admin-summary.tsx so
// it can be pinned by tests (plan R1: data hooks and calculations are not touched). The types,
// example data and helpers are moved verbatim (isTicketOverdue / summarizeFreshdeskRuns take an
// optional `now`, default Date.now() as before). The inline useMemo bodies became the functions
// below, each a verbatim copy of its body. dashboard-data.test.ts pins every value against a
// copy of today's inline code.
//
// The one addition is resolveDashboardKpis(): the KPI tiles' period comes from KPI_PERIOD_RULES
// (lib/kpi-period.ts, "dashboard.fyMoney" / "dashboard.month") and the values are computed for
// that same period object, so the label and the maths cannot drift apart (plan §4.2, N14-N17).
// With today's rules it returns exactly today's numbers (pinned in the test).
import type { AppRole } from "@/lib/auth-context";
import { MONTH_NAMES } from "@/lib/format";
import {
  dataMonthsOf,
  kpiPeriodFor,
  previousKpiPeriod,
  rowsInKpiPeriod,
  type KpiPeriod,
  type YearMonth,
} from "@/lib/kpi-period";
import { addNullable } from "@/lib/nullable-sum";
import { ROLE_LABEL } from "@/lib/role-labels";
import { LIVE_ROLES, PARKED_ROLES } from "@/lib/role-rollout";
import type { SyncOverview, SyncRunRow } from "@/lib/sync.functions";
import { splitByCompleteness } from "@/lib/transaction-completeness";
import {
  buildFytdComparison,
  financialYearEndForPoint,
  financialYearWindow,
  FINANCIAL_YEAR_START_MONTH,
  includesDashboardPeriod,
  parseDashboardPeriod,
  type DashboardPeriodFilter,
  type YearMonthPoint,
} from "@/components/summaries/dashboard-summary-utils";

/** The transactions columns the Dashboard reads (today's list + the two SCRUM-131 required fields). */
export const DASHBOARD_TX_COLUMNS =
  "month,year,customer_name,line_of_business,cloud_provider,selling_cost,input_cost,input_cost_actual_alloc,input_cost_auto,total_users,repository_type,is_deleted,potential_id,lab_name";

export type CloudFilter = "all" | "public_cloud" | "private_cloud";

export type TxRow = {
  month: number | null;
  year: number | null;
  customer_name: string | null;
  line_of_business: string | null;
  cloud_provider: string | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_actual_alloc: number | null;
  input_cost_auto: number | null;
  total_users: number | null;
  repository_type: "public_cloud" | "private_cloud";
  /** SCRUM-128 C5: selected so the incomplete note can apply the SCRUM-131 rule (required fields). */
  potential_id?: string | null;
  lab_name?: string | null;
};

export type TicketSummaryRow = {
  id: number;
  status: string | null;
  agent_name: string | null;
  company_name: string | null;
  is_escalated: boolean | null;
  ticket_created_at: string | null;
  due_by: string | null;
};

export type InboxSummaryRow = {
  id: string;
  agent_key: string;
  item_type: string;
  title: string;
  summary: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean | null;
};

export type UserRoleRow = {
  user_id: string;
  role: AppRole;
};

export type DashboardData = {
  txRows: TxRow[];
  tickets: TicketSummaryRow[];
  syncOverview: SyncOverview;
  inboxRows: InboxSummaryRow[];
  profiles: ProfileRow[];
  userRoles: UserRoleRow[];
};

export type TrendPoint = {
  key: string;
  label: string;
  year: number;
  month: number;
  revenue: number;
  inputCost: number;
  profit: number;
  marginPct: number;
  lineCount: number;
  publicCount: number;
  privateCount: number;
};

export type TopCustomer = {
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  users: number;
  dominantLob: string;
};

export const EXAMPLE_TX_ROWS: TxRow[] = [
  {
    month: 9,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "Azure",
    line_of_business: "VILT",
    customer_name: "Cognizant",
    potential_id: "EX-1001",
    lab_name: "Azure DevOps lab",
    total_users: 42,
    input_cost: 48200,
    input_cost_actual_alloc: 46850,
    input_cost_auto: null,
    selling_cost: 67600,
  },
  {
    month: 9,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "AWS",
    line_of_business: "Standalone",
    customer_name: "Infosys",
    potential_id: "EX-1002",
    lab_name: "AWS solutions lab",
    total_users: 30,
    input_cost: 39100,
    input_cost_actual_alloc: 38920,
    input_cost_auto: null,
    selling_cost: 57500,
  },
  {
    month: 9,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "Azure",
    line_of_business: "VILT",
    customer_name: "TCS",
    potential_id: "EX-1003",
    lab_name: "Azure DevOps lab",
    total_users: 55,
    input_cost: 73400,
    input_cost_actual_alloc: 72130,
    input_cost_auto: null,
    selling_cost: 96500,
  },
  {
    month: 9,
    year: 2026,
    repository_type: "private_cloud",
    cloud_provider: "Azure",
    line_of_business: "Integrated",
    customer_name: "HCL",
    potential_id: "EX-1004",
    lab_name: "Azure DevOps lab",
    total_users: 33,
    input_cost: 41900,
    input_cost_actual_alloc: 40210,
    input_cost_auto: null,
    selling_cost: 63100,
  },
  {
    month: 8,
    year: 2026,
    repository_type: "private_cloud",
    cloud_provider: "AWS",
    line_of_business: "Integrated",
    customer_name: "Accenture",
    potential_id: "EX-1005",
    lab_name: "AWS solutions lab",
    total_users: 37,
    input_cost: 44600,
    input_cost_actual_alloc: 44120,
    input_cost_auto: null,
    selling_cost: 68600,
  },
  {
    month: 8,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "GCP",
    line_of_business: "Standalone",
    customer_name: "Wipro",
    potential_id: "EX-1006",
    lab_name: "GCP data lab",
    total_users: 24,
    input_cost: 28800,
    input_cost_actual_alloc: 28240,
    input_cost_auto: null,
    selling_cost: 44600,
  },
  {
    month: 7,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "Azure",
    line_of_business: "VILT",
    customer_name: "Capgemini",
    potential_id: "EX-1007",
    lab_name: "Azure DevOps lab",
    total_users: 20,
    input_cost: 22900,
    input_cost_actual_alloc: 21980,
    input_cost_auto: null,
    selling_cost: 35200,
  },
  {
    month: 7,
    year: 2026,
    repository_type: "private_cloud",
    cloud_provider: "Azure",
    line_of_business: "Standalone",
    customer_name: "TechM",
    potential_id: "EX-1008",
    lab_name: "Azure DevOps lab",
    total_users: 26,
    input_cost: 31200,
    input_cost_actual_alloc: 30500,
    input_cost_auto: null,
    selling_cost: 47800,
  },
  {
    month: 6,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "AWS",
    line_of_business: "VILT",
    customer_name: "LTIMindtree",
    potential_id: "EX-1009",
    lab_name: "AWS solutions lab",
    total_users: 46,
    input_cost: 59200,
    input_cost_actual_alloc: 57120,
    input_cost_auto: null,
    selling_cost: 87400,
  },
  {
    month: 6,
    year: 2026,
    repository_type: "private_cloud",
    cloud_provider: "Azure",
    line_of_business: "Standalone",
    customer_name: "Persistent",
    potential_id: "EX-1010",
    lab_name: "Azure DevOps lab",
    total_users: 29,
    input_cost: 36100,
    input_cost_actual_alloc: 34970,
    input_cost_auto: null,
    selling_cost: 54800,
  },
  {
    month: 5,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "GCP",
    line_of_business: "Integrated",
    customer_name: "Mphasis",
    potential_id: "EX-1011",
    lab_name: "GCP data lab",
    total_users: 18,
    input_cost: 21900,
    input_cost_actual_alloc: 21000,
    input_cost_auto: null,
    selling_cost: 33100,
  },
  {
    month: 5,
    year: 2026,
    repository_type: "private_cloud",
    cloud_provider: "Azure",
    line_of_business: "Integrated",
    customer_name: "Hexaware",
    potential_id: "EX-1012",
    lab_name: "Azure DevOps lab",
    total_users: 27,
    input_cost: 33200,
    input_cost_actual_alloc: 31800,
    input_cost_auto: null,
    selling_cost: 50900,
  },
];

export const EXAMPLE_TICKETS: TicketSummaryRow[] = [
  {
    id: 5142,
    status: "Open",
    agent_name: "Ritu Sharma",
    company_name: "Cognizant",
    is_escalated: true,
    ticket_created_at: "2026-09-29T03:40:00Z",
    due_by: "2026-09-29T09:30:00Z",
  },
  {
    id: 5139,
    status: "Pending",
    agent_name: "Ritu Sharma",
    company_name: "Infosys",
    is_escalated: false,
    ticket_created_at: "2026-09-28T15:12:00Z",
    due_by: "2026-09-29T13:00:00Z",
  },
  {
    id: 5131,
    status: "Waiting on Customer",
    agent_name: "Nisha Patel",
    company_name: "TCS",
    is_escalated: false,
    ticket_created_at: "2026-09-28T08:10:00Z",
    due_by: "2026-09-30T10:00:00Z",
  },
  {
    id: 5128,
    status: "Open",
    agent_name: "Amit Singh",
    company_name: "MakeMyLabs",
    is_escalated: true,
    ticket_created_at: "2026-09-28T04:42:00Z",
    due_by: "2026-09-29T07:00:00Z",
  },
  {
    id: 5124,
    status: "Resolved",
    agent_name: "Ritu Sharma",
    company_name: "Wipro",
    is_escalated: false,
    ticket_created_at: "2026-09-27T17:20:00Z",
    due_by: "2026-09-28T12:00:00Z",
  },
  {
    id: 5116,
    status: "Closed",
    agent_name: "Nisha Patel",
    company_name: "HCL",
    is_escalated: false,
    ticket_created_at: "2026-09-26T20:10:00Z",
    due_by: "2026-09-27T06:30:00Z",
  },
];

export const EXAMPLE_INBOX: InboxSummaryRow[] = [
  {
    id: "inb-55",
    agent_key: "support",
    item_type: "ticket_proposal",
    title: "Ticket #5142 — VM launch failure response and assignment",
    summary:
      "Proposes urgent priority, assignment to Ritu Sharma, and a guided response with next checks.",
    status: "pending",
    created_at: "2026-09-29T05:31:14Z",
  },
  {
    id: "inb-58",
    agent_key: "generalist",
    item_type: "solution_guide",
    title: "Lab solution guide — Cognizant BPMN cohort",
    summary: "OSS-first recommendation, cost ranges, delivery model and caveats.",
    status: "pending",
    created_at: "2026-09-29T05:35:05Z",
  },
  {
    id: "inb-49",
    agent_key: "cost_adr",
    item_type: "adr_field_map",
    title: "ADR draft mapping — TCS AKS Platform Engineering",
    summary: "Mapped requisition to customer, lab batch, users, and estimated input/selling costs.",
    status: "confirmed",
    created_at: "2026-09-29T03:56:09Z",
  },
];

export const EXAMPLE_PROFILES: ProfileRow[] = [
  { id: "u-admin", full_name: "Admin Demo", email: "admin.demo@mml.local", is_active: true },
  {
    id: "u-leadership",
    full_name: "Meera Krishnan",
    email: "leadership.demo@mml.local",
    is_active: true,
  },
  { id: "u-finance", full_name: "Kavya Iyer", email: "finance.demo@mml.local", is_active: false },
  { id: "u-ops-lead", full_name: "Nisha Patel", email: "opslead.demo@mml.local", is_active: false },
  { id: "u-ops-user", full_name: "Ritu Sharma", email: "ops.demo@mml.local", is_active: false },
  { id: "u-viewer", full_name: "Arjun Kapoor", email: "viewer.demo@mml.local", is_active: false },
];

export const EXAMPLE_USER_ROLES: UserRoleRow[] = [
  { user_id: "u-admin", role: "admin" },
  { user_id: "u-leadership", role: "leadership" },
  { user_id: "u-finance", role: "finance" },
  { user_id: "u-ops-lead", role: "ops_lead" },
  { user_id: "u-ops-user", role: "ops_user" },
  { user_id: "u-viewer", role: "viewer" },
];

export const EXAMPLE_SYNC_OVERVIEW: SyncOverview = {
  runs: [],
  last_success: null,
  live_counts: { customers: 14, transactions: 116 },
  snapshot_rows: 62,
  count_error_refs: [],
  next_cron_at: "2026-09-30T02:00:00.000Z",
  snapshot_schedule_utc: "02:00 UTC",
  freshdesk: {
    runs: [
      {
        id: "fd-3",
        kind: "freshdesk",
        trigger_source: "cron",
        status: "error",
        customers_count: 0,
        transactions_count: 0,
        report_rows: 0,
        error_message: "Freshdesk timeout after 30s",
        triggered_by_email: null,
        started_at: "2026-09-29T02:00:00Z",
        finished_at: "2026-09-29T02:00:31Z",
        duration_ms: 31000,
        fetched_count: 0,
        upserted_count: 0,
      },
      {
        id: "fd-2",
        kind: "freshdesk",
        trigger_source: "cron",
        status: "success",
        customers_count: 0,
        transactions_count: 0,
        report_rows: 0,
        error_message: null,
        triggered_by_email: null,
        started_at: "2026-09-29T03:00:00Z",
        finished_at: "2026-09-29T03:00:51Z",
        duration_ms: 51000,
        fetched_count: 118,
        upserted_count: 19,
      },
    ],
    health: {
      state: "warning",
      lastSuccessAt: "2026-09-29T03:00:51Z",
      lastRunAt: "2026-09-29T02:00:00Z",
      consecutiveFailures: 1,
      runsLast24h: 2,
      failuresLast24h: 1,
      lastError: "Freshdesk timeout after 30s",
      message: "Last run failed once; monitoring",
    },
  },
};

export function lineCost(
  row: Pick<TxRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">,
): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthShort(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${String(year).slice(2)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function isTicketOverdue(ticket: TicketSummaryRow, now: number = Date.now()): boolean {
  if (!ticket.due_by) return false;
  if (ticket.status && ["Resolved", "Closed"].includes(ticket.status)) return false;
  return new Date(ticket.due_by).getTime() < now;
}

export function toPctChange(current: number, previous: number | null): number | null {
  if (previous === null || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function toPointChange(current: number, previous: number | null): number | null {
  if (previous === null || !Number.isFinite(previous)) return null;
  return current - previous;
}

export function summarizeFreshdeskRuns(runs: SyncRunRow[], now: number = Date.now()) {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = runs.filter((run) => new Date(run.started_at).getTime() >= dayAgo);
  const failed24h = recent.filter((run) => run.status !== "success").length;
  const lastSuccess = runs.find((run) => run.status === "success") ?? null;
  const lastFailed = runs.find((run) => run.status !== "success") ?? null;
  let failuresInRow = 0;
  for (const run of runs) {
    if (run.status === "success") break;
    failuresInRow += 1;
  }
  return {
    state: runs[0]?.status === "success" ? "ok" : "warn",
    lastSuccess,
    lastFailed,
    runs24h: recent.length,
    failed24h,
    failuresInRow,
  };
}

export function applyTxFilters(
  rows: TxRow[],
  cloudFilter: CloudFilter,
  customerFilter: string,
  periodFilter: DashboardPeriodFilter,
): TxRow[] {
  return rows.filter((row) => {
    if (cloudFilter !== "all" && row.repository_type !== cloudFilter) return false;
    if (customerFilter !== "all" && row.customer_name !== customerFilter) return false;
    return includesDashboardPeriod(row.year, row.month, periodFilter);
  });
}

export function buildTrendPoints(rows: TxRow[], timeline: YearMonthPoint[]): TrendPoint[] {
  const byMonth = new Map<string, TxRow[]>();
  for (const row of rows) {
    if (!row.year || !row.month) continue;
    const key = monthKey(row.year, row.month);
    const bucket = byMonth.get(key) ?? [];
    bucket.push(row);
    byMonth.set(key, bucket);
  }
  return timeline.map((point) => {
    const key = monthKey(point.year, point.month);
    const bucket = byMonth.get(key) ?? [];
    const revenue = bucket.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
    const inputCost = bucket.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
    const lineCount = bucket.length;
    const publicCount = bucket.filter((row) => row.repository_type === "public_cloud").length;
    const privateCount = bucket.filter((row) => row.repository_type === "private_cloud").length;
    const profit = revenue - inputCost;
    return {
      key,
      label: monthShort(point.year, point.month),
      year: point.year,
      month: point.month,
      revenue,
      inputCost,
      profit,
      marginPct: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(1)) : 0,
      lineCount,
      publicCount,
      privateCount,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The component's useMemo bodies, moved verbatim (only `data` became a parameter).

export type DashboardPeriodOption = { value: DashboardPeriodFilter; label: string };

export function buildPeriodOptions(txRows: TxRow[] | undefined): DashboardPeriodOption[] {
  if (!txRows) return [{ value: "all", label: "All months · All years" }];
  const points = txRows
    .filter(
      (row): row is TxRow & { year: number; month: number } =>
        typeof row.year === "number" && typeof row.month === "number",
    )
    .map((row) => ({ year: row.year, month: row.month }));
  const years = [...new Set(points.map((point) => point.year))].sort((a, b) => b - a);
  const monthTokens = [...new Set(points.map((point) => monthKey(point.year, point.month)))].sort(
    (a, b) => b.localeCompare(a),
  );
  const monthEntries = monthTokens
    .map((token) => {
      const [yearRaw, monthRaw] = token.split("-");
      const year = Number(yearRaw);
      const month = Number(monthRaw);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
      return {
        value: `month:${year}-${month}` as DashboardPeriodFilter,
        label: `${MONTH_NAMES[month - 1]} ${year}`,
      };
    })
    .filter((entry): entry is { value: DashboardPeriodFilter; label: string } => Boolean(entry));

  return [
    { value: "all" as DashboardPeriodFilter, label: "All months · All years" },
    ...years.map((year) => ({
      value: `year:${year}` as DashboardPeriodFilter,
      label: `All months · FY ${year}`,
    })),
    ...monthEntries,
  ];
}

export function cloudAndPeriodRowsOf(
  txRows: TxRow[] | undefined,
  cloudFilter: CloudFilter,
  periodFilter: DashboardPeriodFilter,
): TxRow[] {
  if (!txRows) return [];
  return txRows.filter((row) => {
    if (cloudFilter !== "all" && row.repository_type !== cloudFilter) return false;
    return includesDashboardPeriod(row.year, row.month, periodFilter);
  });
}

export function customerOptionsOf(cloudAndPeriodRows: TxRow[]): string[] {
  const names = [
    ...new Set(
      cloudAndPeriodRows
        .map((row) => row.customer_name)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  return names.sort((a, b) => a.localeCompare(b));
}

export function chartBaseRowsOf(
  txRows: TxRow[] | undefined,
  cloudFilter: CloudFilter,
  customerFilter: string,
): TxRow[] {
  if (!txRows) return [];
  return txRows.filter((row) => {
    if (cloudFilter !== "all" && row.repository_type !== cloudFilter) return false;
    if (customerFilter !== "all" && row.customer_name !== customerFilter) return false;
    return true;
  });
}

export function topCustomersOf(filteredRows: TxRow[]): TopCustomer[] {
  const map = new Map<string, TopCustomer>();
  for (const row of filteredRows) {
    const customer = row.customer_name ?? "Unknown";
    const current = map.get(customer) ?? {
      name: customer,
      revenue: 0,
      cost: 0,
      profit: 0,
      users: 0,
      dominantLob: "VILT",
    };
    current.revenue = addNullable(current.revenue, row.selling_cost);
    current.cost = addNullable(current.cost, lineCost(row));
    current.users = addNullable(current.users, row.total_users);
    map.set(customer, current);
  }
  return [...map.values()].map((customer) => {
    const lobCount = new Map<string, number>();
    for (const row of filteredRows) {
      if ((row.customer_name ?? "Unknown") !== customer.name) continue;
      const key = row.line_of_business ?? "VILT";
      lobCount.set(key, (lobCount.get(key) ?? 0) + 1);
    }
    const dominantLob = [...lobCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "VILT";
    const profit = customer.revenue - customer.cost;
    return { ...customer, dominantLob, profit };
  });
}

/** Top 5 by one metric (the three "Top customers" cards). */
export function topCustomersBy(
  customers: TopCustomer[],
  metricKey: "revenue" | "profit" | "users",
): TopCustomer[] {
  return [...customers].sort((a, b) => b[metricKey] - a[metricKey]).slice(0, 5);
}

export function filterDashboardTickets(
  tickets: TicketSummaryRow[] | undefined,
  filteredRows: TxRow[],
  customerFilter: string,
  cloudFilter: CloudFilter,
  periodFilter: DashboardPeriodFilter,
): TicketSummaryRow[] {
  if (!tickets) return [];
  const customerSet = new Set(
    filteredRows.map((row) => row.customer_name).filter((name): name is string => Boolean(name)),
  );
  return tickets.filter((ticket) => {
    if (customerFilter !== "all" && ticket.company_name !== customerFilter) return false;
    if (customerFilter === "all" && cloudFilter !== "all" && customerSet.size > 0) {
      if (!ticket.company_name || !customerSet.has(ticket.company_name)) return false;
    }
    if (
      !includesDashboardPeriod(
        ticket.ticket_created_at ? new Date(ticket.ticket_created_at).getFullYear() : null,
        ticket.ticket_created_at ? new Date(ticket.ticket_created_at).getMonth() + 1 : null,
        periodFilter,
      )
    ) {
      return periodFilter === "all";
    }
    return true;
  });
}

export function filterDashboardInbox(
  inboxRows: InboxSummaryRow[] | undefined,
  periodFilter: DashboardPeriodFilter,
  customerFilter: string,
): InboxSummaryRow[] {
  if (!inboxRows) return [];
  return inboxRows.filter((item) => {
    const created = new Date(item.created_at);
    if (
      !includesDashboardPeriod(created.getFullYear(), created.getMonth() + 1, periodFilter) &&
      periodFilter !== "all"
    ) {
      return false;
    }
    if (customerFilter !== "all") {
      const haystack = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      if (!haystack.includes(customerFilter.toLowerCase())) return false;
    }
    return true;
  });
}

export type DashboardViewerUser = {
  email?: string | null;
  user_metadata?: { full_name?: unknown } | null;
} | null;

/** "Viewing as {name} · {role}" (now the AppShell description). */
export function dashboardViewer(
  roles: readonly AppRole[],
  user: DashboardViewerUser | undefined,
): { viewerName: string; viewerRole: string } {
  const orderedRoles: AppRole[] = [
    "admin",
    "leadership",
    "finance",
    "ops_lead",
    "ops_user",
    "viewer",
  ];
  const activeRole = orderedRoles.find((role) => roles.includes(role)) ?? "viewer";
  const viewerRole = ROLE_LABEL[activeRole];
  const fullName = user?.user_metadata?.full_name;
  const viewerName =
    typeof fullName === "string" && fullName.trim()
      ? fullName
      : (user?.email ?? "demo@mml.local").split("@")[0];
  return { viewerName, viewerRole };
}

export const LOB_ORDER = ["VILT", "Standalone", "Integrated"] as const;

export function lobRowsOf(
  filteredRows: TxRow[],
): { name: (typeof LOB_ORDER)[number]; value: number }[] {
  return LOB_ORDER.map((name) => ({
    name,
    value: filteredRows.filter((row) => (row.line_of_business ?? "VILT") === name).length,
  }));
}

export function ticketCountsOf(filteredTickets: TicketSummaryRow[], now: number = Date.now()) {
  return {
    open: filteredTickets.filter((ticket) => ticket.status === "Open").length,
    pending: filteredTickets.filter((ticket) => ticket.status === "Pending").length,
    overdue: filteredTickets.filter((ticket) => isTicketOverdue(ticket, now)).length,
    escalated: filteredTickets.filter((ticket) => ticket.is_escalated).length,
    resolved: filteredTickets.filter((ticket) => ticket.status === "Resolved").length,
    closed: filteredTickets.filter((ticket) => ticket.status === "Closed").length,
    total: filteredTickets.length,
  };
}

export function ticketsByAgentOf(filteredTickets: TicketSummaryRow[]) {
  return [...new Set(filteredTickets.map((ticket) => ticket.agent_name ?? "Unassigned"))]
    .map((name) => ({
      name,
      count: filteredTickets.filter((ticket) => (ticket.agent_name ?? "Unassigned") === name)
        .length,
    }))
    .sort((a, b) => b.count - a.count);
}

export function inboxSummaryOf(filteredInboxItems: InboxSummaryRow[], now: Date = new Date()) {
  const pendingInbox = filteredInboxItems.filter((item) => item.status === "pending").slice(0, 3);
  const confirmedToday = filteredInboxItems.filter(
    (item) =>
      item.status === "confirmed" &&
      new Date(item.created_at).toDateString() === now.toDateString(),
  ).length;
  return { pendingInbox, confirmedToday };
}

export const DASHBOARD_ROLE_ORDER: AppRole[] = [
  "admin",
  "leadership",
  "finance",
  "ops_lead",
  "ops_user",
  "viewer",
];

export function userEntriesOf(profiles: ProfileRow[], userRoles: UserRoleRow[]) {
  return DASHBOARD_ROLE_ORDER.map((role) => {
    const userIds = userRoles.filter((row) => row.role === role).map((row) => row.user_id);
    const profile = profiles.find((row) => userIds.includes(row.id));
    return {
      role,
      roleLabel: ROLE_LABEL[role],
      name: profile?.full_name ?? "Not assigned",
      isLive: LIVE_ROLES.includes(role) && Boolean(profile?.is_active),
      parked: PARKED_ROLES.includes(role),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// KPI tiles (plan §4.2, P03, N14-N17). The period comes from KPI_PERIOD_RULES; the values are
// today's calculation (buildTrendPoints over the FY window, buildFytdComparison, toPctChange,
// toPointChange, count differences) evaluated for that period.

export type IncompleteSlice = { count: number; revenue: number; inputCost: number };

export type DashboardKpis = {
  /** The FY window (12 months) the chart and the money tiles use. */
  timeline: YearMonthPoint[];
  trendRows: TrendPoint[];
  /** Index of the money tiles' last month in `trendRows`. */
  currentIndex: number | null;
  /** Revenue, Input cost, Profit, Margin. */
  fyPeriod: KpiPeriod;
  /** Month revenue, Month profit. */
  monthPeriod: KpiPeriod;
  /** Public cloud, Private cloud (line counts). */
  cloudPeriod: KpiPeriod;
  /** What the money deltas compare with ("end of Aug 2026"); null when there is none. */
  fyComparedWith: KpiPeriod | null;
  /** What the month deltas compare with ("Aug 2026"); null when there is none. */
  monthComparedWith: KpiPeriod | null;
  /** What the count deltas compare with ("Aug 2026"); null when there is none. */
  cloudComparedWith: KpiPeriod | null;
  totalRevenue: number;
  totalInputCost: number;
  totalProfit: number;
  marginPct: number;
  monthRevenue: number;
  monthProfit: number;
  publicLines: number;
  privateLines: number;
  revenueDelta: number | null;
  costDelta: number | null;
  profitDelta: number | null;
  marginDelta: number | null;
  monthRevenueDelta: number | null;
  monthProfitDelta: number | null;
  publicLinesDelta: number | null;
  privateLinesDelta: number | null;
  /** Incomplete rows (SCRUM-131 rule) behind the money tiles; they stay in the totals. */
  incompleteFy: IncompleteSlice;
  incompleteMonth: IncompleteSlice;
};

function ymIndex(point: YearMonth): number {
  return point.year * 12 + (point.month - 1);
}

function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

function fyToDateThrough(through: YearMonth): KpiPeriod {
  const s = FINANCIAL_YEAR_START_MONTH;
  return {
    kind: "fy-to-date",
    fyStartMonth: s,
    from: { year: through.month >= s ? through.year : through.year - 1, month: s },
    through,
  };
}

/** The last month a period covers (the month the tiles are "as of"). */
function periodEndMonth(period: KpiPeriod): YearMonth | null {
  switch (period.kind) {
    case "fy-to-date":
    case "range":
      return period.through;
    case "month":
      return period.month;
    default:
      return null;
  }
}

/**
 * The tile periods for a Dashboard period filter.
 * - All months: KPI_PERIOD_RULES "dashboard.fyMoney", "dashboard.month" and "dashboard.cloudCount"
 *   (today: the FY to date and the latest month with data, not capped at today).
 * - A financial year: the latest month with data inside that FY window, else the window's last
 *   month (today's latestDataIndex, else trendRows.length - 1).
 * - A month: that month, and the FY to date through it.
 */
export function resolveDashboardPeriods(
  periodFilter: DashboardPeriodFilter,
  dataMonths: readonly YearMonth[],
  today: Date = new Date(),
): { fyPeriod: KpiPeriod; monthPeriod: KpiPeriod; cloudPeriod: KpiPeriod } {
  const parsed = parseDashboardPeriod(periodFilter);
  if (parsed.kind === "month") {
    const month = { year: parsed.year, month: parsed.month };
    const monthPeriod: KpiPeriod = { kind: "month", month, basis: "calendar" };
    return { fyPeriod: fyToDateThrough(month), monthPeriod, cloudPeriod: monthPeriod };
  }
  if (parsed.kind === "year") {
    const window = financialYearWindow(parsed.year);
    const latest = dataMonths
      .filter((m) => window.some((w) => sameMonth(w, m)))
      .sort((a, b) => ymIndex(b) - ymIndex(a))[0];
    const month = latest ?? window[window.length - 1];
    const monthPeriod: KpiPeriod = {
      kind: "month",
      month,
      basis: latest ? "latest-with-data" : "calendar",
    };
    return { fyPeriod: fyToDateThrough(month), monthPeriod, cloudPeriod: monthPeriod };
  }
  return {
    fyPeriod: kpiPeriodFor("dashboard.fyMoney", dataMonths, today),
    monthPeriod: kpiPeriodFor("dashboard.month", dataMonths, today),
    cloudPeriod: kpiPeriodFor("dashboard.cloudCount", dataMonths, today),
  };
}

function incompleteSlice(rows: TxRow[]): IncompleteSlice {
  const { incomplete } = splitByCompleteness(rows, lineCost);
  return {
    count: incomplete.count,
    revenue: incomplete.sellingCost,
    inputCost: incomplete.inputCost,
  };
}

export function resolveDashboardKpis(
  chartBaseRows: TxRow[],
  periodFilter: DashboardPeriodFilter,
  today: Date = new Date(),
): DashboardKpis {
  const { fyPeriod, monthPeriod, cloudPeriod } = resolveDashboardPeriods(
    periodFilter,
    dataMonthsOf(chartBaseRows),
    today,
  );
  const thisMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };
  const fyEnd = periodEndMonth(fyPeriod) ?? periodEndMonth(monthPeriod) ?? thisMonth;
  const timeline = financialYearWindow(financialYearEndForPoint(fyEnd));
  const trendRows = buildTrendPoints(chartBaseRows, timeline);

  const fyIndex = trendRows.findIndex((row) => sameMonth(row, fyEnd));
  const currentIndex = fyIndex >= 0 ? fyIndex : null;
  const fytd = buildFytdComparison(
    trendRows.map((row, index) => ({ index, revenue: row.revenue, inputCost: row.inputCost })),
    currentIndex,
  );

  // A month's trend point and the one before it in the same FY window (today's
  // previousTrendPoint, so there is no comparison in the FY's first month).
  const pointsFor = (
    month: YearMonth,
  ): { point: TrendPoint | null; previous: TrendPoint | null } => {
    const index = trendRows.findIndex((row) => sameMonth(row, month));
    if (index >= 0)
      return { point: trendRows[index], previous: index > 0 ? trendRows[index - 1] : null };
    // Only reachable if the rules name months in different FYs (a possible Q6 answer).
    const before =
      month.month === 1
        ? { year: month.year - 1, month: 12 }
        : { year: month.year, month: month.month - 1 };
    const [previous, point] = buildTrendPoints(chartBaseRows, [before, month]);
    return { point, previous };
  };

  const monthPoints = pointsFor(periodEndMonth(monthPeriod) ?? fyEnd);
  const monthRevenue = monthPoints.point?.revenue ?? 0;
  const monthProfit = monthPoints.point?.profit ?? 0;

  // Line counts: one month today (that month's publicCount / privateCount); a total if Q6 makes
  // "dashboard.cloudCount" a non-month period (then there is no delta).
  let publicLines: number;
  let privateLines: number;
  let publicLinesDelta: number | null = null;
  let privateLinesDelta: number | null = null;
  let cloudComparedWith: KpiPeriod | null = null;
  if (cloudPeriod.kind === "month") {
    const { point, previous } = pointsFor(cloudPeriod.month);
    publicLines = point?.publicCount ?? 0;
    privateLines = point?.privateCount ?? 0;
    const previousPublic = previous?.publicCount ?? null;
    const previousPrivate = previous?.privateCount ?? null;
    publicLinesDelta = previousPublic === null ? null : publicLines - previousPublic;
    privateLinesDelta = previousPrivate === null ? null : privateLines - previousPrivate;
    cloudComparedWith = previous ? previousKpiPeriod(cloudPeriod) : null;
  } else {
    const rows = rowsInKpiPeriod(chartBaseRows, cloudPeriod);
    publicLines = rows.filter((row) => row.repository_type === "public_cloud").length;
    privateLines = rows.filter((row) => row.repository_type === "private_cloud").length;
  }

  return {
    timeline,
    trendRows,
    currentIndex,
    fyPeriod,
    monthPeriod,
    cloudPeriod,
    fyComparedWith: fytd.previousRevenue === null ? null : previousKpiPeriod(fyPeriod),
    monthComparedWith: monthPoints.previous ? previousKpiPeriod(monthPeriod) : null,
    cloudComparedWith,
    totalRevenue: fytd.currentRevenue,
    totalInputCost: fytd.currentCost,
    totalProfit: fytd.currentProfit,
    marginPct: fytd.currentMarginPct,
    monthRevenue,
    monthProfit,
    publicLines,
    privateLines,
    revenueDelta: toPctChange(fytd.currentRevenue, fytd.previousRevenue),
    costDelta: toPctChange(fytd.currentCost, fytd.previousCost),
    profitDelta: toPctChange(fytd.currentProfit, fytd.previousProfit),
    marginDelta: toPointChange(fytd.currentMarginPct, fytd.previousMarginPct),
    monthRevenueDelta: toPctChange(monthRevenue, monthPoints.previous?.revenue ?? null),
    monthProfitDelta: toPctChange(monthProfit, monthPoints.previous?.profit ?? null),
    publicLinesDelta,
    privateLinesDelta,
    incompleteFy: incompleteSlice(rowsInKpiPeriod(chartBaseRows, fyPeriod)),
    incompleteMonth: incompleteSlice(rowsInKpiPeriod(chartBaseRows, monthPeriod)),
  };
}

/**
 * The period the filter-driven cards cover (Total lines, ticket counts, top customers): rows are
 * filtered with includesDashboardPeriod, so "year:2026" is CALENDAR year 2026 (Jan-Dec), even
 * though its option reads "All months · FY 2026" and the money tiles use the FY (Oct-Sep).
 */
export function dashboardFilterPeriod(periodFilter: DashboardPeriodFilter): KpiPeriod {
  const parsed = parseDashboardPeriod(periodFilter);
  if (parsed.kind === "month") {
    return { kind: "month", month: { year: parsed.year, month: parsed.month }, basis: "calendar" };
  }
  if (parsed.kind === "year") return { kind: "year", year: parsed.year, basis: "calendar" };
  return { kind: "all-time" };
}
