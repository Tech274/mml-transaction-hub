import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtNumber, MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { readAllRows } from "@/lib/read-all";
import { getSyncOverview, type SyncRunRow } from "@/lib/sync.functions";
import { useAuth } from "@/lib/auth-context";
import { isLeadershipOnlyRoleSet } from "@/lib/leadership-access";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

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
  repository_type: string;
  start_date: string | null;
  end_date: string | null;
};

type AlertRow = {
  severity: "High" | "Medium";
  message: string;
  to: string;
  linkText: string;
};

type ModuleCardRow = {
  title: string;
  headline: string;
  status: string;
  statusTone: "good" | "warn";
  details: string[];
  to: string;
};

const EXAMPLE_ROWS: TxRow[] = [
  { month: 9, year: 2026, customer_name: "Cognizant", line_of_business: "VILT", cloud_provider: "Azure", selling_cost: 67600, input_cost: 48200, input_cost_actual_alloc: 46850, input_cost_auto: null, total_users: 42, repository_type: "public_cloud", start_date: "2026-09-02", end_date: "2026-09-28" },
  { month: 9, year: 2026, customer_name: "Infosys", line_of_business: "Standalone", cloud_provider: "AWS", selling_cost: 57500, input_cost: 39100, input_cost_actual_alloc: 38920, input_cost_auto: null, total_users: 30, repository_type: "public_cloud", start_date: "2026-09-05", end_date: "2026-09-27" },
  { month: 9, year: 2026, customer_name: "TCS", line_of_business: "VILT", cloud_provider: "Azure", selling_cost: 96500, input_cost: 73400, input_cost_actual_alloc: 72130, input_cost_auto: null, total_users: 55, repository_type: "public_cloud", start_date: "2026-09-01", end_date: "2026-09-29" },
  { month: 8, year: 2026, customer_name: "Wipro", line_of_business: "Standalone", cloud_provider: "GCP", selling_cost: 44600, input_cost: 28800, input_cost_actual_alloc: 28240, input_cost_auto: null, total_users: 24, repository_type: "public_cloud", start_date: "2026-08-03", end_date: "2026-08-26" },
  { month: 8, year: 2026, customer_name: "HCL", line_of_business: "Integrated", cloud_provider: "Azure", selling_cost: 63100, input_cost: 41900, input_cost_actual_alloc: 40210, input_cost_auto: null, total_users: 33, repository_type: "private_cloud", start_date: "2026-08-04", end_date: "2026-08-30" },
  { month: 7, year: 2026, customer_name: "Accenture", line_of_business: "Integrated", cloud_provider: "AWS", selling_cost: 68600, input_cost: 44600, input_cost_actual_alloc: 44120, input_cost_auto: null, total_users: 37, repository_type: "private_cloud", start_date: "2026-07-06", end_date: "2026-07-30" },
  { month: 7, year: 2026, customer_name: "Capgemini", line_of_business: "VILT", cloud_provider: "Azure", selling_cost: 35200, input_cost: 22900, input_cost_actual_alloc: 21980, input_cost_auto: null, total_users: 20, repository_type: "public_cloud", start_date: "2026-07-02", end_date: "2026-07-25" },
];

const EXAMPLE_SNAPSHOT_RUNS: SyncRunRow[] = [
  {
    id: "snap-901",
    kind: "snapshot",
    trigger_source: "cron",
    status: "success",
    customers_count: 412,
    transactions_count: 1643,
    report_rows: 1643,
    error_message: null,
    triggered_by_email: "system@mml.local",
    started_at: "2026-09-29T05:31:00Z",
    finished_at: "2026-09-29T05:33:00Z",
    duration_ms: 120000,
  },
  {
    id: "snap-900",
    kind: "snapshot",
    trigger_source: "cron",
    status: "error",
    customers_count: 0,
    transactions_count: 0,
    report_rows: 0,
    error_message: "Timeout while reading report snapshots.",
    triggered_by_email: "system@mml.local",
    started_at: "2026-09-29T01:31:00Z",
    finished_at: "2026-09-29T01:33:00Z",
    duration_ms: 120000,
  },
];

const EXAMPLE_FRESHDESK_RUNS: SyncRunRow[] = [
  {
    id: "fd-821",
    kind: "freshdesk",
    trigger_source: "hourly",
    status: "success",
    customers_count: 0,
    transactions_count: 0,
    report_rows: 0,
    error_message: null,
    triggered_by_email: "system@mml.local",
    started_at: "2026-09-29T05:00:00Z",
    finished_at: "2026-09-29T05:02:00Z",
    duration_ms: 120000,
    fetched_count: 32,
    upserted_count: 9,
  },
  {
    id: "fd-820",
    kind: "freshdesk",
    trigger_source: "hourly",
    status: "error",
    customers_count: 0,
    transactions_count: 0,
    report_rows: 0,
    error_message: "Freshdesk rate limit, retry succeeded next run.",
    triggered_by_email: "system@mml.local",
    started_at: "2026-09-29T04:00:00Z",
    finished_at: "2026-09-29T04:01:00Z",
    duration_ms: 60000,
    fetched_count: 0,
    upserted_count: 0,
  },
];

function lineCost(row: Pick<TxRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatRunTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function summarizeRunHealth(rows: SyncRunRow[]) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = rows.filter((row) => new Date(row.started_at).getTime() >= dayAgo);
  const fails = recent.filter((row) => row.status !== "success");
  return {
    lastRun: rows[0] ?? null,
    runs24h: recent.length,
    fails24h: fails.length,
    lastError: fails[0]?.error_message ?? "None",
    healthy: fails.length === 0 && rows.length > 0,
  };
}

export function DashboardSummary() {
  const syncOverviewFn = useServerFn(getSyncOverview);
  const { roles } = useAuth();
  const isLeadershipOnly = isLeadershipOnlyRoleSet(roles);
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-summary-v3"],
    queryFn: async () => {
      const now = new Date();
      const nowYear = now.getFullYear();

      const txRows = isExampleCaptureMode
        ? EXAMPLE_ROWS
        : await readAllRows(
            () =>
              supabase
                .from("transactions")
                .select(
                  "month,year,customer_name,line_of_business,cloud_provider,selling_cost,input_cost,input_cost_actual_alloc,input_cost_auto,total_users,repository_type,start_date,end_date,is_deleted",
                )
                .eq("is_deleted", false)
                .order("id"),
            "Dashboard summary transactions",
          ) as TxRow[];

      const [customerCountResult, openTicketsResult, pendingProposalsResult, syncOverview] =
        isExampleCaptureMode
          ? [
              { count: 12 },
              { count: 9 },
              { count: 3 },
              {
                runs: EXAMPLE_SNAPSHOT_RUNS,
                last_success: EXAMPLE_SNAPSHOT_RUNS[0],
                live_counts: { customers: 12, transactions: txRows.length },
                snapshot_rows: txRows.length,
                count_error_refs: [],
                next_cron_at: "2026-09-30T02:00:00.000Z",
                snapshot_schedule_utc: "02:00 UTC",
                freshdesk: {
                  runs: EXAMPLE_FRESHDESK_RUNS,
                  health: { state: "ok", message: "Freshdesk sync healthy" },
                },
              },
            ]
          : await Promise.all([
              supabase.from("customers").select("id", { head: true, count: "exact" }).eq("is_active", true),
              supabase
                .from("freshdesk_tickets")
                .select("id", { head: true, count: "exact" })
                .in("status", ["Open", "Pending", "Waiting on Customer", "Waiting on Third Party"]),
              supabase.from("ai_cc_inbox").select("id", { head: true, count: "exact" }).eq("status", "pending"),
              syncOverviewFn(),
            ]);

      const availableYears = txRows
        .map((row) => row.year)
        .filter((value): value is number => typeof value === "number");
      const year = availableYears.includes(nowYear)
        ? nowYear
        : (availableYears.sort((a, b) => b - a)[0] ?? nowYear);

      const byMonth = Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const rows = txRows.filter((row) => row.year === year && row.month === month);
        const revenue = rows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
        const inputCost = rows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
        const marginPct = revenue > 0 ? ((revenue - inputCost) / revenue) * 100 : 0;
        return {
          month,
          monthLabel: `${MONTH_NAMES[idx].slice(0, 3)} ${String(year).slice(2)}`,
          revenue,
          inputCost,
          marginPct: Number(marginPct.toFixed(1)),
        };
      });
      const fytd = byMonth.filter((row) => row.revenue > 0 || row.inputCost > 0);

      const revenue = txRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
      const cost = txRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
      const profit = revenue - cost;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
      const labUsers = txRows.reduce((sum, row) => addNullable(sum, row.total_users), 0);

      const publicRows = txRows.filter((row) => row.repository_type === "public_cloud");
      const privateRows = txRows.filter((row) => row.repository_type === "private_cloud");
      const publicRevenue = publicRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
      const privateRevenue = privateRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);

      const customerMap = new Map<string, { revenue: number; cost: number; users: number }>();
      for (const row of txRows) {
        const key = row.customer_name ?? "Unknown";
        const current = customerMap.get(key) ?? { revenue: 0, cost: 0, users: 0 };
        current.revenue = addNullable(current.revenue, row.selling_cost);
        current.cost = addNullable(current.cost, lineCost(row));
        current.users = addNullable(current.users, row.total_users);
        customerMap.set(key, current);
      }
      const topCustomers = [...customerMap.entries()]
        .map(([name, values]) => ({
          name,
          revenue: values.revenue,
          marginPct: values.revenue > 0 ? ((values.revenue - values.cost) / values.revenue) * 100 : 0,
          users: values.users,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);

      const openTickets = openTicketsResult.count ?? 0;
      const pendingProposals = pendingProposalsResult.count ?? 0;
      const keyAlerts: AlertRow[] = [];
      if (openTickets > 0) {
        keyAlerts.push({
          severity: openTickets >= 8 ? "High" : "Medium",
          message: `${fmtNumber(openTickets)} support tickets need triage.`,
          to: "/tickets",
          linkText: "Open tickets",
        });
      }
      if (pendingProposals > 0) {
        keyAlerts.push({
          severity: pendingProposals >= 5 ? "High" : "Medium",
          message: `${fmtNumber(pendingProposals)} AI proposals are waiting for review.`,
          to: "/ai-command-center/inbox",
          linkText: "Review queue",
        });
      }
      if (syncOverview.freshdesk.health.state !== "ok") {
        keyAlerts.push({
          severity: "High",
          message: syncOverview.freshdesk.health.message,
          to: "/sync-status",
          linkText: "Open sync status",
        });
      }
      if (keyAlerts.length === 0) {
        keyAlerts.push({
          severity: "Medium",
          message: "No active incidents. Continue normal monitoring.",
          to: "/sync-status",
          linkText: "Open sync status",
        });
      }

      const snapshotHealth = summarizeRunHealth(syncOverview.runs);
      const freshdeskHealth = summarizeRunHealth(syncOverview.freshdesk.runs);
      const lastDataRefresh = [snapshotHealth.lastRun?.started_at, freshdeskHealth.lastRun?.started_at]
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

      const moduleCards: ModuleCardRow[] = [
        {
          title: "Support tickets",
          headline: fmtNumber(openTickets),
          status: openTickets > 8 ? "Watch" : "Healthy",
          statusTone: openTickets > 8 ? "warn" : "good",
          details: [
            `Pending review: ${fmtNumber(pendingProposals)}`,
            `Freshdesk health: ${syncOverview.freshdesk.health.state === "ok" ? "Healthy" : "Attention"}`,
            `24h failures: ${fmtNumber(freshdeskHealth.fails24h)}`,
          ],
          to: "/tickets",
        },
        {
          title: "Public cloud",
          headline: fmtNumber(publicRows.length),
          status: publicRows.length > 0 ? "Active" : "No data",
          statusTone: publicRows.length > 0 ? "good" : "warn",
          details: [
            `Revenue: ${fmtCurrency(publicRevenue)}`,
            `Lab users: ${fmtNumber(publicRows.reduce((sum, row) => addNullable(sum, row.total_users), 0))}`,
            `Share: ${revenue > 0 ? ((publicRevenue / revenue) * 100).toFixed(1) : "0.0"}%`,
          ],
          to: "/public-cloud",
        },
        {
          title: "Private cloud",
          headline: fmtNumber(privateRows.length),
          status: privateRows.length > 0 ? "Active" : "No data",
          statusTone: privateRows.length > 0 ? "good" : "warn",
          details: [
            `Revenue: ${fmtCurrency(privateRevenue)}`,
            `Lab users: ${fmtNumber(privateRows.reduce((sum, row) => addNullable(sum, row.total_users), 0))}`,
            `Share: ${revenue > 0 ? ((privateRevenue / revenue) * 100).toFixed(1) : "0.0"}%`,
          ],
          to: "/private-cloud",
        },
        {
          title: "Agents",
          headline: "3",
          status: "Enabled",
          statusTone: "good",
          details: [
            `Runs in 24h: ${fmtNumber(snapshotHealth.runs24h + freshdeskHealth.runs24h)}`,
            `Pending reviews: ${fmtNumber(pendingProposals)}`,
            `Fails in 24h: ${fmtNumber(snapshotHealth.fails24h + freshdeskHealth.fails24h)}`,
          ],
          to: "/ai-command-center/agents",
        },
        {
          title: "AI Command Center",
          headline: fmtNumber(pendingProposals),
          status: pendingProposals > 0 ? "Action needed" : "Healthy",
          statusTone: pendingProposals > 0 ? "warn" : "good",
          details: [
            `Review queue: ${fmtNumber(pendingProposals)}`,
            `Freshdesk state: ${syncOverview.freshdesk.health.state === "ok" ? "Healthy" : "Attention"}`,
            `Next snapshot: ${new Date(syncOverview.next_cron_at).toLocaleTimeString()}`,
          ],
          to: "/ai-command-center",
        },
      ];

      return {
        year,
        fytd,
        customerCount: customerCountResult.count ?? 0,
        labUsers,
        publicCount: publicRows.length,
        privateCount: privateRows.length,
        revenue,
        cost,
        profit,
        marginPct,
        openTickets,
        pendingProposals,
        topCustomers,
        keyAlerts,
        moduleCards,
        snapshotHealth,
        freshdeskHealth,
        lastDataRefresh,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading dashboard summary…</CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load Dashboard summary</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
      </Alert>
    );
  }

  const showModules = !isLeadershipOnly;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <RichKpiCard
          label="Total customers"
          value={fmtNumber(data.customerCount)}
          badge="Live"
          lines={[
            `Lab users: ${fmtNumber(data.labUsers)}`,
            `Public / Private split: ${fmtNumber(data.publicCount)} / ${fmtNumber(data.privateCount)}`,
          ]}
          to="/customers"
          footer="Customers >"
        />
        <RichKpiCard
          label="Revenue"
          value={fmtCurrency(data.revenue)}
          badge="FYTD"
          lines={[
            `Input cost: ${fmtCurrency(data.cost)}`,
            `Profit: ${fmtCurrency(data.profit)}`,
          ]}
          to="/reports"
          footer="Reports >"
        />
        <RichKpiCard
          label="Margin"
          value={`${data.marginPct.toFixed(1)}%`}
          badge={data.marginPct >= 25 ? "Healthy" : "Watch"}
          tone={data.marginPct >= 25 ? "good" : "warn"}
          lines={[
            `Revenue: ${fmtCurrency(data.revenue)}`,
            `Input cost: ${fmtCurrency(data.cost)}`,
          ]}
          to="/reports"
          footer="Margin details >"
        />
        <RichKpiCard
          label="Open tickets"
          value={fmtNumber(data.openTickets)}
          badge={data.openTickets >= 8 ? "High" : "Medium"}
          tone={data.openTickets >= 8 ? "warn" : "good"}
          lines={[
            `Pending AI proposals: ${fmtNumber(data.pendingProposals)}`,
            `Queue owner: Support desk`,
          ]}
          to="/tickets"
          footer="Support tickets >"
        />
        <RichKpiCard
          label="Snapshot health"
          value={data.snapshotHealth.healthy ? "Healthy" : "Attention"}
          badge={`${fmtNumber(data.snapshotHealth.fails24h)} fails / 24h`}
          tone={data.snapshotHealth.healthy ? "good" : "warn"}
          lines={[
            `Runs in 24h: ${fmtNumber(data.snapshotHealth.runs24h)}`,
            `Last run: ${formatRunTime(data.snapshotHealth.lastRun?.started_at ?? null)}`,
          ]}
          to="/sync-status"
          footer="Sync status >"
        />
        <RichKpiCard
          label="Freshdesk sync"
          value={data.freshdeskHealth.healthy ? "Healthy" : "Attention"}
          badge={`${fmtNumber(data.freshdeskHealth.fails24h)} fails / 24h`}
          tone={data.freshdeskHealth.healthy ? "good" : "warn"}
          lines={[
            `Runs in 24h: ${fmtNumber(data.freshdeskHealth.runs24h)}`,
            `Last run: ${formatRunTime(data.freshdeskHealth.lastRun?.started_at ?? null)}`,
          ]}
          to="/sync-status"
          footer="Freshdesk health >"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Revenue snapshot (FYTD)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.fytd.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={data.fytd}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="monthLabel" fontSize={12} />
                  <YAxis yAxisId="money" fontSize={12} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                  <YAxis yAxisId="margin" orientation="right" fontSize={12} tickFormatter={(value) => `${value}%`} />
                  <Tooltip
                    formatter={(value: number, key) =>
                      String(key).includes("margin") || String(key).includes("Margin")
                        ? `${value.toFixed(1)}%`
                        : fmtCurrency(value)}
                  />
                  <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="money" dataKey="inputCost" name="Input cost" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="margin" dataKey="marginPct" name="Margin %" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 3 }}>
                    <LabelList dataKey="marginPct" position="top" formatter={(value: number) => `${value.toFixed(1)}%`} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <NoDataYet />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Key alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.keyAlerts.map((alert) => (
              <div key={`${alert.to}-${alert.message}`} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={alert.severity === "High" ? "destructive" : "secondary"}>{alert.severity}</Badge>
                  <Link to={alert.to as never} className="text-xs text-primary hover:underline">
                    {alert.linkText}
                  </Link>
                </div>
                <p className="mt-2 text-sm">{alert.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {showModules && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {data.moduleCards.map((module) => (
            <Card key={module.title}>
              <CardHeader className="space-y-2 pb-2">
                <div className="text-xs text-muted-foreground">{module.title}</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xl font-semibold">{module.headline}</div>
                  <Badge variant={module.statusTone === "good" ? "default" : "secondary"}>{module.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                {module.details.map((detail) => (
                  <div key={detail} className="rounded-sm border border-border px-2 py-1">
                    {detail}
                  </div>
                ))}
                <Link to={module.to as never} className="mt-2 inline-flex text-xs text-primary hover:underline">
                  Open summary &gt;
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <HealthPanel
              label="Freshdesk ticket sync"
              healthy={data.freshdeskHealth.healthy}
              lastRun={data.freshdeskHealth.lastRun?.started_at ?? null}
              runs24h={data.freshdeskHealth.runs24h}
              fails24h={data.freshdeskHealth.fails24h}
              lastError={data.freshdeskHealth.lastError}
            />
            <HealthPanel
              label="Snapshot pipeline"
              healthy={data.snapshotHealth.healthy}
              lastRun={data.snapshotHealth.lastRun?.started_at ?? null}
              runs24h={data.snapshotHealth.runs24h}
              fails24h={data.snapshotHealth.fails24h}
              lastError={data.snapshotHealth.lastError}
            />
            <div className="text-xs text-muted-foreground">
              Last data refresh: {formatRunTime(data.lastDataRefresh)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topCustomers.length > 0 ? (
              data.topCustomers.map((customer) => (
                <Link
                  key={customer.name}
                  to="/customers"
                  search={{ q: customer.name, status: "all" }}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(customer.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{customer.name}</div>
                      <div className="text-xs text-muted-foreground">{fmtNumber(customer.users)} lab users</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-medium">{fmtCurrency(customer.revenue)}</div>
                      <div className="text-xs text-muted-foreground">{customer.marginPct.toFixed(1)}% margin</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))
            ) : (
              <NoDataYet compact />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NoDataYet({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`grid w-full place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground ${
        compact ? "min-h-[96px]" : "min-h-[250px]"
      }`}
    >
      No data yet
    </div>
  );
}

function RichKpiCard({
  label,
  value,
  badge,
  tone = "good",
  lines,
  to,
  footer,
}: {
  label: string;
  value: string;
  badge: string;
  tone?: "good" | "warn";
  lines: string[];
  to: string;
  footer: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">{label}</div>
          <Badge variant={tone === "good" ? "default" : "secondary"}>{badge}</Badge>
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
        <Link to={to as never} className="mt-3 inline-flex text-xs text-primary hover:underline">
          {footer}
        </Link>
      </CardContent>
    </Card>
  );
}

function HealthPanel({
  label,
  healthy,
  lastRun,
  runs24h,
  fails24h,
  lastError,
}: {
  label: string;
  healthy: boolean;
  lastRun: string | null;
  runs24h: number;
  fails24h: number;
  lastError: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{label}</div>
        <Badge variant={healthy ? "default" : "secondary"} className="gap-1">
          {healthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {healthy ? "Healthy" : "Attention"}
        </Badge>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div>Last run: {formatRunTime(lastRun)}</div>
        <div>Runs in 24h: {fmtNumber(runs24h)}</div>
        <div>Fails in 24h: {fmtNumber(fails24h)}</div>
        <div className="truncate">Last error: {lastError}</div>
      </div>
    </div>
  );
}
