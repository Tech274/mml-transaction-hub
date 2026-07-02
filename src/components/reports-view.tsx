import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download } from "lucide-react";
import { fmtCurrency, fmtNumber, MONTH_NAMES, YEARS } from "@/lib/format";
import {
  computeTotals, groupByKey, computeForecast, forecastByDimension, type ReportRow,
} from "@/lib/reports-metrics";
import { exportToExcel } from "@/lib/export-xlsx";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";

type Row = ReportRow;

const COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];
const ALL = "__all__";

export function ReportsView() {
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [provider, setProvider] = useState<string>(ALL);
  const [lob, setLob] = useState<string>(ALL);

  const { data, isLoading } = useQuery({
    queryKey: ["reports", "transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("month,year,repository_type,cloud_provider,line_of_business,customer_name,lab_name,total_users,input_cost,selling_cost,start_date,end_date,is_deleted")
        .eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = data ?? [];
  const providers = useMemo(() => Array.from(new Set(rows.map((r) => r.cloud_provider).filter(Boolean))).sort(), [rows]);
  const lobs = useMemo(() => Array.from(new Set(rows.map((r) => r.line_of_business).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    (year === ALL || r.year === Number(year)) &&
    (provider === ALL || r.cloud_provider === provider) &&
    (lob === ALL || r.line_of_business === lob),
  ), [rows, year, provider, lob]);

  const [drill, setDrill] = useState<{ title: string; rows: Row[] } | null>(null);
  const openDrill = (title: string, subset: Row[]) => setDrill({ title, rows: subset });

  // Cloud cost by provider × month
  const byMonthProvider = useMemo(() => {
    const providerSet = Array.from(new Set(filtered.map((r) => r.cloud_provider).filter(Boolean))).sort();
    return {
      providers: providerSet,
      data: MONTH_NAMES.map((label, i) => {
        const rec: Record<string, string | number> = { month: label };
        for (const p of providerSet) {
          rec[p] = filtered
            .filter((r) => r.month === i + 1 && r.cloud_provider === p)
            .reduce((s, r) => s + Number(r.selling_cost ?? 0), 0);
        }
        return rec;
      }),
    };
  }, [filtered]);

  const topLabs = useMemo(() => {
    const map = new Map<string, { lab: string; provider: string; spend: number; users: number }>();
    for (const r of filtered) {
      const key = `${r.lab_name}||${r.cloud_provider}`;
      const cur = map.get(key) ?? { lab: r.lab_name, provider: r.cloud_provider, spend: 0, users: 0 };
      cur.spend += Number(r.selling_cost ?? 0);
      cur.users += Number(r.total_users ?? 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [filtered]);

  const providerTotals = useMemo(() => {
    const map = new Map<string, { provider: string; spend: number; cost: number; profit: number }>();
    for (const r of filtered) {
      const cur = map.get(r.cloud_provider) ?? { provider: r.cloud_provider, spend: 0, cost: 0, profit: 0 };
      cur.spend += Number(r.selling_cost ?? 0);
      cur.cost += Number(r.input_cost ?? 0);
      cur.profit = cur.spend - cur.cost;
      map.set(r.cloud_provider, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [filtered]);

  // Customer profitability
  const customers = useMemo(() => {
    const map = new Map<string, { customer: string; revenue: number; cost: number; profit: number; margin: number; tx: number; users: number }>();
    for (const r of filtered) {
      const cur = map.get(r.customer_name) ?? { customer: r.customer_name, revenue: 0, cost: 0, profit: 0, margin: 0, tx: 0, users: 0 };
      cur.revenue += Number(r.selling_cost ?? 0);
      cur.cost += Number(r.input_cost ?? 0);
      cur.tx += 1;
      cur.users += Number(r.total_users ?? 0);
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
      cur.revenue += Number(r.selling_cost ?? 0);
      cur.cost += Number(r.input_cost ?? 0);
      map.set(r.line_of_business, cur);
    }
    return Array.from(map.values()).map((x) => ({
      key: x.key, revenue: x.revenue, cost: x.cost, profit: x.revenue - x.cost,
      margin: x.revenue > 0 ? ((x.revenue - x.cost) / x.revenue) * 100 : 0,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [filtered]);

  const marginByProvider = useMemo(() =>
    providerTotals.map((p) => ({
      key: p.provider, revenue: p.spend, cost: p.cost, profit: p.profit,
      margin: p.spend > 0 ? (p.profit / p.spend) * 100 : 0,
    })),
  [providerTotals]);

  const totals = useMemo(() => computeTotals(filtered), [filtered]);

  // Forecasting
  const forecast = useMemo(() => computeForecast(filtered, new Date(), 12), [filtered]);
  const forecastByCustomer = useMemo(() => forecastByDimension(filtered, "customer_name"), [filtered]);
  const forecastByLab = useMemo(() => forecastByDimension(filtered, "lab_name"), [filtered]);
  const forecastByProvider = useMemo(() => forecastByDimension(filtered, "cloud_provider"), [filtered]);

  const filterMeta = { Year: year === ALL ? "All" : year, Provider: provider === ALL ? "All" : provider, LOB: lob === ALL ? "All" : lob };
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
        ...providerTotals.map((p) => ({ section: "Provider totals", provider: p.provider, revenue: p.spend, cost: p.cost, profit: p.profit })),
        ...topLabs.map((l) => ({ section: "Top labs", lab: l.lab, provider: l.provider, users: l.users, spend: l.spend })),
      ];
    } else if (tab === "customer") {
      name = "customer-profitability";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...customers.map((c) => ({ section: "Customer", customer: c.customer, txns: c.tx, users: c.users, revenue: c.revenue, cost: c.cost, profit: c.profit, margin: Number(c.margin.toFixed(2)) })),
      ];
    } else if (tab === "margin") {
      name = "margin-analysis";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...marginByLob.map((m) => ({ section: "By LOB", key: m.key, revenue: m.revenue, cost: m.cost, profit: m.profit, margin: Number(m.margin.toFixed(2)) })),
        ...marginByProvider.map((m) => ({ section: "By provider", key: m.key, revenue: m.revenue, cost: m.cost, profit: m.profit, margin: Number(m.margin.toFixed(2)) })),
      ];
    } else {
      name = "revenue-forecast";
      rowsOut = [
        ...totalsSheet.map((t) => ({ section: "Totals", ...t })),
        ...forecast.map((f) => ({ section: "Monthly", month: f.key, revenue: f.revenue, cost: f.cost, profit: f.profit, margin: Number(f.margin.toFixed(2)) })),
        ...forecastByCustomer.map((c) => ({ section: "By customer", key: c.key, revenue: c.revenue, cost: c.cost, profit: c.profit, margin: Number(c.margin.toFixed(2)) })),
        ...forecastByLab.map((c) => ({ section: "By lab", key: c.key, revenue: c.revenue, cost: c.cost, profit: c.profit, margin: Number(c.margin.toFixed(2)) })),
        ...forecastByProvider.map((c) => ({ section: "By provider", key: c.key, revenue: c.revenue, cost: c.cost, profit: c.profit, margin: Number(c.margin.toFixed(2)) })),
      ];
    }
    exportToExcel(name, rowsOut, { generatedBy: "Reports", filters: filterMeta });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 py-4">
          <FilterSelect label="Year" value={year} onChange={setYear} options={[{ value: ALL, label: "All years" }, ...YEARS.map((y) => ({ value: String(y), label: String(y) }))]} />
          <FilterSelect label="Cloud provider" value={provider} onChange={setProvider} options={[{ value: ALL, label: "All providers" }, ...providers.map((p) => ({ value: p, label: p }))]} />
          <FilterSelect label="Line of business" value={lob} onChange={setLob} options={[{ value: ALL, label: "All LOB" }, ...lobs.map((l) => ({ value: l, label: l }))]} />
          <div className="ml-auto text-xs text-muted-foreground self-center">
            {isLoading ? "Loading…" : `${fmtNumber(totals.count)} transactions in scope`}
          </div>
        </CardContent>
      </Card>

      {/* Totals strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Revenue" value={fmtCurrency(totals.revenue)} />
        <Kpi label="Input cost" value={fmtCurrency(totals.cost)} />
        <Kpi label="Profit" value={fmtCurrency(totals.profit)} />
        <Kpi label="Margin" value={`${totals.margin.toFixed(1)}%`} />
      </div>

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
              <Download className="mr-2 h-4 w-4" />Export Excel
            </Button>
          </div>
          <Card>
            <CardHeader><CardTitle>Spend by provider — monthly</CardTitle></CardHeader>
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
            <CardHeader><CardTitle>Provider totals</CardTitle></CardHeader>
            <CardContent>
              <ReportTable
                headers={["Provider", "Revenue", "Cost", "Profit"]}
                rows={providerTotals.map((p) => [p.provider, fmtCurrency(p.spend), fmtCurrency(p.cost), fmtCurrency(p.profit)])}
                onRowClick={(i) => {
                  const p = providerTotals[i];
                  openDrill(`Transactions — ${p.provider}`, filtered.filter((r) => r.cloud_provider === p.provider));
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Top labs by spend</CardTitle></CardHeader>
            <CardContent>
              <ReportTable
                headers={["Lab", "Provider", "Users", "Spend"]}
                rows={topLabs.map((l) => [l.lab, l.provider, fmtNumber(l.users), fmtCurrency(l.spend)])}
                empty="No labs in current filter."
                onRowClick={(i) => {
                  const l = topLabs[i];
                  openDrill(`Transactions — ${l.lab} · ${l.provider}`, filtered.filter((r) => r.lab_name === l.lab && r.cloud_provider === l.provider));
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Customer Profitability */}
        <TabsContent value="customer" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("customer")}>
              <Download className="mr-2 h-4 w-4" />Export Excel
            </Button>
          </div>
          <Card>
            <CardHeader><CardTitle>Top 10 customers by profit</CardTitle></CardHeader>
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
            <CardHeader><CardTitle>Customer profitability</CardTitle></CardHeader>
            <CardContent>
              <ReportTable
                headers={["Customer", "Txns", "Users", "Revenue", "Cost", "Profit", "Margin"]}
                rows={customers.map((c) => [
                  c.customer, fmtNumber(c.tx), fmtNumber(c.users),
                  fmtCurrency(c.revenue), fmtCurrency(c.cost),
                  fmtCurrency(c.profit), `${c.margin.toFixed(1)}%`,
                ])}
                empty="No customers in current filter."
                onRowClick={(i) => {
                  const c = customers[i];
                  openDrill(`Transactions — ${c.customer}`, filtered.filter((r) => r.customer_name === c.customer));
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Margin Analysis */}
        <TabsContent value="margin" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("margin")}>
              <Download className="mr-2 h-4 w-4" />Export Excel
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Margin % by line of business</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={marginByLob}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="key" />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: number, n) => n === "margin" ? `${v.toFixed(1)}%` : fmtCurrency(v)} />
                    <Bar dataKey="margin" fill={COLORS[2]} name="Margin %" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Margin % by cloud provider</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={marginByProvider}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="key" />
                    <YAxis tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: number, n) => n === "margin" ? `${v.toFixed(1)}%` : fmtCurrency(v)} />
                    <Bar dataKey="margin" fill={COLORS[3]} name="Margin %" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Margin breakdown by line of business</CardTitle></CardHeader>
            <CardContent>
              <ReportTable
                headers={["Line of business", "Revenue", "Cost", "Profit", "Margin"]}
                rows={marginByLob.map((m) => [m.key, fmtCurrency(m.revenue), fmtCurrency(m.cost), fmtCurrency(m.profit), `${m.margin.toFixed(1)}%`])}
                empty="No data for current filter."
                onRowClick={(i) => {
                  const m = marginByLob[i];
                  openDrill(`Transactions — LOB ${m.key}`, filtered.filter((r) => r.line_of_business === m.key));
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Margin breakdown by cloud provider</CardTitle></CardHeader>
            <CardContent>
              <ReportTable
                headers={["Provider", "Revenue", "Cost", "Profit", "Margin"]}
                rows={marginByProvider.map((m) => [m.key, fmtCurrency(m.revenue), fmtCurrency(m.cost), fmtCurrency(m.profit), `${m.margin.toFixed(1)}%`])}
                empty="No data for current filter."
                onRowClick={(i) => {
                  const m = marginByProvider[i];
                  openDrill(`Transactions — ${m.key}`, filtered.filter((r) => r.cloud_provider === m.key));
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue Forecast */}
        <TabsContent value="forecast" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => exportTab("forecast")}>
              <Download className="mr-2 h-4 w-4" />Export Excel
            </Button>
          </div>
          <Card>
            <CardHeader><CardTitle>Projected revenue vs cost — next 12 months</CardTitle></CardHeader>
            <CardContent className="h-80">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Monthly projection</CardTitle></CardHeader>
            <CardContent>
              <ReportTable
                headers={["Month", "Revenue", "Cost", "Profit", "Margin"]}
                rows={forecast.map((f) => [f.key, fmtCurrency(f.revenue), fmtCurrency(f.cost), fmtCurrency(f.profit), `${f.margin.toFixed(1)}%`])}
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
          <DialogHeader><DialogTitle>{drill?.title}</DialogTitle></DialogHeader>
          {drill && <DrillTable rows={drill.rows} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ForecastGroupCard({ title, data }: { title: string; data: { key: string; revenue: number; cost: number; profit: number; margin: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>
        <ReportTable
          headers={["Key", "Revenue", "Profit", "Margin"]}
          rows={data.slice(0, 10).map((d) => [d.key, fmtCurrency(d.revenue), fmtCurrency(d.profit), `${d.margin.toFixed(1)}%`])}
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
      const cur = map.get(r.repository_type) ?? { key: r.repository_type, revenue: 0, cost: 0, count: 0 };
      cur.revenue += Number(r.selling_cost ?? 0);
      cur.cost += Number(r.input_cost ?? 0);
      cur.count += 1;
      map.set(r.repository_type, cur);
    }
    return Array.from(map.values());
  }, [rows]);
  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto">
      <div>
        <div className="text-sm font-medium mb-2">Repository breakdown</div>
        <ReportTable
          headers={["Repository", "Txns", "Revenue", "Cost", "Profit"]}
          rows={byRepo.map((r) => [r.key, fmtNumber(r.count), fmtCurrency(r.revenue), fmtCurrency(r.cost), fmtCurrency(r.revenue - r.cost)])}
        />
      </div>
      <div>
        <div className="text-sm font-medium mb-2">Underlying transactions ({rows.length})</div>
        <ReportTable
          headers={["Customer", "Lab", "Provider", "LOB", "Users", "Revenue", "Cost"]}
          rows={rows.map((r) => [r.customer_name, r.lab_name, r.cloud_provider, r.line_of_business, fmtNumber(r.total_users), fmtCurrency(r.selling_cost), fmtCurrency(r.input_cost)])}
        />
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

function FilterSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReportTable({ headers, rows, empty, onRowClick }: { headers: string[]; rows: (string | number)[][]; empty?: string; onRowClick?: (index: number) => void }) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground py-6 text-center">{empty ?? "No data."}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className={onRowClick ? "cursor-pointer hover:bg-muted/50" : undefined} onClick={onRowClick ? () => onRowClick(i) : undefined}>
              {r.map((c, j) => <TableCell key={j} className={j === 0 ? "font-medium" : ""}>{c}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}