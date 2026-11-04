// SCRUM-128 C5 (plan P03, D3, N14-N17): the Dashboard on the standard components. No page box, no
// in-page title (AppShell shows "Dashboard" and "Viewing as …"), no example tag of its own, no
// hex colours or inline styles. Data shaping lives in dashboard-data.ts (moved unchanged and
// pinned by dashboard-data.test.ts); the queries below are today's, plus potential_id and
// lab_name so the money tiles can show the SCRUM-131 incomplete note.
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartCard, ChartLegendRow } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { FilterBar, FilterSelect } from "@/components/filter-bar";
import { ErrorState, LoadingState } from "@/components/page-states";
import { supabase } from "@/integrations/supabase/client";
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_SERIES,
  CHART_SERIES_BG,
  CHART_TOOLTIP,
  PIE_SLICE_STROKE,
  chartSeriesBg,
  chartSeriesColor,
} from "@/lib/chart-standard";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { formatKpiPeriod, type KpiDelta, type KpiPeriod } from "@/lib/kpi-period";
import { incompleteNoteProps } from "@/lib/kpi-note";
import { readAllRows } from "@/lib/read-all";
import { getSyncOverview } from "@/lib/sync.functions";
import { AGENTS } from "@/lib/ai-command-center.functions";
import { useAuth } from "@/lib/auth-context";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { type DashboardPeriodFilter } from "@/components/summaries/dashboard-summary-utils";
import {
  DASHBOARD_TX_COLUMNS,
  EXAMPLE_INBOX,
  EXAMPLE_PROFILES,
  EXAMPLE_SYNC_OVERVIEW,
  EXAMPLE_TICKETS,
  EXAMPLE_TX_ROWS,
  EXAMPLE_USER_ROLES,
  applyTxFilters,
  buildPeriodOptions,
  chartBaseRowsOf,
  cloudAndPeriodRowsOf,
  customerOptionsOf,
  dashboardFilterPeriod,
  filterDashboardInbox,
  filterDashboardTickets,
  inboxSummaryOf,
  initials,
  lobRowsOf,
  resolveDashboardKpis,
  summarizeFreshdeskRuns,
  ticketCountsOf,
  ticketsByAgentOf,
  topCustomersBy,
  topCustomersOf,
  userEntriesOf,
  type CloudFilter,
  type DashboardData,
  type InboxSummaryRow,
  type ProfileRow,
  type TicketSummaryRow,
  type TopCustomer,
  type TxRow,
  type UserRoleRow,
} from "@/components/summaries/dashboard-data";

const LINES = { one: "line", other: "lines" } as const;

/** A signed delta, or none when today's code had no comparison (null). */
function deltaOf(
  value: number | null,
  comparedWith: KpiPeriod | null,
  unit: KpiDelta["unit"],
  goodWhen: KpiDelta["goodWhen"],
  noun?: KpiDelta["noun"],
): KpiDelta | null {
  if (value === null || comparedWith === null) return null;
  return { value, unit, comparedWith, goodWhen, ...(noun ? { noun } : {}) };
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

export function DashboardSuperAdminSummary() {
  const syncOverviewFn = useServerFn(getSyncOverview);
  const { hasRole } = useAuth();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const [cloudFilter, setCloudFilter] = useState<CloudFilter>("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState<DashboardPeriodFilter>("all");

  const { data, isLoading, isError, error, refetch } = useQuery({
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
                .select(DASHBOARD_TX_COLUMNS)
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

  const periodOptions = useMemo(() => buildPeriodOptions(data?.txRows), [data]);

  const cloudAndPeriodRows = useMemo(
    () => cloudAndPeriodRowsOf(data?.txRows, cloudFilter, periodFilter),
    [data, cloudFilter, periodFilter],
  );

  const customerOptions = useMemo(
    () => customerOptionsOf(cloudAndPeriodRows),
    [cloudAndPeriodRows],
  );

  useEffect(() => {
    if (customerFilter !== "all" && !customerOptions.includes(customerFilter)) {
      setCustomerFilter("all");
    }
  }, [customerFilter, customerOptions]);

  const filteredRows = useMemo(
    () => applyTxFilters(data?.txRows ?? [], cloudFilter, customerFilter, periodFilter),
    [data?.txRows, cloudFilter, customerFilter, periodFilter],
  );

  const chartBaseRows = useMemo(
    () => chartBaseRowsOf(data?.txRows, cloudFilter, customerFilter),
    [data, cloudFilter, customerFilter],
  );

  // The KPI tiles' periods (KPI_PERIOD_RULES) and their values, computed for those periods.
  const kpis = useMemo(
    () => resolveDashboardKpis(chartBaseRows, periodFilter),
    [chartBaseRows, periodFilter],
  );

  const topCustomers = useMemo(() => topCustomersOf(filteredRows), [filteredRows]);

  const filteredTickets = useMemo(
    () =>
      filterDashboardTickets(
        data?.tickets,
        filteredRows,
        customerFilter,
        cloudFilter,
        periodFilter,
      ),
    [data, filteredRows, customerFilter, cloudFilter, periodFilter],
  );

  const filteredInboxItems = useMemo(
    () => filterDashboardInbox(data?.inboxRows, periodFilter, customerFilter),
    [data, periodFilter, customerFilter],
  );

  if (isLoading) return <LoadingState thing="dashboard" />;

  if (isError || !data) {
    return <ErrorState thing="dashboard" error={error} onRetry={() => void refetch()} />;
  }

  const trendRows = kpis.trendRows;
  const chartRevenueTotal = trendRows.reduce((sum, row) => sum + row.revenue, 0);
  const chartCostTotal = trendRows.reduce((sum, row) => sum + row.inputCost, 0);
  const chartMarginPct =
    chartRevenueTotal > 0 ? ((chartRevenueTotal - chartCostTotal) / chartRevenueTotal) * 100 : 0;
  const chartWindow: KpiPeriod = {
    kind: "range",
    from: kpis.timeline[0],
    through: kpis.timeline[kpis.timeline.length - 1],
  };

  // Cards that follow the page filters (rows filtered with includesDashboardPeriod).
  const filterPeriod = dashboardFilterPeriod(periodFilter);
  const lobRows = lobRowsOf(filteredRows);
  const lobTotal = lobRows.reduce((sum, row) => sum + row.value, 0);

  const ticketCounts = ticketCountsOf(filteredTickets);
  const ticketsByAgent = ticketsByAgentOf(filteredTickets);
  const maxTicketAgentCount = Math.max(...ticketsByAgent.map((row) => row.count), 1);

  const syncStats = summarizeFreshdeskRuns(data.syncOverview.freshdesk.runs);
  const { pendingInbox, confirmedToday } = inboxSummaryOf(filteredInboxItems);

  const userEntries = userEntriesOf(data.profiles, data.userRoles);
  const livePersonaCount = userEntries.filter((entry) => entry.isLive).length;
  const parkedPersonaCount = userEntries.filter((entry) => entry.parked).length;
  const showAdminSection = hasRole("admin");

  const fyIncomplete = kpis.incompleteFy;
  const monthIncomplete = kpis.incompleteMonth;

  return (
    <div className="space-y-4">
      <FilterBar>
        <Tabs value={cloudFilter} onValueChange={(value) => setCloudFilter(value as CloudFilter)}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="private_cloud">Private cloud</TabsTrigger>
            <TabsTrigger value="public_cloud">Public cloud</TabsTrigger>
          </TabsList>
        </Tabs>
        <FilterSelect
          label="Customer"
          value={customerFilter}
          onValueChange={setCustomerFilter}
          allLabel="All customers"
          options={customerOptions.map((name) => ({ value: name, label: name }))}
          width="md"
        />
        <FilterSelect
          label="Period"
          value={periodFilter}
          onValueChange={(value) => setPeriodFilter(value as DashboardPeriodFilter)}
          options={periodOptions}
          width="md"
        />
      </FilterBar>

      <KpiGrid>
        <SummaryKpi
          label="Revenue"
          value={fmtCurrency(kpis.totalRevenue)}
          period={kpis.fyPeriod}
          delta={deltaOf(kpis.revenueDelta, kpis.fyComparedWith, "percent", "up")}
          {...incompleteNoteProps(fyIncomplete.count, fyIncomplete.revenue)}
        />
        <SummaryKpi
          label="Input cost"
          value={fmtCurrency(kpis.totalInputCost)}
          period={kpis.fyPeriod}
          delta={deltaOf(kpis.costDelta, kpis.fyComparedWith, "percent", "down")}
          {...incompleteNoteProps(fyIncomplete.count, fyIncomplete.inputCost)}
        />
        <SummaryKpi
          label="Profit"
          value={fmtCurrency(kpis.totalProfit)}
          period={kpis.fyPeriod}
          delta={deltaOf(kpis.profitDelta, kpis.fyComparedWith, "percent", "up")}
          {...incompleteNoteProps(
            fyIncomplete.count,
            fyIncomplete.revenue - fyIncomplete.inputCost,
          )}
        />
        <SummaryKpi
          label="Margin"
          value={`${kpis.marginPct.toFixed(1)}%`}
          period={kpis.fyPeriod}
          delta={deltaOf(kpis.marginDelta, kpis.fyComparedWith, "points", "up")}
        />
        <SummaryKpi
          label="Month revenue"
          value={fmtCurrency(kpis.monthRevenue)}
          period={kpis.monthPeriod}
          delta={deltaOf(kpis.monthRevenueDelta, kpis.monthComparedWith, "percent", "up")}
          {...incompleteNoteProps(monthIncomplete.count, monthIncomplete.revenue)}
        />
        <SummaryKpi
          label="Month profit"
          value={fmtCurrency(kpis.monthProfit)}
          period={kpis.monthPeriod}
          delta={deltaOf(kpis.monthProfitDelta, kpis.monthComparedWith, "percent", "up")}
          {...incompleteNoteProps(
            monthIncomplete.count,
            monthIncomplete.revenue - monthIncomplete.inputCost,
          )}
        />
        <SummaryKpi
          label="Public cloud"
          value={fmtNumber(kpis.publicLines)}
          period={kpis.cloudPeriod}
          delta={deltaOf(kpis.publicLinesDelta, kpis.cloudComparedWith, "count", "up", LINES)}
          subline="Lines"
        />
        <SummaryKpi
          label="Private cloud"
          value={fmtNumber(kpis.privateLines)}
          period={kpis.cloudPeriod}
          delta={deltaOf(kpis.privateLinesDelta, kpis.cloudComparedWith, "count", "up", LINES)}
          subline="Lines"
        />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Revenue by month" description={formatKpiPeriod(chartWindow)}>
          <div className="space-y-3">
            <ChartLegendRow
              items={[
                {
                  label: "Revenue",
                  value: fmtCurrency(chartRevenueTotal),
                  dotClass: CHART_SERIES_BG[0],
                },
                {
                  label: "Input cost",
                  value: fmtCurrency(chartCostTotal),
                  dotClass: CHART_SERIES_BG[1],
                },
                {
                  label: "Margin",
                  value: `${chartMarginPct.toFixed(1)}%`,
                  dotClass: CHART_SERIES_BG[2],
                },
              ]}
            />
            {chartRevenueTotal > 0 || chartCostTotal > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <ComposedChart data={trendRows}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="label" tick={CHART_AXIS_TICK} />
                  <YAxis
                    yAxisId="money"
                    tick={CHART_AXIS_TICK}
                    tickFormatter={(value) => `${Math.round(value / 1000)}`}
                    label={{
                      value: "INR (thousands)",
                      angle: -90,
                      position: "insideLeft",
                      offset: 5,
                      ...CHART_AXIS_TICK,
                    }}
                  />
                  <YAxis
                    yAxisId="margin"
                    orientation="right"
                    tick={CHART_AXIS_TICK}
                    domain={[0, 50]}
                    tickFormatter={(value) => `${value}%`}
                    label={{
                      value: "Margin %",
                      angle: 90,
                      position: "insideRight",
                      offset: 2,
                      ...CHART_AXIS_TICK,
                    }}
                  />
                  <Tooltip
                    {...CHART_TOOLTIP}
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
                    fill={CHART_SERIES[0]}
                    radius={[4, 4, 0, 0]}
                    barSize={18}
                  />
                  <Bar
                    yAxisId="money"
                    dataKey="inputCost"
                    name="Input cost"
                    fill={CHART_SERIES[1]}
                    radius={[4, 4, 0, 0]}
                    barSize={18}
                  />
                  <Line
                    yAxisId="margin"
                    type="linear"
                    dataKey="marginPct"
                    name="Margin %"
                    stroke={CHART_SERIES[2]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  >
                    <LabelList
                      dataKey="marginPct"
                      position="top"
                      fontSize={CHART_AXIS_TICK.fontSize}
                      formatter={(value: number | null) =>
                        value === null || value === 0 ? "" : `${value.toFixed(1)}%`
                      }
                    />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <NoDataYet />
            )}
          </div>
        </ChartCard>

        <ChartCard title="Lines by line of business" description={formatKpiPeriod(filterPeriod)}>
          {lobTotal > 0 ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <PieChart>
                  <Pie
                    data={lobRows}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={0}
                    outerRadius="82%"
                    {...PIE_SLICE_STROKE}
                  >
                    {lobRows.map((lob, idx) => (
                      <Cell key={lob.name} fill={chartSeriesColor(idx)} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP} formatter={(value: number) => fmtNumber(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                <SummaryKpi
                  variant="inset"
                  label="Total lines"
                  value={fmtNumber(lobTotal)}
                  period={filterPeriod}
                />
                <ul className="space-y-2">
                  {lobRows.map((lob, idx) => {
                    const pct = lobTotal > 0 ? (lob.value / lobTotal) * 100 : 0;
                    return (
                      <li key={lob.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={`size-2 shrink-0 rounded-full ${chartSeriesBg(idx)}`}
                              aria-hidden
                            />
                            <span className="truncate" title={lob.name}>
                              {lob.name}
                            </span>
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {fmtNumber(lob.value)} ·{" "}
                            <span className="text-foreground">{pct.toFixed(1)}%</span>
                          </span>
                        </div>
                        <Progress value={pct} className="h-1.5" aria-label={`${lob.name} share`} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <TopCustomerCard
          title="Top customers by revenue"
          rows={topCustomersBy(topCustomers, "revenue")}
          metricKey="revenue"
          metricFormatter={(value) => fmtCurrency(value)}
          period={filterPeriod}
        />
        <TopCustomerCard
          title="Top customers by profit"
          rows={topCustomersBy(topCustomers, "profit")}
          metricKey="profit"
          metricFormatter={(value) => fmtCurrency(value)}
          period={filterPeriod}
        />
        <TopCustomerCard
          title="Top customers by users"
          rows={topCustomersBy(topCustomers, "users")}
          metricKey="users"
          metricFormatter={(value) => fmtNumber(value)}
          period={filterPeriod}
        />
      </div>

      {showAdminSection ? (
        <section className="space-y-4" aria-labelledby="dashboard-admin-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="dashboard-admin-heading" className="text-sm font-semibold">
                Admin and governance
              </h2>
              <p className="text-xs text-muted-foreground">Shown to Super Admin only</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin">Admin settings</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/mcp-audit">MCP audit log</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-sm">Users and roles</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-2">
                  {userEntries.map((entry) => (
                    <li
                      key={entry.role}
                      className={`flex min-w-0 items-center gap-2 ${entry.parked ? "opacity-60" : ""}`}
                    >
                      <Avatar className="size-7">
                        <AvatarFallback className="text-xs">{initials(entry.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={entry.name}>
                          {entry.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline">{entry.roleLabel}</Badge>
                          {entry.parked ? (
                            <Badge variant="secondary">Parked</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {entry.isLive ? "Live" : "Inactive"}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                  {livePersonaCount} live personas · {parkedPersonaCount} parked · last Super Admin
                  is protected
                </p>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-sm">Support tickets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <SummaryKpi
                    variant="inset"
                    label="Open"
                    value={fmtNumber(ticketCounts.open)}
                    period={filterPeriod}
                  />
                  <SummaryKpi
                    variant="inset"
                    label="Pending"
                    value={fmtNumber(ticketCounts.pending)}
                    period={filterPeriod}
                  />
                  <SummaryKpi
                    variant="inset"
                    label="Overdue"
                    value={fmtNumber(ticketCounts.overdue)}
                    period={filterPeriod}
                    {...(ticketCounts.overdue > 0
                      ? { subline: "Needs action", sublineTone: "negative" as const }
                      : {})}
                  />
                  <SummaryKpi
                    variant="inset"
                    label="Escalated"
                    value={fmtNumber(ticketCounts.escalated)}
                    period={filterPeriod}
                    {...(ticketCounts.escalated > 0
                      ? { subline: "Needs action", sublineTone: "negative" as const }
                      : {})}
                  />
                </div>
                <div className="text-xs font-medium text-muted-foreground">
                  Tickets by agent ({fmtNumber(ticketCounts.total)} total)
                </div>
                <ul className="space-y-1">
                  {ticketsByAgent.slice(0, 3).map((agent) => (
                    <li
                      key={agent.name}
                      className="grid grid-cols-[minmax(0,6rem)_1fr_auto] items-center gap-2 text-xs"
                    >
                      <span className="truncate text-muted-foreground" title={agent.name}>
                        {agent.name}
                      </span>
                      <Progress
                        value={(agent.count / maxTicketAgentCount) * 100}
                        className="h-1.5"
                        aria-label={`${agent.name} tickets`}
                      />
                      <span className="font-medium tabular-nums">{agent.count}</span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                  Resolved {ticketCounts.resolved} · Closed {ticketCounts.closed} · can run
                  Freshdesk sync
                </p>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <CardTitle className="text-sm">Freshdesk ticket sync</CardTitle>
                <Badge variant={syncStats.state === "ok" ? "success" : "destructive"}>
                  {syncStats.state === "ok" ? "Healthy" : "Last run failed"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm">
                  {syncStats.lastSuccess ? (
                    <>
                      <dt className="text-muted-foreground">Last successful run</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {formatRunDate(syncStats.lastSuccess.started_at)}
                      </dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">Failures in a row</dt>
                  <dd className="text-right font-medium tabular-nums">{syncStats.failuresInRow}</dd>
                  <dt className="text-muted-foreground">Runs (last 24 h)</dt>
                  <dd className="text-right font-medium tabular-nums">{syncStats.runs24h}</dd>
                  <dt className="text-muted-foreground">Failed (last 24 h)</dt>
                  <dd
                    className={`text-right font-medium tabular-nums ${syncStats.failed24h > 0 ? "text-destructive" : "text-success"}`}
                  >
                    {syncStats.failed24h}
                  </dd>
                </dl>
                {syncStats.lastFailed?.error_message ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    Last error: {syncStats.lastFailed.error_message}
                  </p>
                ) : null}
                <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                  Snapshot pipeline next run {formatRunDate(data.syncOverview.next_cron_at)} · Sync
                  now: Super Admin and Ops Lead
                </p>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <CardTitle className="text-sm">AI Command Center</CardTitle>
                <Badge variant="secondary">{pendingInbox.length} awaiting review</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingInbox.length > 0 ? (
                  <ul className="space-y-2">
                    {pendingInbox.map((item) => (
                      <li key={item.id} className="rounded-md border border-border px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline">{getAgentName(item.agent_key)}</Badge>
                          <Badge variant="outline">{itemTypeLabel(item.item_type)}</Badge>
                          <Badge variant="warning">Pending</Badge>
                        </div>
                        <div className="mt-1 truncate text-sm font-medium" title={item.title}>
                          {item.title}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <NoDataYet compact message="No pending review items." />
                )}
                <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                  {confirmedToday} confirmed today · live AI work approval: Super Admin only
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TopCustomerCard({
  title,
  rows,
  metricKey,
  metricFormatter,
  period,
}: {
  title: string;
  rows: TopCustomer[];
  metricKey: "revenue" | "profit" | "users";
  metricFormatter: (value: number) => string;
  period: KpiPeriod;
}) {
  const total = rows.reduce((sum, row) => sum + row[metricKey], 0);
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription>{formatKpiPeriod(period)}</CardDescription>
        </div>
        <Link to="/customers" className="shrink-0 text-xs text-primary hover:underline">
          View all →
        </Link>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <ul className="space-y-1">
            {rows.map((row) => {
              const share = total > 0 ? (row[metricKey] / total) * 100 : 0;
              return (
                <li key={`${title}-${row.name}`}>
                  <Link
                    to="/customers"
                    search={{ q: row.name, status: "all" as const }}
                    className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/30"
                  >
                    <Avatar className="size-7">
                      <AvatarFallback className="text-xs">{initials(row.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-sm font-medium" title={row.name}>
                        {row.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.dominantLob} · Share {share.toFixed(1)}%
                      </div>
                      <Progress value={share} className="h-1.5" aria-label={`${row.name} share`} />
                    </div>
                    <div className="text-right text-sm font-medium tabular-nums">
                      {metricFormatter(row[metricKey])}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <NoDataYet compact />
        )}
      </CardContent>
    </Card>
  );
}
