import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readAllRows } from "@/lib/read-all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Download, ArrowUp, ArrowDown, AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fmtCurrency, fmtNumber, MONTH_NAMES, YEARS } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import {
  computeTotals,
  groupByKey,
  computeForecast,
  forecastByDimension,
  costBasisCounts,
  reportLineCost,
  type ReportRow,
} from "@/lib/reports-metrics";
import { COST_BASIS_LABEL } from "@/lib/cost-calculator";
import { useAuth } from "@/lib/auth-context";
import { exportToExcel } from "@/lib/export-xlsx";
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

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--muted-foreground))",
];
const ALL = "__all__";

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

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (year === ALL || r.year === Number(year)) &&
          (provider === ALL || r.cloud_provider === provider) &&
          (lob === ALL || r.line_of_business === lob),
      ),
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

  // Cloud cost by provider × month
  const byMonthProvider = useMemo(() => {
    const providerSet = Array.from(
      new Set(filtered.map((r) => r.cloud_provider).filter(Boolean)),
    ).sort();
    return {
      providers: providerSet,
      data: MONTH_NAMES.map((label, i) => {
        const rec: Record<string, string | number> = { month: label };
        for (const p of providerSet) {
          rec[p] = filtered
            .filter((r) => r.month === i + 1 && r.cloud_provider === p)
            .reduce((s, r) => addNullable(s, r.selling_cost), 0);
        }
        return rec;
      }),
    };
  }, [filtered]);

  const topLabs = useMemo(() => {
    const map = new Map<string, { lab: string; provider: string; spend: number; users: number }>();
    for (const r of filtered) {
      const key = `${r.lab_name}||${r.cloud_provider}`;
      const cur = map.get(key) ?? {
        lab: r.lab_name,
        provider: r.cloud_provider,
        spend: 0,
        users: 0,
      };
      cur.spend = addNullable(cur.spend, r.selling_cost);
      cur.users = addNullable(cur.users, r.total_users);
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);
  }, [filtered]);

  const providerTotals = useMemo(() => {
    const map = new Map<
      string,
      { provider: string; spend: number; cost: number; profit: number }
    >();
    for (const r of filtered) {
      const cur = map.get(r.cloud_provider) ?? {
        provider: r.cloud_provider,
        spend: 0,
        cost: 0,
        profit: 0,
      };
      cur.spend = addNullable(cur.spend, r.selling_cost);
      cur.cost = addNullable(cur.cost, reportLineCost(r));
      cur.profit = cur.spend - cur.cost;
      map.set(r.cloud_provider, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [filtered]);

  // Customer profitability
  const customers = useMemo(() => {
    const map = new Map<
      string,
      {
        customer: string;
        revenue: number;
        cost: number;
        profit: number;
        margin: number;
        tx: number;
        users: number;
      }
    >();
    for (const r of filtered) {
      const cur = map.get(r.customer_name) ?? {
        customer: r.customer_name,
        revenue: 0,
        cost: 0,
        profit: 0,
        margin: 0,
        tx: 0,
        users: 0,
      };
      cur.revenue = addNullable(cur.revenue, r.selling_cost);
      cur.cost = addNullable(cur.cost, reportLineCost(r));
      cur.tx += 1;
      cur.users = addNullable(cur.users, r.total_users);
      cur.profit = cur.revenue - cur.cost;
      cur.margin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;
      map.set(r.customer_name, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.profit - a.profit);
  }, [filtered]);

  // Margin analysis by LOB and provider
  const marginByLob = useMemo(() => {
    const map = new Map<string, { key: string; revenue: number; cost: number }>();
    for (const r of filtered) {
      const cur = map.get(r.line_of_business) ?? { key: r.line_of_business, revenue: 0, cost: 0 };
      cur.revenue = addNullable(cur.revenue, r.selling_cost);
      cur.cost = addNullable(cur.cost, reportLineCost(r));
      map.set(r.line_of_business, cur);
    }
    return Array.from(map.values())
      .map((x) => ({
        key: x.key,
        revenue: x.revenue,
        cost: x.cost,
        profit: x.revenue - x.cost,
        margin: x.revenue > 0 ? ((x.revenue - x.cost) / x.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const marginByProvider = useMemo(
    () =>
      providerTotals.map((p) => ({
        key: p.provider,
        revenue: p.spend,
        cost: p.cost,
        profit: p.profit,
        margin: p.spend > 0 ? (p.profit / p.spend) * 100 : 0,
      })),
    [providerTotals],
  );

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
      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 py-4">
          <FilterSelect
            label="Year"
            value={year}
            onChange={setYear}
            options={[
              { value: ALL, label: "All years" },
              ...YEARS.map((y) => ({ value: String(y), label: String(y) })),
            ]}
          />
          <FilterSelect
            label="Cloud provider"
            value={provider}
            onChange={setProvider}
            options={[
              { value: ALL, label: "All providers" },
              ...providers.map((p) => ({ value: p, label: p })),
            ]}
          />
          <FilterSelect
            label="Line of business"
            value={lob}
            onChange={setLob}
            options={[
              { value: ALL, label: "All LOB" },
              ...lobs.map((l) => ({ value: l, label: l })),
            ]}
          />
          <div className="ml-auto text-xs text-muted-foreground self-center">
            {isLoading ? "Loading…" : `${fmtNumber(totals.count)} transactions in scope`}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive" data-testid="reports-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load reports data</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span className="truncate">{errMsg || "Unknown error"}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Revenue" value={fmtCurrency(totals.revenue)} />
        <Kpi label="Input cost" value={fmtCurrency(totals.cost)} />
        <Kpi label="Profit" value={fmtCurrency(totals.profit)} />
        <Kpi label="Margin" value={`${totals.margin.toFixed(1)}%`} />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="reports-cost-basis">
        Input cost uses actual, then entered, then auto-filled. {COST_BASIS_LABEL.actual}{" "}
        {basis.actual} · {COST_BASIS_LABEL.entered} {basis.entered} · {COST_BASIS_LABEL.auto_avg}{" "}
        {basis.auto_avg}.
      </p>
      <HybridSolutionsCard />

      <Tabs defaultValue="cost" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="cost">Cloud Cost</TabsTrigger>
            <TabsTrigger value="customer">Customer Profitability</TabsTrigger>
            <TabsTrigger value="margin">Margin Analysis</TabsTrigger>
            <TabsTrigger value="forecast">Revenue Forecast</TabsTrigger>
          </TabsList>
        </div>

        {/* Cloud Cost */}
        <TabsContent value="cost" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("cost")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Spend by provider — monthly</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMonthProvider.data}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(v) => fmtCurrency(v as number)} width={90} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Legend />
                  {byMonthProvider.providers.map((p, i) => (
                    <Bar key={p} dataKey={p} stackId="a" fill={COLORS[i % COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider totals</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
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
              <CardTitle>Top labs by spend</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
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

        {/* Customer Profitability */}
        <TabsContent value="customer" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("customer")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Top 10 customers by profit</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={customers.slice(0, 10)} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tickFormatter={(v) => fmtCurrency(v as number)} />
                  <YAxis type="category" dataKey="customer" width={140} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Legend />
                  <Bar dataKey="revenue" fill={COLORS[0]} name="Revenue" />
                  <Bar dataKey="profit" fill={COLORS[1]} name="Profit" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer profitability</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
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

        {/* Margin Analysis */}
        <TabsContent value="margin" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("margin")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Margin % by line of business</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={marginByLob}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="key" />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v: number, n) =>
                        n === "margin" ? `${v.toFixed(1)}%` : fmtCurrency(v)
                      }
                    />
                    <Bar dataKey="margin" fill={COLORS[2]} name="Margin %" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Margin % by cloud provider</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={marginByProvider}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="key" />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v: number, n) =>
                        n === "margin" ? `${v.toFixed(1)}%` : fmtCurrency(v)
                      }
                    />
                    <Bar dataKey="margin" fill={COLORS[3]} name="Margin %" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Margin breakdown by line of business</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
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
              <CardTitle>Margin breakdown by cloud provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
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

        {/* Revenue Forecast */}
        <TabsContent value="forecast" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("forecast")}>
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Projected revenue vs cost — next 12 months</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {isLoading ? (
                <div
                  data-testid="forecast-loading"
                  className="h-full flex items-center justify-center text-sm text-muted-foreground"
                >
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading forecast…
                </div>
              ) : isError ? (
                <div
                  data-testid="forecast-error"
                  className="h-full flex flex-col items-center justify-center gap-2 text-sm"
                >
                  <div className="text-destructive">Could not load forecast data.</div>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              ) : forecast.every((f) => f.revenue === 0 && f.cost === 0) ? (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  No projected revenue in the next 12 months for the current filters.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="key" />
                    <YAxis tickFormatter={(v) => fmtCurrency(v as number)} width={90} />
                    <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke={COLORS[0]} name="Revenue" />
                    <Line type="monotone" dataKey="cost" stroke={COLORS[3]} name="Cost" />
                    <Line type="monotone" dataKey="profit" stroke={COLORS[1]} name="Profit" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Monthly projection</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportTable
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
            <ForecastGroupCard title="By customer" data={forecastByCustomer} />
            <ForecastGroupCard title="By lab" data={forecastByLab} />
            <ForecastGroupCard title="By provider" data={forecastByProvider} />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{drill?.title}</DialogTitle>
          </DialogHeader>
          {drill &&
            (isError ? (
              <div data-testid="drill-error" className="py-6 text-sm">
                <div className="text-destructive mb-2">Could not load underlying transactions.</div>
                <div className="text-muted-foreground mb-3 truncate">{errMsg}</div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : isLoading ? (
              <div
                data-testid="drill-loading"
                className="py-10 flex items-center justify-center text-sm text-muted-foreground"
              >
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading transactions…
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
}: {
  title: string;
  data: { key: string; revenue: number; cost: number; profit: number; margin: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ReportTable
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
                  <TableCell key={c.key} className={j === 0 ? "font-medium" : ""}>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
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
        <CardTitle>Hybrid solutions shipped</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <div className="text-2xl font-semibold" data-testid="hybrid-count">
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReportTable({
  headers,
  rows,
  empty,
  onRowClick,
}: {
  headers: string[];
  rows: (string | number)[][];
  empty?: string;
  onRowClick?: (index: number) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-6 text-center">{empty ?? "No data."}</div>
    );
  }
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
          {rows.map((r, i) => (
            <TableRow
              key={i}
              className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined}
              onClick={onRowClick ? () => onRowClick(i) : undefined}
            >
              {r.map((c, j) => (
                <TableCell key={j} className={j === 0 ? "font-medium" : ""}>
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
