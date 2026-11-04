// SCRUM-128 C6 (plan P07): the Private cloud page on the shared standard. Data shaping lives in
// private-cloud-data.ts (moved verbatim; value pins in __tests__/cloud-ai-summaries-data.test.ts).
// The page description is the AppShell description (routes/_authenticated/private-cloud.tsx).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
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
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { KPI_INSET_GRID_CLASS, KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { TransactionListCard } from "@/components/summaries/transaction-list-card";
import { ProviderBadge } from "@/components/cloud/cloud-type-badge";
import {
  EXAMPLE_BATCHES,
  EXAMPLE_TRANSACTIONS,
  formatBatchStatus,
  lineCost,
  privateCloudView,
  type BatchRow,
  type TxRow,
} from "@/components/summaries/private-cloud-data";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

const thousands = (value: number) => `${Math.round(value / 1000)}k`;

export function PrivateCloudSummary({
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
    queryKey: ["private-cloud-summary-v1"],
    queryFn: async () => {
      const batches = isExampleCaptureMode
        ? EXAMPLE_BATCHES
        : (((
            await supabase
              .from("lab_batches")
              .select(
                "id,batch_code,name,status,revenue_total,estimated_cost_total,actual_cost_total,flags,needs_recompute,updated_at",
              )
              .eq("lab_type", "private_cloud")
              .order("batch_code")
          ).data ?? []) as BatchRow[]);
      // SCRUM-129/131 (spec §129.4a, AC6): count ALL private rows (MakeMyLabs, Oracle,
      // SAP), not only batch-linked ones, so Bulk Upload rows are included.
      const tx: TxRow[] = isExampleCaptureMode
        ? EXAMPLE_TRANSACTIONS
        : await readAllRows(
            () =>
              supabase
                .from("transactions")
                .select(
                  "id,lab_batch_id,potential_id,lab_name,cloud_provider,total_users,customer_name,month,year,selling_cost,input_cost,input_cost_auto,input_cost_actual_alloc,is_deleted,repository_type",
                )
                .eq("repository_type", "private_cloud")
                .eq("is_deleted", false)
                .order("id"),
            "Private cloud summary transactions",
          );
      return { batches, tx };
    },
  });

  const allTx = data?.tx;
  const batchesRaw = data?.batches;
  // Periods from the one rules table (lib/kpi-period.ts); transaction rows are filtered to the
  // period the label states. Batch tiles are batch-level (no month on a batch): their rule is
  // all-time today; if Q6 gives them a window, filter the batches query by it.
  const page = useMemo(
    () => (allTx && batchesRaw ? privateCloudView(allTx, batchesRaw, tab) : null),
    [allTx, batchesRaw, tab],
  );

  if (isLoading) return <LoadingState thing="private cloud summary" />;
  if (isError || !data || !page) {
    return (
      <ErrorState thing="private cloud summary" error={error} onRetry={() => void refetch()} />
    );
  }
  const {
    view,
    cardSplit,
    tabCounts,
    totalsPeriod,
    completenessPeriod,
    batchesPeriod,
    batchStatePeriod,
  } = page;
  const hasReconciliation = view.reconciliation.length > 0;
  const monthSeries = view.byMonth.filter((row) => row.revenue > 0 || row.cost > 0);
  const statusTotal = view.statusSplit.reduce((sum, row) => sum + row.value, 0);
  const inc = view.completeness.incomplete;
  const noteCount = noteCountForTab(tab, inc.count);
  const totalsLabel = formatKpiPeriod(totalsPeriod);
  const batchesLabel = formatKpiPeriod(batchesPeriod);

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
          label="Private cloud transactions"
          value={fmtNumber(view.tx.length)}
          subline={`${fmtNumber(view.inBatches)} in batches`}
          {...incompleteNoteProps(noteCount, null)}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Revenue"
          value={fmtCurrency(view.txRevenue)}
          subline="All private cloud transactions"
          {...incompleteNoteProps(noteCount, view.incompleteRevenue)}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Input cost"
          value={fmtCurrency(view.txCost)}
          subline={`Profit ${fmtCurrency(view.txRevenue - view.txCost)}`}
          {...incompleteNoteProps(noteCount, view.incompleteCost)}
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Users"
          value={fmtNumber(view.txUsers)}
          subline="Across private cloud transactions"
          note={
            inc.count > 0
              ? `${fmtNumber(inc.count)} incomplete · ${fmtNumber(view.incompleteUsers)} users`
              : null
          }
          noteTitle={
            inc.count > 0
              ? `Includes ${fmtNumber(inc.count)} incomplete ${inc.count === 1 ? "row" : "rows"} · ${fmtNumber(view.incompleteUsers)} users`
              : null
          }
        />
        <SummaryKpi
          period={totalsPeriod}
          label="Top customer"
          value={view.topCustomers[0]?.name ?? "—"}
          subline={view.topCustomers[0] ? fmtCurrency(view.topCustomers[0].value) : "No data"}
        />
      </KpiGrid>

      <Card className="min-w-0" data-testid="lab-batches-card">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-sm">Lab batches</CardTitle>
            <CardDescription>
              Private cloud batches (lab_batches). Batch totals come from the batch, not from the
              transaction totals above, and are not filtered by the tabs.
            </CardDescription>
          </div>
          <Link to="/mml-lab/batches" className="shrink-0 text-xs text-primary hover:underline">
            View all →
          </Link>
        </CardHeader>
        <CardContent className={KPI_INSET_GRID_CLASS}>
          <SummaryKpi
            period={batchesPeriod}
            variant="inset"
            label="Batches"
            value={fmtNumber(view.batches.length)}
            subline={`Status entries ${fmtNumber(statusTotal)}`}
          />
          <SummaryKpi
            period={batchesPeriod}
            variant="inset"
            label="Batch revenue"
            value={fmtCurrency(view.revenue)}
            subline={`Batch profit ${fmtCurrency(view.profit)}`}
          />
          <SummaryKpi
            period={batchesPeriod}
            variant="inset"
            label="Batch actual cost"
            value={fmtCurrency(view.actualCost)}
            subline={`Estimated ${fmtCurrency(view.estimatedCost)}`}
          />
          <SummaryKpi
            period={batchesPeriod}
            variant="inset"
            label="Batch margin"
            value={`${view.marginPct.toFixed(1)}%`}
            subline={`Cost locks ${fmtNumber(view.locked)}`}
          />
          <SummaryKpi
            period={batchStatePeriod}
            variant="inset"
            label="Recompute pending"
            value={fmtNumber(view.recomputePending)}
            subline="Batches needing refresh"
          />
          <SummaryKpi
            period={batchesPeriod}
            variant="inset"
            label="Reconciliation"
            value={hasReconciliation ? "Tracked" : "No data"}
            subline={`${fmtNumber(view.reconciliation.filter((batch) => batch.reconciled).length)} reconciled`}
          />
        </CardContent>
      </Card>

      <ChartCard title="Private cloud by provider" description={totalsLabel}>
        {view.providerSplit.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {view.providerSplit.map((p) => (
              <li
                key={p.name}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <ProviderBadge
                  value={p.name === "No provider" ? null : p.name}
                  className="shrink-0"
                />
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {fmtNumber(p.rows)} rows · {fmtCurrency(p.revenue)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <NoDataYet compact />
        )}
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Revenue and margin by month"
          description={formatKpiPeriod({ kind: "year", year: view.year, basis: "calendar" })}
        >
          {monthSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <ComposedChart data={monthSeries}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="monthLabel" tick={CHART_AXIS_TICK} />
                <YAxis yAxisId="money" tick={CHART_AXIS_TICK} tickFormatter={thousands} />
                <YAxis
                  yAxisId="margin"
                  orientation="right"
                  tick={CHART_AXIS_TICK}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(value: number, name) =>
                    String(name).includes("%") ? `${value}%` : fmtCurrency(value)
                  }
                />
                <Bar
                  yAxisId="money"
                  dataKey="revenue"
                  name="Revenue"
                  fill={CHART_SERIES[0]}
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="money"
                  dataKey="cost"
                  name="Input cost"
                  stroke={CHART_SERIES[1]}
                  strokeWidth={2}
                />
                <Line
                  yAxisId="margin"
                  dataKey="marginPct"
                  name="Margin %"
                  stroke={CHART_SERIES[2]}
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>

        <ChartCard title="Batch status" description={batchesLabel}>
          {view.statusSplit.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={view.statusSplit}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={90}
                  innerRadius={58}
                  {...PIE_SLICE_STROKE}
                >
                  {view.statusSplit.map((slice, idx) => (
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
                  {fmtNumber(statusTotal)}
                </text>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* SCRUM-128 C6: the title said "· {year}", but reconciliation covers every batch with all
            its lines (no year filter); the period is now the card description. */}
        <ChartCard title="Reconciled costs (actual vs estimate)" description={batchesLabel}>
          {hasReconciliation ? (
            <ul className="space-y-2">
              {view.reconciliation.map((batch) => (
                <li key={batch.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div
                      className="min-w-0 truncate text-sm font-medium"
                      title={`${batch.batch_code}${batch.name ? ` · ${batch.name}` : ""}`}
                    >
                      {batch.batch_code} {batch.name ? `· ${batch.name}` : ""}
                    </div>
                    {batch.reconciled ? (
                      <Badge variant="success" className="shrink-0 gap-1">
                        <CheckCircle2 className="size-3.5" aria-hidden /> Reconciled
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="shrink-0">
                        Review needed
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                    Σ line actual costs = {fmtCurrency(batch.lineActual)} · batch actual cost ={" "}
                    {fmtCurrency(batch.batchActual)} · estimate = {fmtCurrency(batch.batchEstimate)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <NoDataYet compact />
          )}
        </ChartCard>
        <ChartCard title="Top customers by revenue" description={totalsLabel}>
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

      <TransactionListCard title="Private cloud transactions" rows={view.tx} costOf={lineCost} />

      <ChartCard
        title="Recent batches"
        description="First 8 by batch code"
        action={
          <Link to="/mml-lab/batches" className="text-xs text-primary hover:underline">
            View all →
          </Link>
        }
      >
        {view.batches.length > 0 ? (
          <ul className="space-y-2">
            {view.batches.slice(0, 8).map((batch) => (
              <li key={batch.id}>
                <Link
                  to="/mml-lab/batches"
                  className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium">{batch.batch_code}</div>
                    <Badge variant="outline" className="shrink-0">
                      {formatBatchStatus(batch.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                    Revenue {fmtCurrency(batch.revenue_total)} · Actual cost{" "}
                    {fmtCurrency(batch.actual_cost_total)} · Updated{" "}
                    {new Date(batch.updated_at).toLocaleString()}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <NoDataYet compact />
        )}
      </ChartCard>
    </div>
  );
}
