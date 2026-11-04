// SCRUM-128 C6 (plan P06): the Public cloud page on the shared standard. Data shaping lives in
// public-cloud-data.ts (moved verbatim; value pins in __tests__/cloud-ai-summaries-data.test.ts).
// The page description is the AppShell description (routes/_authenticated/public-cloud.tsx).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { readAllRows } from "@/lib/read-all";
import { incompleteNoteProps } from "@/lib/kpi-note";
import { formatKpiPeriod } from "@/lib/kpi-period";
import { noteCountForTab, type CompletenessTab } from "@/lib/completeness-tabs";
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_SERIES,
  CHART_TOOLTIP,
  PIE_SLICE_STROKE,
  chartSeriesColor,
} from "@/lib/chart-standard";
import { ErrorState, LoadingState } from "@/components/page-states";
import { ChartCard } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { CompletenessCard } from "@/components/summaries/completeness-card";
import { CompletenessTabs } from "@/components/summaries/completeness-tabs";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { TransactionListCard } from "@/components/summaries/transaction-list-card";
import {
  EXAMPLE_ROWS,
  lineCost,
  publicCloudView,
  type PublicCloudRow,
} from "@/components/summaries/public-cloud-data";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

const thousands = (value: number) => `${Math.round(value / 1000)}k`;

export function PublicCloudSummary({
  tab: tabProp,
  onTabChange,
}: { tab?: CompletenessTab; onTabChange?: (tab: CompletenessTab) => void } = {}) {
  const [tabState, setTabState] = useState<CompletenessTab>("all");
  const tab = tabProp ?? tabState;
  const setTab = onTabChange ?? setTabState;
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["public-cloud-summary-v1"],
    queryFn: async () => {
      const rows = isExampleCaptureMode
        ? EXAMPLE_ROWS
        : await readAllRows(
            () =>
              supabase
                .from("transactions")
                .select(
                  "id,potential_id,customer_name,lab_name,cloud_provider,line_of_business,selling_cost,input_cost,input_cost_auto,input_cost_actual_alloc,total_users,start_date,end_date,public_credit_allocated,public_actual_consumption,public_unused_credit,month,year,is_deleted",
                )
                .eq("repository_type", "public_cloud")
                .eq("is_deleted", false)
                .order("id"),
            "Public cloud summary transactions",
          );
      return { rows: rows as PublicCloudRow[] };
    },
  });

  const allRows = data?.rows;
  // Periods come from the one rules table (lib/kpi-period.ts); rows are filtered to the same
  // period the label states, so a Chief Q6 change there moves label and maths together.
  const page = useMemo(() => (allRows ? publicCloudView(allRows, tab) : null), [allRows, tab]);

  if (isLoading) return <LoadingState thing="public cloud summary" />;
  if (isError || !data || !page) {
    return <ErrorState thing="public cloud summary" error={error} onRetry={() => void refetch()} />;
  }
  const { view, cardSplit, tabCounts, totalsPeriod, livePeriod, completenessPeriod } = page;
  const monthSeries = view.byMonth.filter((row) => row.revenue > 0 || row.cost > 0);
  const lobTotal = view.lobSplit.reduce((sum, row) => sum + row.value, 0);
  const comp = view.completeness.complete;
  const inc = view.completeness.incomplete;
  const noteCount = noteCountForTab(tab, inc.count);
  const totalsLabel = formatKpiPeriod(totalsPeriod);
  const chartYearLabel = formatKpiPeriod({ kind: "year", year: view.chartYear, basis: "calendar" });

  return (
    <div className="space-y-4">
      <CompletenessCard
        complete={cardSplit.complete}
        incomplete={cardSplit.incomplete}
        period={completenessPeriod}
        onViewIncomplete={() => setTab("incomplete")}
      />
      <CompletenessTabs value={tab} onChange={setTab} counts={tabCounts} />
      <KpiGrid>
        <SummaryKpi
          period={totalsPeriod}
          label="Revenue"
          value={fmtCurrency(view.revenue)}
          subline={`Input cost ${fmtCurrency(view.inputCost)}`}
          {...incompleteNoteProps(noteCount, view.incompleteRevenue)}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Profit"
          value={fmtCurrency(view.profit)}
          subline={`Margin ${view.marginPct.toFixed(1)}%`}
          {...incompleteNoteProps(noteCount, view.incompleteProfit)}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Lines"
          value={fmtNumber(view.rows.length)}
          subline={`${fmtNumber(comp.users + inc.users)} users`}
          {...incompleteNoteProps(noteCount, null)}
        />
        <SummaryKpi
          period={livePeriod}
          label="Running now"
          value={fmtNumber(view.runningNow)}
          subline={`Ending soon ${fmtNumber(view.endingSoon)}`}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Credit used"
          value={fmtCurrency(view.creditUsed)}
          subline="Across cloud providers"
          {...incompleteNoteProps(noteCount, view.incompleteCredit)}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="LOB entries"
          value={fmtNumber(lobTotal)}
          subline="VILT · Standalone · Integrated"
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Top customer"
          value={view.topCustomers[0]?.name ?? "—"}
          subline={view.topCustomers[0] ? fmtCurrency(view.topCustomers[0].value) : "No data"}
        />
        <SummaryKpi
          period={livePeriod}
          label="Status"
          value={view.runningNow > 0 ? "Active" : "Quiet"}
          subline={view.runningNow > 0 ? "Live labs running" : "No live labs"}
        />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Cost overview by month" description={chartYearLabel}>
          {monthSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart data={monthSeries}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="monthLabel" tick={CHART_AXIS_TICK} />
                <YAxis tick={CHART_AXIS_TICK} tickFormatter={thousands} />
                <Tooltip {...CHART_TOOLTIP} formatter={(value: number) => fmtCurrency(value)} />
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill={CHART_SERIES[0]}
                  radius={[4, 4, 0, 0]}
                />
                <Line dataKey="cost" name="Input cost" stroke={CHART_SERIES[1]} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>

        <ChartCard title="Revenue by cloud provider" description={totalsLabel}>
          {view.providerRevenue.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={view.providerRevenue}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" tick={CHART_AXIS_TICK} />
                <YAxis tick={CHART_AXIS_TICK} tickFormatter={thousands} />
                <Tooltip {...CHART_TOOLTIP} formatter={(value: number) => fmtCurrency(value)} />
                <Bar dataKey="value" name="Revenue" fill={CHART_SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Line of business split" description={totalsLabel}>
          {view.lobSplit.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={view.lobSplit}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={90}
                  innerRadius={58}
                  {...PIE_SLICE_STROKE}
                >
                  {view.lobSplit.map((slice, idx) => (
                    <Cell key={slice.name} fill={chartSeriesColor(idx)} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-foreground text-sm font-semibold"
                >
                  {fmtNumber(lobTotal)}
                </text>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
        <ChartCard title="Lab status" description={`${totalsLabel} · status as of today`}>
          {view.statusSplit.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={view.statusSplit}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" tick={CHART_AXIS_TICK} />
                <YAxis tick={CHART_AXIS_TICK} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="value" name="Lines" fill={CHART_SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Credit utilisation by provider" description={totalsLabel}>
          {view.providerCredit.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart data={view.providerCredit}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" tick={CHART_AXIS_TICK} />
                <YAxis yAxisId="money" tick={CHART_AXIS_TICK} tickFormatter={thousands} />
                <YAxis
                  yAxisId="pct"
                  orientation="right"
                  tick={CHART_AXIS_TICK}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(value: number, key) =>
                    String(key).includes("Pct") ? `${value}%` : fmtCurrency(value)
                  }
                />
                <Bar
                  yAxisId="money"
                  dataKey="allocated"
                  name="Allocated credit"
                  fill={CHART_SERIES[1]}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="money"
                  dataKey="used"
                  name="Used credit"
                  fill={CHART_SERIES[0]}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="pct"
                  dataKey="utilizationPct"
                  name="Utilization %"
                  stroke={CHART_SERIES[2]}
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
        <ChartCard title="Top public cloud customers" description={totalsLabel}>
          {view.topCustomers.length > 0 ? (
            <ul className="space-y-2">
              {view.topCustomers.map((customer) => (
                <li key={customer.name}>
                  <Link
                    to="/customers"
                    search={{ q: customer.name, status: "all" }}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/30"
                  >
                    <span className="min-w-0 truncate text-sm font-medium" title={customer.name}>
                      {customer.name}
                    </span>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {fmtCurrency(customer.value)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <NoDataYet compact />
          )}
        </ChartCard>
      </div>

      <TransactionListCard title="Public cloud transactions" rows={view.rows} costOf={lineCost} />
    </div>
  );
}
