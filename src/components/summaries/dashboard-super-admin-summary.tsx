import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtNumber, MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { readAllRows } from "@/lib/read-all";
import { getSyncOverview, type SyncOverview, type SyncRunRow } from "@/lib/sync.functions";
import { AGENTS } from "@/lib/ai-command-center.functions";
import { LIVE_ROLES, PARKED_ROLES } from "@/lib/role-rollout";
import { isLeadershipOnlyRoleSet } from "@/lib/leadership-access";
import { useAuth, type AppRole } from "@/lib/auth-context";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import {
  buildTimelineFromPoints,
  includesDashboardPeriod,
  previousMonth,
  type DashboardPeriodFilter,
  type YearMonthPoint,
} from "@/components/summaries/dashboard-summary-utils";

type CloudFilter = "all" | "public_cloud" | "private_cloud";

type TxRow = {
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
};

type TicketSummaryRow = {
  id: number;
  status: string | null;
  agent_name: string | null;
  company_name: string | null;
  is_escalated: boolean | null;
  ticket_created_at: string | null;
  due_by: string | null;
};

type InboxSummaryRow = {
  id: string;
  agent_key: string;
  item_type: string;
  title: string;
  summary: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean | null;
};

type UserRoleRow = {
  user_id: string;
  role: AppRole;
};

type DashboardData = {
  txRows: TxRow[];
  tickets: TicketSummaryRow[];
  syncOverview: SyncOverview;
  inboxRows: InboxSummaryRow[];
  profiles: ProfileRow[];
  userRoles: UserRoleRow[];
};

type TrendPoint = {
  key: string;
  label: string;
  year: number;
  month: number;
  revenue: number | null;
  inputCost: number | null;
  profit: number | null;
  marginPct: number | null;
  lineCount: number;
  publicCount: number;
  privateCount: number;
};

type TopCustomer = {
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  users: number;
  dominantLob: string;
};

const PALETTE = {
  pageBg: "#f4f7fd",
  border: "#e1e5f2",
  textSecondary: "#3e424f",
  textMuted: "#767b8c",
  azure: "#2e6cde",
  azureSoft: "#c0d5f6",
  gold: "#bd8a05",
  teal: "#0b6e99",
  purple: "#6f57c5",
  privateNavy: "#23548a",
  green: "#256f46",
  red: "#b4424d",
} as const;

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Super Admin",
  leadership: "Leadership",
  finance: "Finance",
  ops_lead: "Ops Lead",
  ops_user: "Ops User",
  viewer: "Viewer",
};

const EXAMPLE_TX_ROWS: TxRow[] = [
  {
    month: 9,
    year: 2026,
    repository_type: "public_cloud",
    cloud_provider: "Azure",
    line_of_business: "VILT",
    customer_name: "Cognizant",
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
    total_users: 27,
    input_cost: 33200,
    input_cost_actual_alloc: 31800,
    input_cost_auto: null,
    selling_cost: 50900,
  },
];

const EXAMPLE_TICKETS: TicketSummaryRow[] = [
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

const EXAMPLE_INBOX: InboxSummaryRow[] = [
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

const EXAMPLE_PROFILES: ProfileRow[] = [
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

const EXAMPLE_USER_ROLES: UserRoleRow[] = [
  { user_id: "u-admin", role: "admin" },
  { user_id: "u-leadership", role: "leadership" },
  { user_id: "u-finance", role: "finance" },
  { user_id: "u-ops-lead", role: "ops_lead" },
  { user_id: "u-ops-user", role: "ops_user" },
  { user_id: "u-viewer", role: "viewer" },
];

const EXAMPLE_SYNC_OVERVIEW: SyncOverview = {
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

function lineCost(
  row: Pick<TxRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">,
): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthShort(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1].slice(0, 3)} ${String(year).slice(2)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function isTicketOverdue(ticket: TicketSummaryRow): boolean {
  if (!ticket.due_by) return false;
  if (ticket.status && ["Resolved", "Closed"].includes(ticket.status)) return false;
  return new Date(ticket.due_by).getTime() < Date.now();
}

function toPctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function toPointChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous)) return null;
  return current - previous;
}

function summarizeFreshdeskRuns(runs: SyncRunRow[]) {
  const now = Date.now();
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

function applyTxFilters(
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

function buildTrendPoints(rows: TxRow[], periodFilter: DashboardPeriodFilter): TrendPoint[] {
  const points: YearMonthPoint[] = rows
    .filter(
      (row): row is TxRow & { year: number; month: number } =>
        typeof row.year === "number" && typeof row.month === "number",
    )
    .map((row) => ({ year: row.year, month: row.month }));
  const timeline = buildTimelineFromPoints(points, periodFilter);
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
    if (lineCount === 0) {
      return {
        key,
        label: monthShort(point.year, point.month),
        year: point.year,
        month: point.month,
        revenue: null,
        inputCost: null,
        profit: null,
        marginPct: null,
        lineCount: 0,
        publicCount: 0,
        privateCount: 0,
      };
    }
    const profit = revenue - inputCost;
    return {
      key,
      label: monthShort(point.year, point.month),
      year: point.year,
      month: point.month,
      revenue,
      inputCost,
      profit,
      marginPct: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(1)) : null,
      lineCount,
      publicCount,
      privateCount,
    };
  });
}

function formatRunDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN");
}

function itemTypeLabel(itemType: string): string {
  const map: Record<string, string> = {
    ticket_proposal: "Ticket proposal",
    solution_guide: "Solution guide",
    adr_field_map: "ADR field map",
    email_draft: "Email draft",
  };
  return map[itemType] ?? itemType.replaceAll("_", " ");
}

function getAgentName(agentKey: string): string {
  return AGENTS.find((agent) => agent.key === agentKey)?.name ?? agentKey;
}

function sparklinePoints(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const width = 66;
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((value, idx) => {
      const x = idx * step;
      const y = 18 - (value / max) * 16;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function emptyIfNull(value: number | null): number {
  return value ?? 0;
}

export function DashboardSuperAdminSummary() {
  const syncOverviewFn = useServerFn(getSyncOverview);
  const { roles, hasRole, user } = useAuth();
  const isLeadershipOnly = isLeadershipOnlyRoleSet(roles);
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<DashboardPeriodFilter>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-summary-v4"],
    queryFn: async (): Promise<DashboardData> => {
      if (isExampleCaptureMode) {
        return {
          txRows: EXAMPLE_TX_ROWS,
          tickets: EXAMPLE_TICKETS,
          syncOverview: EXAMPLE_SYNC_OVERVIEW,
          inboxRows: EXAMPLE_INBOX,
          profiles: EXAMPLE_PROFILES,
          userRoles: EXAMPLE_USER_ROLES,
        };
      }

      const [txRows, tickets, syncOverview, inboxRows, profilesResult, rolesResult] =
        await Promise.all([
          readAllRows(
            () =>
              supabase
                .from("transactions")
                .select(
                  "month,year,customer_name,line_of_business,cloud_provider,selling_cost,input_cost,input_cost_actual_alloc,input_cost_auto,total_users,repository_type,is_deleted",
                )
                .eq("is_deleted", false)
                .order("id"),
            "Dashboard transactions",
          ) as Promise<TxRow[]>,
          readAllRows(
            () =>
              supabase
                .from("freshdesk_tickets")
                .select("id,status,agent_name,company_name,is_escalated,ticket_created_at,due_by")
                .order("id"),
            "Dashboard support tickets",
          ) as Promise<TicketSummaryRow[]>,
          syncOverviewFn(),
          readAllRows(
            () =>
              supabase
                .from("ai_cc_inbox")
                .select("id,agent_key,item_type,title,summary,status,created_at")
                .order("created_at", { ascending: false }),
            "Dashboard AI inbox",
          ) as Promise<InboxSummaryRow[]>,
          supabase
            .from("profiles")
            .select("id,email,full_name,is_active")
            .order("created_at", { ascending: true }),
          supabase.from("user_roles").select("user_id,role"),
        ]);

      if (profilesResult.error) throw profilesResult.error;
      if (rolesResult.error) throw rolesResult.error;

      return {
        txRows,
        tickets,
        syncOverview,
        inboxRows,
        profiles: (profilesResult.data ?? []) as ProfileRow[],
        userRoles: (rolesResult.data ?? []) as UserRoleRow[],
      };
    },
  });

  const periodOptions = useMemo(() => {
    if (!data) return [{ value: "all", label: "All months · All years" }];
    const points = data.txRows
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
        label: `All months · ${year}`,
      })),
      ...monthEntries,
    ];
  }, [data]);

  const cloudAndPeriodRows = useMemo(() => {
    if (!data) return [];
    return data.txRows.filter((row) => {
      if (cloudFilter !== "all" && row.repository_type !== cloudFilter) return false;
      return includesDashboardPeriod(row.year, row.month, periodFilter);
    });
  }, [data, cloudFilter, periodFilter]);

  const customerOptions = useMemo(() => {
    const names = [
      ...new Set(
        cloudAndPeriodRows
          .map((row) => row.customer_name)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    return names.sort((a, b) => a.localeCompare(b));
  }, [cloudAndPeriodRows]);

  useEffect(() => {
    if (customerFilter !== "all" && !customerOptions.includes(customerFilter)) {
      setCustomerFilter("all");
    }
  }, [customerFilter, customerOptions]);

  const filteredRows = useMemo(
    () => applyTxFilters(data?.txRows ?? [], cloudFilter, customerFilter, periodFilter),
    [data?.txRows, cloudFilter, customerFilter, periodFilter],
  );

  const deltaBaseRows = useMemo(() => {
    if (!data) return [];
    return data.txRows.filter((row) => {
      if (cloudFilter !== "all" && row.repository_type !== cloudFilter) return false;
      if (customerFilter !== "all" && row.customer_name !== customerFilter) return false;
      return true;
    });
  }, [data, cloudFilter, customerFilter]);

  const trendRows = useMemo(
    () => buildTrendPoints(filteredRows, periodFilter),
    [filteredRows, periodFilter],
  );

  const topRevenue = useMemo(() => {
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
  }, [filteredRows]);

  const topRevenueRows = useMemo(
    () => [...topRevenue].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    [topRevenue],
  );
  const topProfitRows = useMemo(
    () => [...topRevenue].sort((a, b) => b.profit - a.profit).slice(0, 5),
    [topRevenue],
  );
  const topUsersRows = useMemo(
    () => [...topRevenue].sort((a, b) => b.users - a.users).slice(0, 5),
    [topRevenue],
  );

  const filteredTickets = useMemo(() => {
    if (!data) return [];
    const customerSet = new Set(
      filteredRows.map((row) => row.customer_name).filter((name): name is string => Boolean(name)),
    );
    return data.tickets.filter((ticket) => {
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
  }, [data, filteredRows, customerFilter, cloudFilter, periodFilter]);

  const filteredInboxItems = useMemo(() => {
    if (!data) return [];
    return data.inboxRows.filter((item) => {
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
  }, [data, periodFilter, customerFilter]);

  const viewer = useMemo(() => {
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
    const viewerName =
      typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()
        ? user.user_metadata.full_name
        : (user?.email ?? "demo@mml.local").split("@")[0];
    return { viewerName, viewerRole };
  }, [roles, user]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading dashboard…</CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load dashboard</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "Unknown error"}
        </AlertDescription>
      </Alert>
    );
  }

  const totalRevenue = filteredRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
  const totalInputCost = filteredRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
  const totalProfit = totalRevenue - totalInputCost;
  const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const publicLineCount = filteredRows.filter(
    (row) => row.repository_type === "public_cloud",
  ).length;
  const privateLineCount = filteredRows.filter(
    (row) => row.repository_type === "private_cloud",
  ).length;

  const latestPeriodPoint = trendRows
    .filter((row) => row.lineCount > 0)
    .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year))
    .at(-1);
  const currentPeriodRows = latestPeriodPoint
    ? filteredRows.filter(
        (row) => row.year === latestPeriodPoint.year && row.month === latestPeriodPoint.month,
      )
    : [];
  const currentMonthRevenue = currentPeriodRows.reduce(
    (sum, row) => addNullable(sum, row.selling_cost),
    0,
  );
  const currentMonthCost = currentPeriodRows.reduce(
    (sum, row) => addNullable(sum, lineCost(row)),
    0,
  );
  const currentMonthProfit = currentMonthRevenue - currentMonthCost;

  const previousPoint = latestPeriodPoint
    ? previousMonth({ year: latestPeriodPoint.year, month: latestPeriodPoint.month })
    : null;
  const previousRows = previousPoint
    ? deltaBaseRows.filter(
        (row) => row.year === previousPoint.year && row.month === previousPoint.month,
      )
    : [];
  const previousRevenue = previousRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
  const previousCost = previousRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
  const previousProfit = previousRevenue - previousCost;
  const previousMarginPct = previousRevenue > 0 ? (previousProfit / previousRevenue) * 100 : 0;
  const previousPublicCount = previousRows.filter(
    (row) => row.repository_type === "public_cloud",
  ).length;
  const previousPrivateCount = previousRows.filter(
    (row) => row.repository_type === "private_cloud",
  ).length;

  const revenueDelta = toPctChange(totalRevenue, previousRevenue);
  const costDelta = toPctChange(totalInputCost, previousCost);
  const profitDelta = toPctChange(totalProfit, previousProfit);
  const marginDelta = toPointChange(marginPct, previousMarginPct);
  const monthRevenueDelta = toPctChange(currentMonthRevenue, previousRevenue);
  const monthProfitDelta = toPctChange(currentMonthProfit, previousProfit);
  const publicCountDelta = previousRows.length > 0 ? publicLineCount - previousPublicCount : null;
  const privateCountDelta =
    previousRows.length > 0 ? privateLineCount - previousPrivateCount : null;

  const trendRevenue = trendRows.map((row) => emptyIfNull(row.revenue));
  const trendCost = trendRows.map((row) => emptyIfNull(row.inputCost));
  const trendProfit = trendRows.map((row) => emptyIfNull(row.profit));
  const trendMargin = trendRows.map((row) => emptyIfNull(row.marginPct));
  const trendPublic = trendRows.map((row) => row.publicCount);
  const trendPrivate = trendRows.map((row) => row.privateCount);

  const chartRevenueTotal = trendRows.reduce((sum, row) => sum + emptyIfNull(row.revenue), 0);
  const chartCostTotal = trendRows.reduce((sum, row) => sum + emptyIfNull(row.inputCost), 0);
  const chartMarginPct =
    chartRevenueTotal > 0 ? ((chartRevenueTotal - chartCostTotal) / chartRevenueTotal) * 100 : 0;
  const chartTitleSuffix = latestPeriodPoint ? latestPeriodPoint.year : new Date().getFullYear();

  const lobOrder = ["VILT", "Standalone", "Integrated"] as const;
  const lobRows = lobOrder.map((name) => ({
    name,
    value: filteredRows.filter((row) => (row.line_of_business ?? "VILT") === name).length,
  }));
  const lobTotal = lobRows.reduce((sum, row) => sum + row.value, 0);

  const ticketCounts = {
    open: filteredTickets.filter((ticket) => ticket.status === "Open").length,
    pending: filteredTickets.filter((ticket) => ticket.status === "Pending").length,
    overdue: filteredTickets.filter(isTicketOverdue).length,
    escalated: filteredTickets.filter((ticket) => ticket.is_escalated).length,
    resolved: filteredTickets.filter((ticket) => ticket.status === "Resolved").length,
    closed: filteredTickets.filter((ticket) => ticket.status === "Closed").length,
    total: filteredTickets.length,
  };
  const ticketsByAgent = [
    ...new Set(filteredTickets.map((ticket) => ticket.agent_name ?? "Unassigned")),
  ]
    .map((name) => ({
      name,
      count: filteredTickets.filter((ticket) => (ticket.agent_name ?? "Unassigned") === name)
        .length,
    }))
    .sort((a, b) => b.count - a.count);
  const maxTicketAgentCount = Math.max(...ticketsByAgent.map((row) => row.count), 1);

  const syncStats = summarizeFreshdeskRuns(data.syncOverview.freshdesk.runs);
  const pendingInbox = filteredInboxItems.filter((item) => item.status === "pending").slice(0, 3);
  const confirmedToday = filteredInboxItems.filter(
    (item) =>
      item.status === "confirmed" &&
      new Date(item.created_at).toDateString() === new Date().toDateString(),
  ).length;

  const roleOrder: AppRole[] = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"];
  const userEntries = roleOrder.map((role) => {
    const userIds = data.userRoles.filter((row) => row.role === role).map((row) => row.user_id);
    const profile = data.profiles.find((row) => userIds.includes(row.id));
    return {
      role,
      roleLabel: ROLE_LABEL[role],
      name: profile?.full_name ?? "Not assigned",
      isLive: LIVE_ROLES.includes(role) && Boolean(profile?.is_active),
      parked: PARKED_ROLES.includes(role),
    };
  });
  const livePersonaCount = userEntries.filter((entry) => entry.isLive).length;
  const parkedPersonaCount = userEntries.filter((entry) => entry.parked).length;
  const showAdminSection = hasRole("admin");

  return (
    <div
      className="space-y-3 rounded-xl p-3"
      style={{ background: PALETTE.pageBg, border: `1px solid ${PALETTE.border}` }}
    >
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          {isExampleCaptureMode ? (
            <span
              className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-bold"
              style={{ color: PALETTE.azure, borderColor: "#9bb8ef", background: "#e8f0ff" }}
            >
              EXAMPLE DATA
            </span>
          ) : null}
          <h2 className="mt-1 text-[38px] font-semibold leading-none">Dashboard</h2>
          <p className="mt-1 text-xs" style={{ color: PALETTE.textSecondary }}>
            Viewing as <strong>{viewer.viewerName}</strong> · <strong>{viewer.viewerRole}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-full border bg-white p-1"
            style={{ borderColor: PALETTE.border }}
          >
            <FilterChip
              active={cloudFilter === "public_cloud"}
              onClick={() => setCloudFilter("public_cloud")}
            >
              Public cloud
            </FilterChip>
            <FilterChip
              active={cloudFilter === "private_cloud"}
              onClick={() => setCloudFilter("private_cloud")}
            >
              Private cloud
            </FilterChip>
            <FilterChip active={cloudFilter === "all"} onClick={() => setCloudFilter("all")}>
              All
            </FilterChip>
          </div>
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger
              className="h-8 rounded-full border bg-white px-3 text-xs font-medium"
              style={{ borderColor: PALETTE.border }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customerOptions.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={periodFilter}
            onValueChange={(value) => setPeriodFilter(value as DashboardPeriodFilter)}
          >
            <SelectTrigger
              className="h-8 rounded-full border bg-white px-3 text-xs font-medium"
              style={{ borderColor: PALETTE.border }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-2 lg:grid-cols-4">
        <DashboardKpiCard
          label="Total revenue"
          value={fmtCurrency(totalRevenue)}
          tag="FYTD"
          delta={
            revenueDelta !== null
              ? `${revenueDelta >= 0 ? "+" : ""}${revenueDelta.toFixed(1)}% vs last month`
              : null
          }
          deltaTone={revenueDelta === null ? "neutral" : revenueDelta >= 0 ? "good" : "bad"}
          sparklineValues={trendRevenue}
        />
        <DashboardKpiCard
          label="Total input cost"
          value={fmtCurrency(totalInputCost)}
          tag="FYTD"
          delta={
            costDelta !== null
              ? `${costDelta >= 0 ? "+" : ""}${costDelta.toFixed(1)}% vs last month`
              : null
          }
          deltaTone={costDelta === null ? "neutral" : costDelta >= 0 ? "bad" : "good"}
          sparklineValues={trendCost}
        />
        <DashboardKpiCard
          label="Total profit"
          value={fmtCurrency(totalProfit)}
          tag="FYTD"
          delta={
            profitDelta !== null
              ? `${profitDelta >= 0 ? "+" : ""}${profitDelta.toFixed(1)}% vs last month`
              : null
          }
          deltaTone={profitDelta === null ? "neutral" : profitDelta >= 0 ? "good" : "bad"}
          sparklineValues={trendProfit}
        />
        <DashboardKpiCard
          label="Margin"
          value={`${marginPct.toFixed(1)}%`}
          tag="FYTD"
          delta={
            marginDelta !== null
              ? `${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)} pts vs last month`
              : null
          }
          deltaTone={marginDelta === null ? "neutral" : marginDelta >= 0 ? "good" : "bad"}
          sparklineValues={trendMargin}
        />
        <DashboardKpiCard
          label="Current month revenue"
          value={fmtCurrency(currentMonthRevenue)}
          tag="Current"
          delta={
            monthRevenueDelta !== null
              ? `${monthRevenueDelta >= 0 ? "+" : ""}${monthRevenueDelta.toFixed(1)}% vs last month`
              : null
          }
          deltaTone={
            monthRevenueDelta === null ? "neutral" : monthRevenueDelta >= 0 ? "good" : "bad"
          }
          sparklineValues={trendRevenue}
        />
        <DashboardKpiCard
          label="Current month profit"
          value={fmtCurrency(currentMonthProfit)}
          tag="Current"
          delta={
            monthProfitDelta !== null
              ? `${monthProfitDelta >= 0 ? "+" : ""}${monthProfitDelta.toFixed(1)}% vs last month`
              : null
          }
          deltaTone={monthProfitDelta === null ? "neutral" : monthProfitDelta >= 0 ? "good" : "bad"}
          sparklineValues={trendProfit}
        />
        <DashboardKpiCard
          label="Public cloud"
          value={fmtNumber(publicLineCount)}
          tag="Public"
          delta={
            publicCountDelta !== null
              ? `${publicCountDelta >= 0 ? "+" : ""}${fmtNumber(Math.abs(publicCountDelta))} ${Math.abs(publicCountDelta) === 1 ? "new line" : "new lines"}`
              : null
          }
          deltaTone={publicCountDelta === null ? "neutral" : publicCountDelta >= 0 ? "good" : "bad"}
          sparklineValues={trendPublic}
        />
        <DashboardKpiCard
          label="Private cloud"
          value={fmtNumber(privateLineCount)}
          tag="Private"
          delta={
            privateCountDelta !== null
              ? `${privateCountDelta >= 0 ? "+" : ""}${fmtNumber(Math.abs(privateCountDelta))} ${Math.abs(privateCountDelta) === 1 ? "new line" : "new lines"}`
              : null
          }
          deltaTone={
            privateCountDelta === null ? "neutral" : privateCountDelta >= 0 ? "good" : "bad"
          }
          sparklineValues={trendPrivate}
        />
      </section>

      <section className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        <Card
          className="rounded-xl border bg-white shadow-none"
          style={{ borderColor: PALETTE.border }}
        >
          <CardHeader className="px-3 pb-0 pt-2">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-sm font-semibold">
                Revenue by month — {chartTitleSuffix}
              </CardTitle>
              <span className="text-xs" style={{ color: PALETTE.textMuted }}>
                ☰
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-2">
            <div
              className="mb-2 flex flex-wrap items-center gap-3 text-[11px]"
              style={{ color: PALETTE.textSecondary }}
            >
              <LegendPill color={PALETTE.azure}>
                Revenue {fmtCurrency(chartRevenueTotal)}
              </LegendPill>
              <LegendPill color={PALETTE.azureSoft}>
                Input cost {fmtCurrency(chartCostTotal)}
              </LegendPill>
              <LegendPill color={PALETTE.gold}>Margin {chartMarginPct.toFixed(1)}%</LegendPill>
            </div>
            {trendRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={trendRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ebeff9" />
                  <XAxis dataKey="label" fontSize={11} tick={{ fill: PALETTE.textSecondary }} />
                  <YAxis
                    yAxisId="money"
                    fontSize={11}
                    tick={{ fill: PALETTE.textSecondary }}
                    tickFormatter={(value) => `${Math.round(value / 1000)}`}
                    label={{
                      value: "INR (thousands)",
                      angle: -90,
                      position: "insideLeft",
                      offset: 5,
                      fill: PALETTE.textSecondary,
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    yAxisId="margin"
                    orientation="right"
                    fontSize={11}
                    tick={{ fill: PALETTE.textSecondary }}
                    domain={[0, 50]}
                    tickFormatter={(value) => `${value}%`}
                    label={{
                      value: "Margin %",
                      angle: 90,
                      position: "insideRight",
                      offset: 2,
                      fill: PALETTE.textSecondary,
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    formatter={(value, key) => {
                      const numericValue =
                        typeof value === "number"
                          ? value
                          : typeof value === "string"
                            ? Number(value)
                            : NaN;
                      if (!Number.isFinite(numericValue)) return "—";
                      if (String(key).toLowerCase().includes("margin"))
                        return `${numericValue.toFixed(1)}%`;
                      return fmtCurrency(numericValue);
                    }}
                  />
                  <Bar
                    yAxisId="money"
                    dataKey="revenue"
                    name="Revenue"
                    fill={PALETTE.azure}
                    radius={[5, 5, 0, 0]}
                    barSize={18}
                  />
                  <Bar
                    yAxisId="money"
                    dataKey="inputCost"
                    name="Input cost"
                    fill={PALETTE.azureSoft}
                    radius={[5, 5, 0, 0]}
                    barSize={18}
                  />
                  <Line
                    yAxisId="margin"
                    type="monotone"
                    dataKey="marginPct"
                    name="Margin %"
                    stroke={PALETTE.gold}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  >
                    <LabelList
                      dataKey="marginPct"
                      position="top"
                      formatter={(value: number | null) =>
                        value === null ? "" : `${value.toFixed(1)}%`
                      }
                    />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyPanel />
            )}
          </CardContent>
        </Card>

        <Card
          className="rounded-xl border bg-white shadow-none"
          style={{ borderColor: PALETTE.border }}
        >
          <CardHeader className="px-3 pb-0 pt-2">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-sm font-semibold">Line of business split</CardTitle>
              <span className="text-xs" style={{ color: PALETTE.textMuted }}>
                ☰
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-2">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
              <div>
                {lobTotal > 0 ? (
                  <ResponsiveContainer width="100%" height={235}>
                    <PieChart>
                      <Pie
                        data={lobRows}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={62}
                        outerRadius={88}
                        stroke="#fff"
                        strokeWidth={2}
                      >
                        <Cell fill={PALETTE.azure} />
                        <Cell fill={PALETTE.teal} />
                        <Cell fill={PALETTE.purple} />
                      </Pie>
                      <text
                        x="50%"
                        y="48%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-foreground text-3xl font-bold"
                      >
                        {fmtNumber(lobTotal)}
                      </text>
                      <text
                        x="50%"
                        y="58%"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={PALETTE.textMuted}
                        fontSize={11}
                      >
                        Total lines
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyPanel compact />
                )}
              </div>
              <div className="space-y-2">
                {lobRows.map((lob, idx) => {
                  const pct = lobTotal > 0 ? (lob.value / lobTotal) * 100 : 0;
                  const color =
                    idx === 0 ? PALETTE.azure : idx === 1 ? PALETTE.teal : PALETTE.purple;
                  return (
                    <div
                      key={lob.name}
                      className="rounded-lg border p-2"
                      style={{ borderColor: PALETTE.border }}
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span>{lob.name}</span>
                        <strong>{pct.toFixed(1)}%</strong>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-[#edf1fb]">
                        <div
                          className="h-1.5 rounded-full"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-2 xl:grid-cols-3">
        <TopCustomerCard
          title="Top customers by revenue"
          rows={topRevenueRows}
          metricKey="revenue"
          metricFormatter={(value) => fmtCurrency(value)}
          barColor={PALETTE.azure}
        />
        <TopCustomerCard
          title="Top customers by profit"
          rows={topProfitRows}
          metricKey="profit"
          metricFormatter={(value) => fmtCurrency(value)}
          barColor={PALETTE.green}
        />
        <TopCustomerCard
          title="Top customers by users"
          rows={topUsersRows}
          metricKey="users"
          metricFormatter={(value) => fmtNumber(value)}
          barColor={PALETTE.teal}
        />
      </section>

      {showAdminSection ? (
        <section className="space-y-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-[15px] font-semibold" style={{ color: PALETTE.privateNavy }}>
                Admin and governance
              </h3>
              <p className="text-[11px]" style={{ color: PALETTE.textMuted }}>
                Shown to Super Admin only
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/admin"
                className="rounded-full border bg-white px-3 py-1 text-xs font-semibold"
                style={{ color: PALETTE.azure, borderColor: PALETTE.border }}
              >
                Admin settings
              </Link>
              <Link
                to="/mcp-audit"
                className="rounded-full border bg-white px-3 py-1 text-xs font-semibold"
                style={{ color: PALETTE.azure, borderColor: PALETTE.border }}
              >
                MCP audit log
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-4">
            <Card
              className="rounded-xl border bg-white shadow-none"
              style={{ borderColor: PALETTE.border }}
            >
              <CardHeader className="px-3 pb-0 pt-2">
                <CardTitle className="text-sm font-semibold">Users and roles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3 pt-2">
                <div className="grid grid-cols-1 gap-2">
                  {userEntries.map((entry) => (
                    <div
                      key={entry.role}
                      className={`grid grid-cols-[22px_1fr] items-center gap-2 rounded-lg border px-2 py-1 ${entry.parked ? "opacity-60" : ""}`}
                      style={{ borderColor: PALETTE.border }}
                    >
                      <div
                        className="grid h-[22px] w-[22px] place-items-center rounded-full text-[9px] font-bold"
                        style={{ color: PALETTE.azure, background: "#edf3ff" }}
                      >
                        {initials(entry.name)}
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold">{entry.name}</div>
                        <div className="text-[10px]" style={{ color: PALETTE.textMuted }}>
                          {entry.roleLabel} ·{" "}
                          {entry.parked ? "Parked" : entry.isLive ? "Live" : "Inactive"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="border-t pt-2 text-[11px]"
                  style={{ color: PALETTE.textSecondary, borderColor: PALETTE.border }}
                >
                  {livePersonaCount} live personas · {parkedPersonaCount} parked · last Super Admin
                  is protected
                </div>
              </CardContent>
            </Card>

            <Card
              className="rounded-xl border bg-white shadow-none"
              style={{ borderColor: PALETTE.border }}
            >
              <CardHeader className="px-3 pb-0 pt-2">
                <CardTitle className="text-sm font-semibold">Support tickets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3 pt-2">
                <div className="grid grid-cols-4 gap-1.5">
                  <MiniStat label="Open" value={ticketCounts.open} />
                  <MiniStat label="Pending" value={ticketCounts.pending} />
                  <MiniStat label="Overdue" value={ticketCounts.overdue} tone="bad" />
                  <MiniStat label="Escalated" value={ticketCounts.escalated} tone="bad" />
                </div>
                <div
                  className="text-[10px] font-semibold uppercase"
                  style={{ color: PALETTE.textMuted }}
                >
                  Tickets by agent ({fmtNumber(ticketCounts.total)} total)
                </div>
                <div className="space-y-1">
                  {ticketsByAgent.slice(0, 3).map((agent) => (
                    <div
                      key={agent.name}
                      className="grid grid-cols-[82px_1fr_16px] items-center gap-2 text-[11px]"
                    >
                      <span style={{ color: PALETTE.textSecondary }}>{agent.name}</span>
                      <div className="h-1.5 rounded-full bg-[#ebeff9]">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width: `${(agent.count / maxTicketAgentCount) * 100}%`,
                            background: PALETTE.privateNavy,
                          }}
                        />
                      </div>
                      <strong>{agent.count}</strong>
                    </div>
                  ))}
                </div>
                <div
                  className="border-t pt-2 text-[11px]"
                  style={{ color: PALETTE.textSecondary, borderColor: PALETTE.border }}
                >
                  Resolved {ticketCounts.resolved} · Closed {ticketCounts.closed} · can run
                  Freshdesk sync
                </div>
              </CardContent>
            </Card>

            <Card
              className="rounded-xl border bg-white shadow-none"
              style={{ borderColor: PALETTE.border }}
            >
              <CardHeader className="px-3 pb-0 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">Freshdesk ticket sync</CardTitle>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      color: syncStats.state === "ok" ? PALETTE.green : PALETTE.red,
                      background: syncStats.state === "ok" ? "#e6f4ec" : "#fdebed",
                    }}
                  >
                    {syncStats.state === "ok" ? "Healthy" : "Last run failed"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3 pt-2 text-[12px]">
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                  {syncStats.lastSuccess ? (
                    <>
                      <span style={{ color: PALETTE.textSecondary }}>Last successful run</span>
                      <strong>{formatRunDate(syncStats.lastSuccess.started_at)}</strong>
                    </>
                  ) : null}
                  <span style={{ color: PALETTE.textSecondary }}>Failures in a row</span>
                  <strong>{syncStats.failuresInRow}</strong>
                  <span style={{ color: PALETTE.textSecondary }}>Runs (last 24 h)</span>
                  <strong>{syncStats.runs24h}</strong>
                  <span style={{ color: PALETTE.textSecondary }}>Failed (last 24 h)</span>
                  <strong style={{ color: syncStats.failed24h > 0 ? PALETTE.red : PALETTE.green }}>
                    {syncStats.failed24h}
                  </strong>
                </div>
                {syncStats.lastFailed?.error_message ? (
                  <div
                    className="rounded-lg border px-2 py-1 text-[11px]"
                    style={{ borderColor: "#f3c9d0", background: "#fff3f6", color: PALETTE.red }}
                  >
                    Last error: {syncStats.lastFailed.error_message}
                  </div>
                ) : null}
                <div
                  className="border-t pt-2 text-[11px]"
                  style={{ color: PALETTE.textSecondary, borderColor: PALETTE.border }}
                >
                  Snapshot pipeline next run {formatRunDate(data.syncOverview.next_cron_at)} · Sync
                  now: Super Admin and Ops Lead
                </div>
              </CardContent>
            </Card>

            <Card
              className="rounded-xl border bg-white shadow-none"
              style={{ borderColor: PALETTE.border }}
            >
              <CardHeader className="px-3 pb-0 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">AI Command Center</CardTitle>
                  <span
                    className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                    style={{ borderColor: PALETTE.border, color: PALETTE.textSecondary }}
                  >
                    {pendingInbox.length} awaiting review
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 px-3 pb-3 pt-2">
                {pendingInbox.length > 0 ? (
                  pendingInbox.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border px-2 py-1.5"
                      style={{ borderColor: PALETTE.border }}
                    >
                      <div className="flex flex-wrap items-center gap-1">
                        <Chip>{getAgentName(item.agent_key)}</Chip>
                        <Chip>{itemTypeLabel(item.item_type)}</Chip>
                        <Chip pending>Pending</Chip>
                      </div>
                      <div className="mt-1 text-[12px] font-semibold">{item.title}</div>
                    </div>
                  ))
                ) : (
                  <div
                    className="rounded-lg border px-2 py-2 text-[11px]"
                    style={{ borderColor: PALETTE.border, color: PALETTE.textMuted }}
                  >
                    No pending review items.
                  </div>
                )}
                <div
                  className="border-t pt-2 text-[11px]"
                  style={{ color: PALETTE.textSecondary, borderColor: PALETTE.border }}
                >
                  {confirmedToday} confirmed today · live AI work approval: Super Admin only
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${active ? "" : "text-slate-600 hover:text-slate-900"}`}
      style={{
        border: `1px solid ${active ? PALETTE.azure : "transparent"}`,
        background: active ? "#edf3ff" : "transparent",
        color: active ? PALETTE.azure : undefined,
      }}
    >
      {children}
    </button>
  );
}

function DashboardKpiCard({
  label,
  value,
  tag,
  delta,
  deltaTone,
  sparklineValues,
}: {
  label: string;
  value: string;
  tag: string;
  delta: string | null;
  deltaTone: "good" | "bad" | "neutral";
  sparklineValues: number[];
}) {
  const sparkColor = deltaTone === "bad" ? PALETTE.red : PALETTE.green;
  return (
    <article
      className="rounded-xl border bg-white p-3 shadow-none"
      style={{ borderColor: PALETTE.border }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold" style={{ color: PALETTE.textMuted }}>
          {label}
        </div>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px]"
          style={{ borderColor: "#cbd4ea", color: PALETTE.textSecondary }}
        >
          {tag}
        </span>
      </div>
      <div className="mt-1 text-[42px] font-bold leading-none">{value}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {delta ? (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              color: deltaTone === "bad" ? PALETTE.red : PALETTE.green,
              background: deltaTone === "bad" ? "#fdebed" : "#e6f4ec",
            }}
          >
            {delta}
          </span>
        ) : (
          <span />
        )}
        <svg viewBox="0 0 66 20" className="h-5 w-[68px]" aria-label="Trend">
          <polyline
            fill="none"
            stroke={sparkColor}
            strokeWidth="1.8"
            points={sparklinePoints(sparklineValues)}
          />
        </svg>
      </div>
    </article>
  );
}

function TopCustomerCard({
  title,
  rows,
  metricKey,
  metricFormatter,
  barColor,
}: {
  title: string;
  rows: TopCustomer[];
  metricKey: "revenue" | "profit" | "users";
  metricFormatter: (value: number) => string;
  barColor: string;
}) {
  const total = rows.reduce((sum, row) => sum + row[metricKey], 0);
  return (
    <Card
      className="rounded-xl border bg-white shadow-none"
      style={{ borderColor: PALETTE.border }}
    >
      <CardHeader className="px-3 pb-0 pt-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <span className="text-xs" style={{ color: PALETTE.textMuted }}>
            ☰
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3 pt-2">
        {rows.length > 0 ? (
          rows.map((row) => {
            const share = total > 0 ? (row[metricKey] / total) * 100 : 0;
            return (
              <Link
                key={`${title}-${row.name}`}
                to="/customers"
                search={{ q: row.name, status: "all" as const }}
              >
                <article
                  className="rounded-lg border px-2.5 py-2 hover:bg-slate-50"
                  style={{ borderColor: PALETTE.border }}
                >
                  <div className="grid grid-cols-[28px_1fr_90px] items-center gap-2">
                    <div
                      className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold"
                      style={{ background: "#edf3ff", color: PALETTE.azure }}
                    >
                      {initials(row.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{row.name}</div>
                      <div className="text-[10px]" style={{ color: PALETTE.textMuted }}>
                        {row.dominantLob} · Share {share.toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-right text-xs font-bold">
                      {metricFormatter(row[metricKey])}
                    </div>
                  </div>
                  <div className="mt-1 h-[5px] rounded-full bg-[#ebeff9]">
                    <div
                      className="h-[5px] rounded-full"
                      style={{ width: `${share}%`, background: barColor }}
                    />
                  </div>
                </article>
              </Link>
            );
          })
        ) : (
          <EmptyPanel compact />
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "bad";
}) {
  return (
    <div className="rounded-lg border p-1.5" style={{ borderColor: PALETTE.border }}>
      <div className="text-[10px] font-semibold" style={{ color: PALETTE.textMuted }}>
        {label}
      </div>
      <div
        className="text-[18px] font-bold leading-none"
        style={{ color: tone === "bad" ? PALETTE.red : undefined }}
      >
        {fmtNumber(value)}
      </div>
    </div>
  );
}

function Chip({ children, pending = false }: { children: React.ReactNode; pending?: boolean }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={{
        borderColor: pending ? "#f5c2c7" : "#cbd4ea",
        color: pending ? PALETTE.red : PALETTE.textSecondary,
        background: pending ? "#fee6e8" : "#fff",
      }}
    >
      {children}
    </span>
  );
}

function LegendPill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function EmptyPanel({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`grid place-items-center rounded-lg border border-dashed text-sm ${compact ? "min-h-[96px]" : "min-h-[220px]"}`}
      style={{ borderColor: PALETTE.border, color: PALETTE.textMuted }}
    >
      No data yet
    </div>
  );
}
