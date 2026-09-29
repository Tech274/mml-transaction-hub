import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtNumber, MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { readAllRows } from "@/lib/read-all";
import { getSyncOverview } from "@/lib/sync.functions";
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

const EXAMPLE_ROWS: TxRow[] = [
  { month: 9, year: 2026, customer_name: "Cognizant", line_of_business: "VILT", cloud_provider: "Azure", selling_cost: 67600, input_cost: 48200, input_cost_actual_alloc: 46850, input_cost_auto: null, total_users: 42, repository_type: "public_cloud", start_date: "2026-09-02", end_date: "2026-09-28" },
  { month: 9, year: 2026, customer_name: "Infosys", line_of_business: "Standalone", cloud_provider: "AWS", selling_cost: 57500, input_cost: 39100, input_cost_actual_alloc: 38920, input_cost_auto: null, total_users: 30, repository_type: "public_cloud", start_date: "2026-09-05", end_date: "2026-09-27" },
  { month: 9, year: 2026, customer_name: "TCS", line_of_business: "VILT", cloud_provider: "Azure", selling_cost: 96500, input_cost: 73400, input_cost_actual_alloc: 72130, input_cost_auto: null, total_users: 55, repository_type: "public_cloud", start_date: "2026-09-01", end_date: "2026-09-29" },
  { month: 8, year: 2026, customer_name: "Wipro", line_of_business: "Standalone", cloud_provider: "GCP", selling_cost: 44600, input_cost: 28800, input_cost_actual_alloc: 28240, input_cost_auto: null, total_users: 24, repository_type: "public_cloud", start_date: "2026-08-03", end_date: "2026-08-26" },
  { month: 8, year: 2026, customer_name: "HCL", line_of_business: "Integrated", cloud_provider: "Azure", selling_cost: 63100, input_cost: 41900, input_cost_actual_alloc: 40210, input_cost_auto: null, total_users: 33, repository_type: "private_cloud", start_date: "2026-08-04", end_date: "2026-08-30" },
  { month: 7, year: 2026, customer_name: "Accenture", line_of_business: "Integrated", cloud_provider: "AWS", selling_cost: 68600, input_cost: 44600, input_cost_actual_alloc: 44120, input_cost_auto: null, total_users: 37, repository_type: "private_cloud", start_date: "2026-07-06", end_date: "2026-07-30" },
  { month: 7, year: 2026, customer_name: "Capgemini", line_of_business: "VILT", cloud_provider: "Azure", selling_cost: 35200, input_cost: 22900, input_cost_actual_alloc: 21980, input_cost_auto: null, total_users: 20, repository_type: "public_cloud", start_date: "2026-07-02", end_date: "2026-07-25" },
];

function lineCost(row: Pick<TxRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

export function DashboardSummary() {
  const syncOverviewFn = useServerFn(getSyncOverview);
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-summary-v2"],
    queryFn: async () => {
      const now = new Date();
      const year = now.getFullYear();
      if (isExampleCaptureMode) {
        const txRows = EXAMPLE_ROWS;
        const byMonth = Array.from({ length: 12 }, (_, idx) => {
          const month = idx + 1;
          const rows = txRows.filter((row) => row.year === year && row.month === month);
          const revenue = rows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
          const cost = rows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
          const marginPct = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
          return {
            month: MONTH_NAMES[idx].slice(0, 3),
            revenue,
            cost,
            marginPct: Number(marginPct.toFixed(1)),
          };
        });
        const revenue = txRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
        const cost = txRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
        const profit = revenue - cost;
        const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
        return {
          year,
          byMonth,
          customerCount: 12,
          revenue,
          profit,
          marginPct,
          openTickets: 9,
          activeResources: 24,
          topCustomers: [
            { name: "TCS", revenue: 96500, profit: 24370, users: 55 },
            { name: "Cognizant", revenue: 67600, profit: 20750, users: 42 },
            { name: "Accenture", revenue: 68600, profit: 24480, users: 37 },
            { name: "HCL", revenue: 63100, profit: 22890, users: 33 },
            { name: "Infosys", revenue: 57500, profit: 18580, users: 30 },
          ],
          keyAlerts: ["9 support tickets are open.", "3 AI proposals are awaiting review."],
          syncOverview: {
            freshdesk: { health: { state: "ok", message: "Freshdesk sync healthy" } },
            last_success: { status: "success", started_at: new Date().toISOString() },
          },
        };
      }
      const [customerCountResult, activeResourcesResult, openTicketsResult, txRows, syncOverview, pendingProposals] =
        await Promise.all([
          supabase.from("customers").select("id", { head: true, count: "exact" }).eq("is_active", true),
          supabase.from("profiles").select("id", { head: true, count: "exact" }).eq("is_active", true),
          supabase
            .from("freshdesk_tickets")
            .select("id", { head: true, count: "exact" })
            .in("status", ["Open", "Pending", "Waiting on Customer", "Waiting on Third Party"]),
          readAllRows(
            () =>
              supabase
                .from("transactions")
                .select(
                  "month,year,customer_name,line_of_business,cloud_provider,selling_cost,input_cost,input_cost_actual_alloc,input_cost_auto,total_users,repository_type,start_date,end_date,is_deleted",
                )
                .eq("is_deleted", false)
                .order("id"),
            "Dashboard summary transactions",
          ) as Promise<TxRow[]>,
          syncOverviewFn(),
          supabase.from("ai_cc_inbox").select("id", { head: true, count: "exact" }).eq("status", "pending"),
        ]);

      const byMonth = Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const rows = txRows.filter((row) => row.year === year && row.month === month);
        const revenue = rows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
        const cost = rows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
        const marginPct = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
        return {
          month: MONTH_NAMES[idx].slice(0, 3),
          revenue,
          cost,
          marginPct: Number(marginPct.toFixed(1)),
        };
      });

      const revenue = txRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
      const cost = txRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
      const profit = revenue - cost;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;

      const customerMap = new Map<string, { revenue: number; cost: number; users: number }>();
      for (const row of txRows) {
        const key = row.customer_name ?? "Unknown";
        const prev = customerMap.get(key) ?? { revenue: 0, cost: 0, users: 0 };
        prev.revenue = addNullable(prev.revenue, row.selling_cost);
        prev.cost = addNullable(prev.cost, lineCost(row));
        prev.users = addNullable(prev.users, row.total_users);
        customerMap.set(key, prev);
      }
      const topCustomers = [...customerMap.entries()]
        .map(([name, value]) => ({
          name,
          revenue: value.revenue,
          profit: value.revenue - value.cost,
          users: value.users,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      const keyAlerts: string[] = [];
      const customerCount = customerCountResult.count ?? 0;
      const activeResources = activeResourcesResult.count ?? 0;
      const openTicketsCount = openTicketsResult.count ?? 0;
      if (openTicketsCount > 0) keyAlerts.push(`${fmtNumber(openTicketsCount)} support tickets are open.`);
      if (syncOverview.freshdesk.health.state !== "ok") keyAlerts.push(syncOverview.freshdesk.health.message);
      if ((pendingProposals.count ?? 0) > 0) {
        keyAlerts.push(`${fmtNumber(pendingProposals.count ?? 0)} AI proposals are awaiting review.`);
      }
      if (keyAlerts.length === 0) keyAlerts.push("No active alerts right now.");

      return {
        year,
        byMonth,
        customerCount: customerCount ?? 0,
        revenue,
        profit,
        marginPct,
        openTickets: openTicketsCount,
        activeResources,
        topCustomers,
        keyAlerts,
        syncOverview,
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

  const syncHealthy =
    data.syncOverview.freshdesk.health.state === "ok" &&
    data.syncOverview.last_success?.status === "success";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SummaryKpi label="Total customers" value={fmtNumber(data.customerCount)} />
        <SummaryKpi label="Revenue" value={fmtCurrency(data.revenue)} />
        <SummaryKpi
          label="Profit and margin"
          value={fmtCurrency(data.profit)}
          sublabel={`${data.marginPct.toFixed(1)}% margin`}
        />
        <SummaryKpi label="Open tickets" value={fmtNumber(data.openTickets)} />
        <SummaryKpi label="Active resources" value={fmtNumber(data.activeResources)} />
        <SummaryKpi label="System health" value={syncHealthy ? "Healthy" : "At risk"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Revenue snapshot (FYTD)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data.byMonth}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis yAxisId="money" fontSize={12} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
                <YAxis yAxisId="margin" orientation="right" fontSize={12} tickFormatter={(value) => `${value}%`} />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === "Margin %") return [`${value.toFixed(1)}%`, name];
                    return [fmtCurrency(value), name];
                  }}
                />
                <Legend />
                <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="money" dataKey="cost" name="Input cost" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="margin" type="monotone" dataKey="marginPct" name="Margin %" stroke="var(--chart-3)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Key alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.keyAlerts.map((item) => (
              <div key={item} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Modules</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <ModuleLink title="Support tickets" to="/tickets" />
          <ModuleLink title="Public cloud" to="/public-cloud" />
          <ModuleLink title="Private cloud" to="/private-cloud" />
          <ModuleLink title="Agents" to="/ai-command-center/agents" />
          <ModuleLink title="AI Command Center" to="/ai-command-center" />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">System health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <HealthRow
              label="Freshdesk ticket sync"
              status={data.syncOverview.freshdesk.health.state === "ok" ? "Healthy" : "Attention"}
              detail={data.syncOverview.freshdesk.health.message}
            />
            <HealthRow
              label="Snapshot pipeline"
              status={data.syncOverview.last_success?.status === "success" ? "Healthy" : "Attention"}
              detail={
                data.syncOverview.last_success
                  ? `Last successful snapshot at ${new Date(data.syncOverview.last_success.started_at).toLocaleString()}`
                  : "No successful snapshot run yet."
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topCustomers.map((customer) => (
              <Link
                key={customer.name}
                to="/customers"
                search={{ q: customer.name, status: "all" }}
                className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm">{customer.name}</div>
                  <Badge variant="outline">{fmtNumber(customer.users)} users</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Revenue {fmtCurrency(customer.revenue)} · Profit {fmtCurrency(customer.profit)}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryKpi({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {sublabel && <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}

function ModuleLink({ title, to }: { title: string; to: string }) {
  return (
    <Link to={to as never} className="rounded-md border border-border p-3 hover:bg-muted/30">
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">Open summary →</div>
    </Link>
  );
}

function HealthRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  const healthy = status === "Healthy";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{label}</div>
        <Badge variant={healthy ? "default" : "secondary"} className="gap-1">
          {healthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {status}
        </Badge>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
