import { createFileRoute } from "@tanstack/react-router";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAgentKpis } from "@/lib/freshdesk.functions";
import { supabase } from "@/integrations/supabase/client";
import { readAllRows } from "@/lib/read-all";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtNumber, MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { costBasisCounts, reportLineCost, type ReportRow } from "@/lib/reports-metrics";
import { COST_BASIS_LABEL } from "@/lib/cost-calculator";
import { usePermissions, setPreviewRole } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent-foreground))",
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
];

function DashboardPage() {
  const { can, orderedKpis, isPreviewing, previewRole } = usePermissions();
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      // SCRUM-70: all rows, not just the first 1,000 (PostgREST default limit).
      return readAllRows(
        () =>
          supabase
            .from("transactions")
            .select(
              "month,year,repository_type,cloud_provider,line_of_business,customer_name,total_users,input_cost,input_cost_auto,input_cost_actual_alloc,selling_cost,is_deleted",
            )
            .eq("is_deleted", false)
            .order("id"),
        "Dashboard transactions",
      );
    },
  });

  const rows = (data ?? []) as unknown as ReportRow[];
  const basis = costBasisCounts(rows);
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const total = rows.length;
  const pub = rows.filter((r) => r.repository_type === "public_cloud").length;
  const priv = rows.filter((r) => r.repository_type === "private_cloud").length;
  const users = rows.reduce((s, r) => addNullable(s, r.total_users), 0);
  const revenue = rows.reduce((s, r) => addNullable(s, r.selling_cost), 0);
  const inputCostTotal = rows.reduce((s, r) => addNullable(s, reportLineCost(r)), 0);
  const profit = revenue - inputCostTotal;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const avgCost = rows.length ? revenue / rows.length : 0;
  const curRows = rows.filter((r) => r.month === curMonth && r.year === curYear);
  const curRevenue = curRows.reduce((s, r) => addNullable(s, r.selling_cost), 0);
  const curInputCost = curRows.reduce((s, r) => addNullable(s, reportLineCost(r)), 0);
  const curProfit = curRevenue - curInputCost;
  const curUsers = curRows.reduce((s, r) => addNullable(s, r.total_users), 0);

  const navigate = useNavigate();
  const reportsTo = can("feature_reports_access") ? "/reports" : "/transactions";
  const curMonthSearch = { month: curMonth, year: curYear };
  const goMonth = (name?: string) => {
    const idx = MONTH_NAMES.indexOf(String(name));
    navigate({
      to: "/transactions",
      search: idx >= 0 ? { month: idx + 1, year: curYear } : { year: curYear },
    });
  };
  const goCustomer = (name?: string) => {
    if (name) navigate({ to: "/customers", search: { q: String(name), status: "all" as const } });
  };

  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const monthRows = rows.filter((r) => r.month === i + 1 && r.year === curYear);
    const mRev = monthRows.reduce((s, r) => addNullable(s, r.selling_cost), 0);
    const mCost = monthRows.reduce((s, r) => addNullable(s, reportLineCost(r)), 0);
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
    e.revenue = addNullable(e.revenue, r.selling_cost);
    e.cost = addNullable(e.cost, reportLineCost(r));
    e.users = addNullable(e.users, r.total_users);
    custRev.set(r.customer_name, e);
  }
  const topRev = Array.from(custRev.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([name, v]) => ({ name, revenue: v.revenue }));
  const topUsers = Array.from(custRev.entries())
    .sort((a, b) => b[1].users - a[1].users)
    .slice(0, 5)
    .map(([name, v]) => ({ name, users: v.users }));
  const topProfit = Array.from(custRev.entries())
    .map(([name, v]) => ({ name, profit: v.revenue - v.cost }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5);

  return (
    <AppShell title="Dashboard">
      <div className="space-y-6">
        {isPreviewing && (
          <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm flex items-center justify-between">
            <span>
              Previewing dashboard as <strong>{previewRole}</strong>. Disable to return to your
              Super Admin view.
            </span>
            <Button size="sm" variant="outline" onClick={() => setPreviewRole(null)}>
              Exit preview
            </Button>
          </div>
        )}
        <KpiGrid
          order={orderedKpis}
          can={can}
          cards={{
            kpi_total_transactions: (
              <KPI label="Total Transactions" value={fmtNumber(total)} to="/transactions" />
            ),
            kpi_public_cloud: (
              <KPI label="Public Cloud" value={fmtNumber(pub)} to="/public-cloud" />
            ),
            kpi_private_cloud: (
              <KPI label="Private Cloud" value={fmtNumber(priv)} to="/private-cloud" />
            ),
            kpi_total_users: (
              <KPI label="Total Users" value={fmtNumber(users)} to="/transactions" />
            ),
            kpi_total_revenue: (
              <KPI label="Total Revenue" value={fmtCurrency(revenue)} to={reportsTo} />
            ),
            kpi_total_input_cost: (
              <KPI label="Total Input Cost" value={fmtCurrency(inputCostTotal)} to={reportsTo} />
            ),
            kpi_total_profit: (
              <KPI label="Total Profit" value={fmtCurrency(profit)} to={reportsTo} />
            ),
            kpi_margin: <KPI label="Margin" value={`${margin.toFixed(1)}%`} to={reportsTo} />,
            kpi_avg_cost: (
              <KPI label="Avg Selling Cost" value={fmtCurrency(avgCost)} to="/transactions" />
            ),
            kpi_current_month_revenue: (
              <KPI
                label="Current Month Revenue"
                value={fmtCurrency(curRevenue)}
                to="/transactions"
                search={curMonthSearch}
              />
            ),
            kpi_current_month_profit: (
              <KPI
                label="Current Month Profit"
                value={fmtCurrency(curProfit)}
                to="/transactions"
                search={curMonthSearch}
              />
            ),
            kpi_current_month_users: (
              <KPI
                label="Current Month Users"
                value={fmtNumber(curUsers)}
                to="/transactions"
                search={curMonthSearch}
              />
            ),
          }}
        />
        <p className="text-xs text-muted-foreground" data-testid="cost-basis-note">
          Cost basis: actual invoice allocation, then entered estimate, then auto-filled average.{" "}
          {COST_BASIS_LABEL.actual} {basis.actual} · {COST_BASIS_LABEL.entered} {basis.entered} ·{" "}
          {COST_BASIS_LABEL.auto_avg} {basis.auto_avg}
          {basis.none ? ` · ${COST_BASIS_LABEL.none} ${basis.none}` : ""}.
        </p>

        <MyAgentTicketKpis />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {can("chart_tx_by_month") && (
            <ChartCard
              title={`Transactions by Month — ${curYear}`}
              to="/transactions"
              search={{ year: curYear }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byMonth} onClick={(s: any) => goMonth(s?.activeLabel)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar
                    dataKey="transactions"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_revenue_by_month") && (
            <ChartCard
              title={`Revenue by Month — ${curYear}`}
              to="/transactions"
              search={{ year: curYear }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={byMonth}
                  onClick={(s: any) => goMonth(s?.activeLabel)}
                  className="cursor-pointer"
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    name="Input Cost"
                    stroke="#ef4444"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="profit"
                    name="Profit"
                    stroke="#22c55e"
                    strokeWidth={2}
                  />
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_pub_priv") && (
            <ChartCard title="Public vs Private Cloud">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={split}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    label
                    className="cursor-pointer"
                    onClick={(e: any) =>
                      navigate({
                        to: e?.name === "Private Cloud" ? "/private-cloud" : "/public-cloud",
                        search: {},
                      })
                    }
                  >
                    {split.map((_, i) => (
                      <Cell key={i} fill={COLORS[i]} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_provider") && (
            <ChartCard title="Public Cloud Provider Split" to="/public-cloud" search={{}}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={providerSplit}
                  onClick={(s: any) =>
                    s?.activeLabel &&
                    navigate({ to: "/transactions", search: { provider: String(s.activeLabel) } })
                  }
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar
                    dataKey="value"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_top_revenue") && (
            <ChartCard
              title="Top Customers by Revenue"
              to="/customers"
              search={{ status: "all" as const }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={topRev}
                  layout="vertical"
                  onClick={(s: any) => goCustomer(s?.activeLabel)}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={(v) => fmtCurrency(v).replace("₹", "")}
                  />
                  <YAxis dataKey="name" type="category" fontSize={11} width={120} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Bar
                    dataKey="revenue"
                    fill="hsl(var(--primary))"
                    radius={[0, 4, 4, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_top_users") && (
            <ChartCard
              title="Top Customers by Users"
              to="/customers"
              search={{ status: "all" as const }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={topUsers}
                  layout="vertical"
                  onClick={(s: any) => goCustomer(s?.activeLabel)}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" fontSize={11} />
                  <YAxis dataKey="name" type="category" fontSize={11} width={120} />
                  <Tooltip />
                  <Bar
                    dataKey="users"
                    fill="hsl(var(--primary))"
                    radius={[0, 4, 4, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_top_profit") && (
            <ChartCard
              title="Top Customers by Profit"
              to="/customers"
              search={{ status: "all" as const }}
            >
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={topProfit}
                  layout="vertical"
                  onClick={(s: any) => goCustomer(s?.activeLabel)}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    tickFormatter={(v) => fmtCurrency(v).replace("₹", "")}
                  />
                  <YAxis dataKey="name" type="category" fontSize={11} width={120} />
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                  <Bar
                    dataKey="profit"
                    fill="#22c55e"
                    radius={[0, 4, 4, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {can("chart_lob") && (
            <ChartCard title="Line of Business Split" to="/transactions" search={{}}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={lobSplit}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    label
                    className="cursor-pointer"
                    onClick={(e: any) =>
                      e?.name && navigate({ to: "/transactions", search: { lob: String(e.name) } })
                    }
                  >
                    {lobSplit.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          <div className="lg:col-span-2">
            <CustomersByAccountManager />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function KPI({
  label,
  value,
  to,
  search,
}: {
  label: string;
  value: string;
  to?: string;
  search?: Record<string, unknown>;
}) {
  const inner = (
    <Card className={to ? "h-full transition hover:border-primary hover:shadow-md" : undefined}>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {to && (
          <div className="mt-2 text-xs text-primary opacity-0 group-hover:opacity-100 transition">
            View details →
          </div>
        )}
      </CardContent>
    </Card>
  );
  if (!to) return inner;
  return (
    <Link
      to={to as never}
      search={(search ?? {}) as never}
      className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      {inner}
    </Link>
  );
}

function KpiGrid({
  order,
  can,
  cards,
}: {
  order: string[];
  can: (k: string) => boolean;
  cards: Record<string, React.ReactNode>;
}) {
  const visible = order.filter((k) => can(k) && cards[k]);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {visible.map((k) => (
        <div key={k}>{cards[k]}</div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  children,
  to,
  search,
}: {
  title: string;
  children: React.ReactNode;
  to?: string;
  search?: Record<string, unknown>;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          {to && (
            <Link
              to={to as never}
              search={(search ?? {}) as never}
              className="text-xs text-primary hover:underline whitespace-nowrap"
            >
              View all →
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function CustomersByAccountManager() {
  const { can, isPreviewing, previewRole } = usePermissions();
  const allowed = can("widget_customers_by_am");
  const [rangeMonths, setRangeMonths] = useState<3 | 6 | 12>(6);

  const { data } = useQuery({
    queryKey: ["dashboard-customers-by-am"],
    queryFn: async () => {
      return readAllRows(
        () =>
          supabase
            .from("customers")
            .select("id, account_manager_name, is_active, created_at")
            .order("id"),
        "Customers by account manager",
      );
    },
    enabled: allowed,
  });

  // Hide entirely for non-admins who lack the permission.
  // When an admin is previewing as a role that lacks it, show an explanatory
  // fallback so they can see what that role would experience.
  if (!allowed) {
    if (!isPreviewing) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Customers by Account Manager</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm">
            <div className="font-medium mb-1">Hidden for this role</div>
            <div className="text-muted-foreground">
              The <strong>{previewRole}</strong> role doesn't have the
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                widget_customers_by_am
              </code>
              permission, so this widget is hidden on their dashboard. Enable it in{" "}
              <strong>Admin → Permissions</strong> to grant access.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows = data ?? [];

  // Range cutoff for "new customers" within the selected window
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - rangeMonths);
  cutoff.setHours(0, 0, 0, 0);

  const inRange = rows.filter((r) => r.created_at && new Date(r.created_at) >= cutoff);
  const active = inRange.filter((r) => r.is_active).length;
  const inactive = inRange.length - active;

  const amMap = new Map<string, { active: number; inactive: number }>();
  for (const r of inRange) {
    const key = r.account_manager_name?.trim() || "Unassigned";
    const e = amMap.get(key) ?? { active: 0, inactive: 0 };
    if (r.is_active) e.active += 1;
    else e.inactive += 1;
    amMap.set(key, e);
  }
  const topAms = Array.from(amMap.entries())
    .map(([name, v]) => ({
      name,
      active: v.active,
      inactive: v.inactive,
      total: v.active + v.inactive,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  // Trend of new customers across the selected range
  const months: { label: string; key: string; count: number }[] = [];
  const now = new Date();
  for (let i = rangeMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`,
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      count: 0,
    });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const r of inRange) {
    if (!r.created_at) continue;
    const d = new Date(r.created_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = byKey.get(k);
    if (m) m.count += 1;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Customers by Account Manager</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={String(rangeMonths)}
              onValueChange={(v) => setRangeMonths(Number(v) as 3 | 6 | 12)}
            >
              <SelectTrigger className="h-8 w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">Last 3 months</SelectItem>
                <SelectItem value="6">Last 6 months</SelectItem>
                <SelectItem value="12">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild size="sm" variant="ghost">
              <Link to="/customers" search={{ status: "active", range: rangeMonths }}>
                View all →
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat
            label={`New (last ${rangeMonths}m)`}
            value={fmtNumber(inRange.length)}
            search={{ status: "all" as const, range: rangeMonths }}
          />
          <Stat
            label="Active"
            value={fmtNumber(active)}
            tone="positive"
            search={{ status: "active" as const, range: rangeMonths }}
          />
          <Stat
            label="Deactivated"
            value={fmtNumber(inactive)}
            tone="muted"
            search={{ status: "inactive" as const, range: rangeMonths }}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              Top account managers
            </div>
            <ul className="space-y-1">
              {topAms.length === 0 && (
                <li className="text-sm text-muted-foreground">No data yet.</li>
              )}
              {topAms.map((am) => (
                <li key={am.name}>
                  <Link
                    to="/customers"
                    search={{
                      am: am.name === "Unassigned" ? "__none" : am.name,
                      status: "active",
                      range: rangeMonths,
                    }}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/60 transition"
                  >
                    <span className="text-sm font-medium truncate">{am.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      <span className="text-emerald-600">{am.active}</span>
                      <span className="mx-1">·</span>
                      <span>{am.inactive} inactive</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              New customers — last {rangeMonths} months
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={months}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
  search,
}: {
  label: string;
  value: string;
  tone?: "positive" | "muted";
  search?: Record<string, unknown>;
}) {
  const color =
    tone === "positive" ? "text-emerald-600" : tone === "muted" ? "text-muted-foreground" : "";
  const inner = (
    <div
      className={`rounded-md border border-border p-3 h-full ${search ? "transition hover:border-primary hover:bg-muted/50" : ""}`}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
  if (!search) return inner;
  return (
    <Link to="/customers" search={search as never} className="block h-full">
      {inner}
    </Link>
  );
}

/** Agent-specific support KPIs, linked straight into the agent's ticket queue. */
function MyAgentTicketKpis() {
  const kpisFn = useServerFn(getMyAgentKpis);
  const { data, isLoading } = useQuery({
    queryKey: ["freshdesk", "my-agent-kpis"],
    queryFn: () => kpisFn(),
    retry: false,
  });

  if (isLoading || !data) return null;

  if (!data.agent_name) {
    return (
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">See your own ticket numbers here</div>
            <p className="text-xs text-muted-foreground">
              Pick your helpdesk name on the Support tickets page to track tickets closed, average
              resolution time and tickets per month.
            </p>
          </div>
          <Link
            to="/tickets"
            search={{ view: "mine" as const, quick: "all" as const }}
            className="text-xs text-primary hover:underline"
          >
            Go to my tickets →
          </Link>
        </CardContent>
      </Card>
    );
  }

  const avg =
    data.avg_resolution_hours === null
      ? "—"
      : data.avg_resolution_hours < 48
        ? `${data.avg_resolution_hours.toFixed(1)} h`
        : `${(data.avg_resolution_hours / 24).toFixed(1)} d`;
  const mine = { view: "mine" as const, quick: "all" as const };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">My support tickets — {data.agent_name}</CardTitle>
          <Link
            to="/tickets"
            search={mine}
            className="text-xs text-primary hover:underline whitespace-nowrap"
          >
            Open my queue →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI
            label="Tickets Closed"
            value={fmtNumber(data.closed)}
            to="/tickets"
            search={{ view: "mine", quick: "closed" }}
          />
          <KPI
            label="Avg Resolution Time"
            value={avg}
            to="/tickets"
            search={{ view: "mine", quick: "resolved" }}
          />
          <KPI
            label="Tickets This Month"
            value={fmtNumber(data.this_month)}
            to="/tickets"
            search={mine}
          />
          <KPI
            label="In My Queue"
            value={fmtNumber(data.open_queue)}
            to="/tickets"
            search={{ view: "mine", quick: "open" }}
          />
        </div>
        {data.by_month.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.by_month}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="total"
                name="Assigned"
                fill="hsl(var(--primary))"
                radius={[4, 4, 0, 0]}
              />
              <Bar dataKey="closed" name="Closed" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-muted-foreground">
          Average resolution time is measured across {fmtNumber(data.resolved_sample)} resolved or
          closed tickets.
          {data.overdue > 0 && ` ${data.overdue} of your open tickets are overdue.`}
        </p>
      </CardContent>
    </Card>
  );
}
