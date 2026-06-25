import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtNumber, MONTH_NAMES } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent-foreground))", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444"];

function DashboardPage() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("transactions")
        .select("month,year,repository_type,cloud_provider,line_of_business,customer_name,total_users,input_cost,selling_cost,is_deleted")
        .eq("is_deleted", false);
      if (error) throw error;
      return rows ?? [];
    },
  });

  const rows = data ?? [];
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const total = rows.length;
  const pub = rows.filter((r) => r.repository_type === "public_cloud").length;
  const priv = rows.filter((r) => r.repository_type === "private_cloud").length;
  const users = rows.reduce((s, r) => s + (r.total_users ?? 0), 0);
  const revenue = rows.reduce((s, r) => s + Number(r.selling_cost ?? 0), 0);
  const inputCostTotal = rows.reduce((s, r) => s + Number(r.input_cost ?? 0), 0);
  const profit = revenue - inputCostTotal;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const avgCost = rows.length ? revenue / rows.length : 0;
  const curRows = rows.filter((r) => r.month === curMonth && r.year === curYear);
  const curRevenue = curRows.reduce((s, r) => s + Number(r.selling_cost ?? 0), 0);
  const curInputCost = curRows.reduce((s, r) => s + Number(r.input_cost ?? 0), 0);
  const curProfit = curRevenue - curInputCost;
  const curUsers = curRows.reduce((s, r) => s + (r.total_users ?? 0), 0);

  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const monthRows = rows.filter((r) => r.month === i + 1 && r.year === curYear);
    const mRev = monthRows.reduce((s, r) => s + Number(r.selling_cost ?? 0), 0);
    const mCost = monthRows.reduce((s, r) => s + Number(r.input_cost ?? 0), 0);
    return {
      month: MONTH_NAMES[i],
      transactions: monthRows.length,
      revenue: mRev,
      cost: mCost,
      profit: mRev - mCost,
    };
  });

  const split = [
    { name: "Public Cloud", value: pub },
    { name: "Private Cloud", value: priv },
  ];

  const providerSplit = ["AWS", "Azure", "GCP"].map((p) => ({
    name: p,
    value: rows.filter((r) => r.cloud_provider === p).length,
  }));

  const lobMap = new Map<string, number>();
  for (const r of rows) lobMap.set(r.line_of_business, (lobMap.get(r.line_of_business) ?? 0) + 1);
  const lobSplit = Array.from(lobMap.entries()).map(([name, value]) => ({ name, value }));

  const custRev = new Map<string, { revenue: number; cost: number; users: number }>();
  for (const r of rows) {
    const e = custRev.get(r.customer_name) ?? { revenue: 0, cost: 0, users: 0 };
    e.revenue += Number(r.selling_cost ?? 0);
    e.cost += Number(r.input_cost ?? 0);
    e.users += r.total_users ?? 0;
    custRev.set(r.customer_name, e);
  }
  const topRev = Array.from(custRev.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
    .map(([name, v]) => ({ name, revenue: v.revenue }));
  const topUsers = Array.from(custRev.entries()).sort((a, b) => b[1].users - a[1].users).slice(0, 5)
    .map(([name, v]) => ({ name, users: v.users }));
  const topProfit = Array.from(custRev.entries())
    .map(([name, v]) => ({ name, profit: v.revenue - v.cost }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  return (
    <AppShell title="Dashboard">
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI label="Total Transactions" value={fmtNumber(total)} />
          <KPI label="Public Cloud" value={fmtNumber(pub)} />
          <KPI label="Private Cloud" value={fmtNumber(priv)} />
          <KPI label="Total Users" value={fmtNumber(users)} />
          <KPI label="Total Revenue" value={fmtCurrency(revenue)} />
          <KPI label="Total Input Cost" value={fmtCurrency(inputCostTotal)} />
          <KPI label="Total Profit" value={fmtCurrency(profit)} />
          <KPI label={`Margin`} value={`${margin.toFixed(1)}%`} />
          <KPI label="Avg Selling Cost" value={fmtCurrency(avgCost)} />
          <KPI label="Current Month Revenue" value={fmtCurrency(curRevenue)} />
          <KPI label="Current Month Profit" value={fmtCurrency(curProfit)} />
          <KPI label="Current Month Users" value={fmtNumber(curUsers)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title={`Transactions by Month — ${curYear}`}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byMonth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="transactions" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title={`Revenue by Month — ${curYear}`}>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={byMonth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
                <Line type="monotone" dataKey="cost" name="Input Cost" stroke="#ef4444" strokeWidth={2} />
                <Line type="monotone" dataKey="profit" name="Profit" stroke="#22c55e" strokeWidth={2} />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Public vs Private Cloud">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={split} dataKey="value" nameKey="name" outerRadius={80} label>
                  {split.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Public Cloud Provider Split">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={providerSplit}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Top Customers by Revenue">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topRev} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" fontSize={11} tickFormatter={(v) => fmtCurrency(v).replace("₹", "")} />
                <YAxis dataKey="name" type="category" fontSize={11} width={120} />
                <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Top Customers by Users">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topUsers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" fontSize={11} />
                <YAxis dataKey="name" type="category" fontSize={11} width={120} />
                <Tooltip />
                <Bar dataKey="users" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Top Customers by Profit">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topProfit} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" fontSize={11} tickFormatter={(v) => fmtCurrency(v).replace("₹", "")} />
                <YAxis dataKey="name" type="category" fontSize={11} width={120} />
                <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                <Bar dataKey="profit" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Line of Business Split">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={lobSplit} dataKey="value" nameKey="name" outerRadius={80} label>
                  {lobSplit.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </AppShell>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}