import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency, fmtNumber, MONTH_NAMES, YEARS } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";

type Row = {
  month: number; year: number;
  repository_type: string; cloud_provider: string; line_of_business: string;
  customer_name: string; lab_name: string;
  total_users: number; input_cost: number; selling_cost: number;
};

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
        .select("month,year,repository_type,cloud_provider,line_of_business,customer_name,lab_name,total_users,input_cost,selling_cost,is_deleted")
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

  const totals = useMemo(() => {
    const revenue = filtered.reduce((s, r) => s + Number(r.selling_cost ?? 0), 0);
    const cost = filtered.reduce((s, r) => s + Number(r.input_cost ?? 0), 0);
    return { revenue, cost, profit: revenue - cost, margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0, count: filtered.length };
  }, [filtered]);

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
        <TabsList>
          <TabsTrigger value="cost">Cloud Cost</TabsTrigger>
          <TabsTrigger value="customer">Customer Profitability</TabsTrigger>
          <TabsTrigger value="margin">Margin Analysis</TabsTrigger>
        </TabsList>

        {/* Cloud Cost */}
        <TabsContent value="cost" className="space-y-4">
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
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Customer Profitability */}
        <TabsContent value="customer" className="space-y-4">
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
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Margin Analysis */}
        <TabsContent value="margin" className="space-y-4">
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
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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

function ReportTable({ headers, rows, empty }: { headers: string[]; rows: (string | number)[][]; empty?: string }) {
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
            <TableRow key={i}>
              {r.map((c, j) => <TableCell key={j} className={j === 0 ? "font-medium" : ""}>{c}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}