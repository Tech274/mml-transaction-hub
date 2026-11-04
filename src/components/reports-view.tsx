import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readAllRows } from "@/lib/read-all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fmtCurrency, fmtNumber, YEARS } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import {
  computeTotals,
  computeForecast,
  forecastByDimension,
  costBasisCounts,
  reportLineCost,
  type ReportRow,
} from "@/lib/reports-metrics";
import {
  REPORTS_ALL,
  filterReportRows,
  reportsByMonthProvider,
  reportsCustomers,
  reportsFilterPeriod,
  reportsMarginByLob,
  reportsMarginByProvider,
  reportsProviderTotals,
  reportsTopLabs,
} from "@/lib/reports-view-data";
import { COST_BASIS_LABEL } from "@/lib/cost-calculator";
import { useAuth } from "@/lib/auth-context";
import { exportToExcel } from "@/lib/export-xlsx";
import { FilterBar, FilterSelect, FilterSummary } from "@/components/filter-bar";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { ChartCard } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { LoadingState } from "@/components/page-states";
import { TableStateRow } from "@/components/data-table-parts";
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_TOOLTIP,
  chartSeriesColor,
} from "@/lib/chart-standard";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";

type Row = ReportRow;

const ALL = REPORTS_ALL;

export function ReportsView() {
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [provider, setProvider] = useState<string>(ALL);
  const [lob, setLob] = useState<string>(ALL);

  const { data, isLoading, error, isError, refetch, isFetching } = useQuery({
    queryKey: ["reports", "transactions"],
    queryFn: async () => {
      // SCRUM-70: all rows, not just the first 1,000 (PostgREST default limit).
      const data = await readAllRows(
        () =>
          supabase
            .from("transactions")
            .select(
              "month,year,repository_type,cloud_provider,line_of_business,customer_name,lab_name,total_users,input_cost,input_cost_auto,input_cost_actual_alloc,selling_cost,start_date,end_date,is_deleted,potential_id,id",
            )
            .eq("is_deleted", false)
            .order("id"),
        "Reports transactions",
      );
      return data as Row[];
    },
  });
  const errMsg = error instanceof Error ? error.message : error ? String(error) : "";

  const rows = data ?? [];
  const providers = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cloud_provider).filter(Boolean))).sort(),
    [rows],
  );
  const lobs = useMemo(
    () => Array.from(new Set(rows.map((r) => r.line_of_business).filter(Boolean))).sort(),
    [rows],
  );

  // SCRUM-128 C7: the aggregations moved verbatim to lib/reports-view-data.ts (pinned by
  // lib/__tests__/reports-view-data.test.ts).
  const filtered = useMemo(
    () => filterReportRows(rows, year, provider, lob),
    [rows, year, provider, lob],
  );

  const [drill, setDrill] = useState<{ title: string; predicate: (r: Row) => boolean } | null>(
    null,
  );
  const openDrill = (title: string, predicate: (r: Row) => boolean) =>
    setDrill({ title, predicate });
  const drillRows = useMemo(
    () => (drill ? filtered.filter(drill.predicate) : []),
    [drill, filtered],
  );

  const byMonthProvider = useMemo(() => reportsByMonthProvider(filtered), [filtered]);
  const topLabs = useMemo(() => reportsTopLabs(filtered), [filtered]);
  const providerTotals = useMemo(() => reportsProviderTotals(filtered), [filtered]);
  const customers = useMemo(() => reportsCustomers(filtered), [filtered]);
  const marginByLob = useMemo(() => reportsMarginByLob(filtered), [filtered]);
  const marginByProvider = useMemo(() => reportsMarginByProvider(providerTotals), [providerTotals]);
  const kpiPeriod = reportsFilterPeriod(year);

  const totals = useMemo(() => computeTotals(filtered), [filtered]);
  const basis = useMemo(() => costBasisCounts(filtered), [filtered]);

  // Forecasting
  const forecast = useMemo(() => computeForecast(filtered, new Date(), 12), [filtered]);
  const forecastByCustomer = useMemo(
    () => forecastByDimension(filtered, "customer_name"),
    [filtered],
  );
  const forecastByLab = useMemo(() => forecastByDimension(filtered, "lab_name"), [filtered]);
  const forecastByProvider = useMemo(
    () => forecastByDimension(filtered, "cloud_provider"),
    [filtered],
  );

  const filterMeta = {
    Year: year === ALL ? "All" : year,
    Provider: provider === ALL ? "All" : provider,
    LOB: lob === ALL ? "All" : lob,
  };
  const totalsSheet = [
    { metric: "Revenue", value: totals.revenue },
    { metric: "Input cost", value: totals.cost },
    { metric: "Profit", value: totals.profit },
    { metric: "Margin %", value: Number(totals.margin.toFixed(2)) },
    { metric: "Transactions", value: totals.count },
  ];

  const exportTab = (tab: "cost" | "customer" | "margin" | "forecast") => {
    let rowsOut: Record<string, unknown>[] = [];
    let name = "report";
    if (tab === "cost") {
      name = "cloud-cost";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...providerTotals.map((p) => ({
          section: "Provider totals",
          provider: p.provider,
          revenue: p.spend,
          cost: p.cost,
          profit: p.profit,
        })),
        ...topLabs.map((l) => ({
          section: "Top labs",
          lab: l.lab,
          provider: l.provider,
          users: l.users,
          spend: l.spend,
        })),
      ];
    } else if (tab === "customer") {
      name = "customer-profitability";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...customers.map((c) => ({
          section: "Customer",
          customer: c.customer,
          txns: c.tx,
          users: c.users,
          revenue: c.revenue,
          cost: c.cost,
          profit: c.profit,
          margin: Number(c.margin.toFixed(2)),
        })),
      ];
    } else if (tab === "margin") {
      name = "margin-analysis";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...marginByLob.map((m) => ({
          section: "By LOB",
          key: m.key,
          revenue: m.revenue,
          cost: m.cost,
          profit: m.profit,
          margin: Number(m.margin.toFixed(2)),
        })),
        ...marginByProvider.map((m) => ({
          section: "By provider",
          key: m.key,
          revenue: m.revenue,
          cost: m.cost,
          profit: m.profit,
          margin: Number(m.margin.toFixed(2)),
        })),
      ];
    } else {
      name = "revenue-forecast";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...forecast.map((f) => ({
          section: "Monthly",
          month: f.key,
          revenue: f.revenue,
          cost: f.cost,
          profit: f.profit,
          margin: Number(f.margin.toFixed(2)),
        })),
        ...forecastByCustomer.map((c) => ({
          section: "By customer",
          key: c.key,
          revenue: c.revenue,
          cost: c.cost,
          profit: c.profit,
          margin: Number(c.margin.toFixed(2)),
        })),
        ...forecastByLab.map((c) => ({
          section: "By lab",
          key: c.key,
          revenue: c.revenue,
          cost: c.cost,
          profit: c.profit,
          margin: Number(c.margin.toFixed(2)),
        })),
        ...forecastByProvider.map((c) => ({
          section: "By provider",
          key: c.key,
          revenue: c.revenue,
          cost: c.cost,
          profit: c.profit,
          margin: Number(c.margin.toFixed(2)),
        })),
      ];
    }
    exportToExcel(name, rowsOut, { generatedBy: "Reports", filters: filterMeta });
  };

  return (
    <div className="space-y-4">
      <FilterBar
        summary={
          <FilterSummary
            items={[
              {
                label: "Transactions in scope",
                value: isLoading ? "…" : fmtNumber(totals.count),
              },
            ]}
          />
        }
      >
        <FilterSelect
          label="Year"
          value={year}
          onValueChange={setYear}
          allValue={ALL}
          allLabel="All years"
          options={YEARS.map((y) => ({ value: String(y), label: String(y) }))}
        />
        <FilterSelect
          label="Cloud provider"
          width="md"
          value={provider}
          onValueChange={setProvider}
          allValue={ALL}
          allLabel="All providers"
          options={providers.map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          label="Line of business"
          width="md"
          value={lob}
          onValueChange={setLob}
          allValue={ALL}
          allLabel="All LOB"
          options={lobs.map((l) => ({ value: l, label: l }))}
        />
      </FilterBar>

      {isError && (
        <Alert variant="destructive" data-testid="reports-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load reports data</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span className="truncate">{errMsg || "Unknown error"}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Totals strip */}
      <KpiGrid>
        <SummaryKpi label="Revenue" value={fmtCurrency(totals.revenue)} period={kpiPeriod} />
        <SummaryKpi label="Input cost" value={fmtCurrency(totals.cost)} period={kpiPeriod} />
        <SummaryKpi label="Profit" value={fmtCurrency(totals.profit)} period={kpiPeriod} />
        <SummaryKpi label="Margin" value={`${totals.margin.toFixed(1)}%`} period={kpiPeriod} />
      </KpiGrid>
      <p className="text-xs text-muted-foreground" data-testid="reports-cost-basis">
        Input cost uses actual, then entered, then auto-filled. {COST_BASIS_LABEL.actual}{" "}
        {basis.actual} · {COST_BASIS_LABEL.entered} {basis.entered} · {COST_BASIS_LABEL.auto_avg}{" "}
        {basis.auto_avg}.
      </p>
      <HybridSolutionsCard />

      <Tabs defaultValue="cost" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="cost">Cloud cost</TabsTrigger>
            <TabsTrigger value="customer">Customer profitability</TabsTrigger>
            <TabsTrigger value="margin">Margin analysis</TabsTrigger>
            <TabsTrigger value="forecast">Revenue forecast</TabsTrigger>
          </TabsList>
        </div>

        {/* Cloud cost */}
        <TabsContent value="cost" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("cost")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <ChartCard
            title="Spend by provider — monthly"
            description={year === ALL ? "All years, by calendar month" : `Year ${year}`}
          >
            {isLoading ? (
              <LoadingState thing="spend" inCard />
            ) : byMonthProvider.providers.length === 0 ? (
              <NoDataYet />
            ) : (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={byMonthProvider.data}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="month" tick={CHART_AXIS_TICK} />
                  <YAxis
                    tick={CHART_AXIS_TICK}
                    tickFormatter={(v) => fmtCurrency(v as number)}
                    width={90}
                  />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => fmtCurrency(v)} />
                  <Legend />
                  {byMonthProvider.providers.map((p, i) => (
                    <Bar key={p} dataKey={p} stackId="a" fill={chartSeriesColor(i)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Provider totals</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                loading={isLoading}
                headers={["Provider", "Revenue", "Cost", "Profit"]}
                rows={providerTotals.map((p) => [
                  p.provider,
                  fmtCurrency(p.spend),
                  fmtCurrency(p.cost),
                  fmtCurrency(p.profit),
                ])}
                onRowClick={(i) => {
                  const p = providerTotals[i];
                  openDrill(`Transactions — ${p.provider}`, (r) => r.cloud_provider === p.provider);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top labs by spend</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                loading={isLoading}
                headers={["Lab", "Provider", "Users", "Spend"]}
                rows={topLabs.map((l) => [
                  l.lab,
                  l.provider,
                  fmtNumber(l.users),
                  fmtCurrency(l.spend),
                ])}
                empty="No labs in current filter."
                onRowClick={(i) => {
                  const l = topLabs[i];
                  openDrill(
                    `Transactions — ${l.lab} · ${l.provider}`,
                    (r) => r.lab_name === l.lab && r.cloud_provider === l.provider,
                  );
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Customer profitability */}
        <TabsContent value="customer" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("customer")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <ChartCard title="Top 10 customers by profit">
            {isLoading ? (
              <LoadingState thing="customers" inCard />
            ) : customers.length === 0 ? (
              <NoDataYet />
            ) : (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={customers.slice(0, 10)} layout="vertical">
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis
                    type="number"
                    tick={CHART_AXIS_TICK}
                    tickFormatter={(v) => fmtCurrency(v as number)}
                  />
                  <YAxis type="category" dataKey="customer" width={120} tick={CHART_AXIS_TICK} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => fmtCurrency(v)} />
                  <Legend />
                  <Bar dataKey="revenue" fill={chartSeriesColor(0)} name="Revenue" />
                  <Bar dataKey="profit" fill={chartSeriesColor(1)} name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Customer profitability</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                loading={isLoading}
                headers={["Customer", "Txns", "Users", "Revenue", "Cost", "Profit", "Margin"]}
                rows={customers.map((c) => [
                  c.customer,
                  fmtNumber(c.tx),
                  fmtNumber(c.users),
                  fmtCurrency(c.revenue),
                  fmtCurrency(c.cost),
                  fmtCurrency(c.profit),
                  `${c.margin.toFixed(1)}%`,
                ])}
                empty="No customers in current filter."
                onRowClick={(i) => {
                  const c = customers[i];
                  openDrill(`Transactions — ${c.customer}`, (r) => r.customer_name === c.customer);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Margin analysis */}
        <TabsContent value="margin" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("margin")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ChartCard title="Margin % by line of business">
              {isLoading ? (
                <LoadingState thing="margins" inCard />
              ) : marginByLob.length === 0 ? (
                <NoDataYet />
              ) : (
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <BarChart data={marginByLob}>
                    <CartesianGrid {...CHART_GRID} />
                    <XAxis dataKey="key" tick={CHART_AXIS_TICK} />
                    <YAxis tick={CHART_AXIS_TICK} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      {...CHART_TOOLTIP}
                      formatter={(v: number, n) =>
                        n === "margin" ? `${v.toFixed(1)}%` : fmtCurrency(v)
                      }
                    />
                    <Bar dataKey="margin" fill={chartSeriesColor(0)} name="Margin %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Margin % by cloud provider">
              {isLoading ? (
                <LoadingState thing="margins" inCard />
              ) : marginByProvider.length === 0 ? (
                <NoDataYet />
              ) : (
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <BarChart data={marginByProvider}>
                    <CartesianGrid {...CHART_GRID} />
                    <XAxis dataKey="key" tick={CHART_AXIS_TICK} />
                    <YAxis tick={CHART_AXIS_TICK} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      {...CHART_TOOLTIP}
                      formatter={(v: number, n) =>
                        n === "margin" ? `${v.toFixed(1)}%` : fmtCurrency(v)
                      }
                    />
                    <Bar dataKey="margin" fill={chartSeriesColor(0)} name="Margin %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Margin breakdown by line of business</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                loading={isLoading}
                headers={["Line of business", "Revenue", "Cost", "Profit", "Margin"]}
                rows={marginByLob.map((m) => [
                  m.key,
                  fmtCurrency(m.revenue),
                  fmtCurrency(m.cost),
                  fmtCurrency(m.profit),
                  `${m.margin.toFixed(1)}%`,
                ])}
                empty="No data for current filter."
                onRowClick={(i) => {
                  const m = marginByLob[i];
                  openDrill(`Transactions — LOB ${m.key}`, (r) => r.line_of_business === m.key);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Margin breakdown by cloud provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                loading={isLoading}
                headers={["Provider", "Revenue", "Cost", "Profit", "Margin"]}
                rows={marginByProvider.map((m) => [
                  m.key,
                  fmtCurrency(m.revenue),
                  fmtCurrency(m.cost),
                  fmtCurrency(m.profit),
                  `${m.margin.toFixed(1)}%`,
                ])}
                empty="No data for current filter."
                onRowClick={(i) => {
                  const m = marginByProvider[i];
                  openDrill(`Transactions — ${m.key}`, (r) => r.cloud_provider === m.key);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue forecast */}
        <TabsContent value="forecast" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("forecast")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <ChartCard title="Projected revenue vs cost — next 12 months">
            {isLoading ? (
              <div data-testid="forecast-loading">
                <LoadingState thing="forecast" inCard />
              </div>
            ) : isError ? (
              <div
                data-testid="forecast-error"
                className="flex flex-col items-center gap-2 py-8 text-sm"
              >
                <div className="text-destructive">Could not load forecast data.</div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : forecast.every((f) => f.revenue === 0 && f.cost === 0) ? (
              <NoDataYet message="No projected revenue in the next 12 months for the current filters." />
            ) : (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <LineChart data={forecast}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="key" tick={CHART_AXIS_TICK} />
                  <YAxis
                    tick={CHART_AXIS_TICK}
                    tickFormatter={(v) => fmtCurrency(v as number)}
                    width={90}
                  />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => fmtCurrency(v)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke={chartSeriesColor(0)}
                    name="Revenue"
                  />
                  <Line type="monotone" dataKey="cost" stroke={chartSeriesColor(1)} name="Cost" />
                  <Line
                    type="monotone"
                    dataKey="profit"
                    stroke={chartSeriesColor(2)}
                    name="Profit"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Monthly projection</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
                loading={isLoading}
                headers={["Month", "Revenue", "Cost", "Profit", "Margin"]}
                rows={forecast.map((f) => [
                  f.key,
                  fmtCurrency(f.revenue),
                  fmtCurrency(f.cost),
                  fmtCurrency(f.profit),
                  `${f.margin.toFixed(1)}%`,
                ])}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <ForecastGroupCard loading={isLoading} title="By customer" data={forecastByCustomer} />
            <ForecastGroupCard loading={isLoading} title="By lab" data={forecastByLab} />
            <ForecastGroupCard loading={isLoading} title="By provider" data={forecastByProvider} />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{drill?.title}</DialogTitle>
          </DialogHeader>
          {drill &&
            (isError ? (
              <div data-testid="drill-error" className="py-6 text-sm">
                <div className="mb-2 text-destructive">Could not load underlying transactions.</div>
                <div className="text-muted-foreground mb-3 truncate">{errMsg}</div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : isLoading ? (
              <div data-testid="drill-loading">
                <LoadingState thing="transactions" inCard />
              </div>
            ) : (
              <DrillTable rows={drillRows} />
            ))}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ForecastGroupCard({
  title,
  data,
  loading,
}: {
  title: string;
  loading: boolean;
  data: { key: string; revenue: number; cost: number; profit: number; margin: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ReportTable
          loading={loading}
          headers={["Key", "Revenue", "Profit", "Margin"]}
          rows={data
            .slice(0, 10)
            .map((d) => [
              d.key,
              fmtCurrency(d.revenue),
              fmtCurrency(d.profit),
              `${d.margin.toFixed(1)}%`,
            ])}
          empty="No projected revenue."
        />
      </CardContent>
    </Card>
  );
}

function DrillTable({ rows }: { rows: Row[] }) {
  const byRepo = useMemo(() => {
    const map = new Map<string, { key: string; revenue: number; cost: number; count: number }>();
    for (const r of rows) {
      const cur = map.get(r.repository_type) ?? {
        key: r.repository_type,
        revenue: 0,
        cost: 0,
        count: 0,
      };
      cur.revenue = addNullable(cur.revenue, r.selling_cost);
      cur.cost = addNullable(cur.cost, reportLineCost(r));
      cur.count += 1;
      map.set(r.repository_type, cur);
    }
    return Array.from(map.values()).map((r) => ({ ...r, profit: r.revenue - r.cost }));
  }, [rows]);

  const txRows = useMemo(
    () =>
      rows.map((r) => ({
        customer_name: r.customer_name,
        lab_name: r.lab_name,
        cloud_provider: r.cloud_provider,
        line_of_business: r.line_of_business,
        total_users: r.total_users,
        selling_cost: r.selling_cost,
        input_cost: r.input_cost,
      })),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <div data-testid="drill-empty" className="py-10 text-center text-sm text-muted-foreground">
        No matching transactions for the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto" data-testid="drill-content">
      <div data-testid="drill-repo">
        <div className="text-sm font-medium mb-2">Repository breakdown</div>
        <SortablePaginatedTable
          data={byRepo}
          pageSize={10}
          columns={[
            { key: "key", label: "Repository" },
            { key: "count", label: "Txns", numeric: true, render: (r) => fmtNumber(r.count) },
            {
              key: "revenue",
              label: "Revenue",
              numeric: true,
              render: (r) => fmtCurrency(r.revenue),
            },
            { key: "cost", label: "Cost", numeric: true, render: (r) => fmtCurrency(r.cost) },
            { key: "profit", label: "Profit", numeric: true, render: (r) => fmtCurrency(r.profit) },
          ]}
        />
      </div>
      <div data-testid="drill-transactions">
        <div className="text-sm font-medium mb-2">Underlying transactions ({rows.length})</div>
        <SortablePaginatedTable
          data={txRows}
          pageSize={25}
          columns={[
            { key: "customer_name", label: "Customer" },
            { key: "lab_name", label: "Lab" },
            { key: "cloud_provider", label: "Provider" },
            { key: "line_of_business", label: "LOB" },
            {
              key: "total_users",
              label: "Users",
              numeric: true,
              render: (r) => fmtNumber(r.total_users),
            },
            {
              key: "selling_cost",
              label: "Revenue",
              numeric: true,
              render: (r) => fmtCurrency(r.selling_cost),
            },
            {
              key: "input_cost",
              label: "Cost",
              numeric: true,
              render: (r) => fmtCurrency(r.input_cost),
            },
          ]}
        />
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";
type Col<T> = {
  key: keyof T & string;
  label: string;
  numeric?: boolean;
  render?: (row: T) => React.ReactNode;
};

function SortablePaginatedTable<T extends Record<string, unknown>>({
  data,
  columns,
  pageSize = 25,
}: {
  data: T[];
  columns: Col<T>[];
  pageSize?: number;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(pageSize);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    const numeric = col?.numeric ?? false;
    const arr = [...data];
    arr.sort((a, b) => {
      const av = a[sortKey as keyof T];
      const bv = b[sortKey as keyof T];
      let cmp: number;
      if (numeric) cmp = Number(av ?? 0) - Number(bv ?? 0);
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [data, sortKey, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / size));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * size;
  const paged = sorted.slice(start, start + size);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground py-6 text-center">No data.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort(c.key)}
                  data-testid={`sort-${c.key}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sortKey === c.key &&
                      (sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((r, i) => (
              <TableRow key={i}>
                {columns.map((c, j) => (
                  <TableCell
                    key={c.key}
                    className={j === 0 ? "font-medium" : c.numeric ? "tabular-nums" : undefined}
                  >
                    {c.render ? c.render(r) : String(r[c.key as keyof T] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div data-testid="pagination-info">
          Showing {start + 1}–{Math.min(start + size, sorted.length)} of {sorted.length}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            Rows
            <select
              data-testid="page-size"
              className="h-7 rounded border border-input bg-background px-1 text-xs"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="outline"
            data-testid="page-prev"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            data-testid="page-next"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function HybridSolutionsCard() {
  const { isAdmin } = useAuth();
  const { data } = useQuery({
    queryKey: ["hybrid-solutions"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data: tags, error } = await supabase
        .from("transaction_tags")
        .select("transaction_id")
        .eq("tag", "hybrid");
      if (error) throw error;
      const ids = (tags ?? []).map((t) => t.transaction_id);
      if (ids.length === 0)
        return {
          count: 0,
          byYear: [] as { year: string; count: number }[],
          suggestions: [] as string[],
        };
      const { data: lines } = await supabase
        .from("transactions")
        .select("id, potential_id, start_date, is_deleted")
        .in("id", ids)
        .eq("is_deleted", false);
      const solutions = new Set((lines ?? []).map((l) => l.potential_id || l.id));
      const byYearMap = new Map<string, Set<string>>();
      for (const l of lines ?? []) {
        const year = l.start_date ? String(l.start_date).slice(0, 4) : "—";
        const key = l.potential_id || l.id;
        const set = byYearMap.get(year) ?? new Set<string>();
        set.add(key);
        byYearMap.set(year, set);
      }
      const { data: both } = await supabase
        .from("transactions")
        .select("potential_id, lab_type")
        .eq("is_deleted", false)
        .not("potential_id", "is", null);
      const grouped = new Map<string, Set<string>>();
      for (const row of both ?? []) {
        if (!row.potential_id) continue;
        const set = grouped.get(row.potential_id) ?? new Set<string>();
        set.add(row.lab_type);
        grouped.set(row.potential_id, set);
      }
      const tagged = new Set((lines ?? []).map((l) => l.potential_id).filter(Boolean) as string[]);
      const suggestions = [...grouped.entries()]
        .filter(
          ([id, types]) =>
            types.has("public_cloud") && types.has("private_cloud") && !tagged.has(id),
        )
        .map(([id]) => id);
      return {
        count: solutions.size,
        byYear: [...byYearMap.entries()].map(([year, set]) => ({ year, count: set.size })),
        suggestions,
      };
    },
  });
  if (!isAdmin || !data) return null;
  return (
    <Card data-testid="hybrid-solutions">
      <CardHeader>
        <CardTitle className="text-sm">Hybrid solutions shipped</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <div className="text-xl font-semibold tabular-nums" data-testid="hybrid-count">
          {data.count}
        </div>
        <p className="text-xs text-muted-foreground">
          Distinct potential IDs. The tag is not included in revenue or margin.
        </p>
        {data.byYear.map((y) => (
          <div key={y.year}>
            {y.year}: {y.count}
          </div>
        ))}
        {data.suggestions.length > 0 && (
          <p className="text-xs">
            Suggestions (public and private, not tagged): {data.suggestions.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportTable({
  headers,
  rows,
  empty,
  onRowClick,
  loading = false,
}: {
  /** While the transactions load, show "Loading…" instead of the empty text. */
  loading?: boolean;
  headers: string[];
  rows: (string | number)[][];
  empty?: string;
  onRowClick?: (index: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableStateRow colSpan={headers.length}>Loading…</TableStateRow>
          ) : (
            rows.length === 0 && (
              <TableStateRow colSpan={headers.length}>{empty ?? "No data."}</TableStateRow>
            )
          )}
          {!loading &&
            rows.map((r, i) => (
              <TableRow
                key={i}
                className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
                onClick={onRowClick ? () => onRowClick(i) : undefined}
              >
                {r.map((c, j) => (
                  <TableCell key={j} className={j === 0 ? "font-medium" : "tabular-nums"}>
                    {c}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
