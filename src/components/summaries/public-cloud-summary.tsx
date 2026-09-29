import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  ComposedChart,
  Cell,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { fmtCurrency, fmtNumber, MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { readAllRows } from "@/lib/read-all";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

type PublicCloudRow = {
  id: string;
  potential_id: string | null;
  customer_name: string | null;
  lab_name: string | null;
  cloud_provider: string | null;
  line_of_business: string | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_auto: number | null;
  input_cost_actual_alloc: number | null;
  total_users: number | null;
  start_date: string | null;
  end_date: string | null;
  public_credit_allocated: number | null;
  public_actual_consumption: number | null;
  public_unused_credit: number | null;
  month: number | null;
  year: number | null;
};

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const EXAMPLE_ROWS: PublicCloudRow[] = [
  { id: "tx-1", potential_id: "DEMO-PUB-001", customer_name: "Cognizant", lab_name: "DevOps Pro", cloud_provider: "Azure", line_of_business: "VILT", selling_cost: 67600, input_cost: 48200, input_cost_auto: null, input_cost_actual_alloc: 46850, total_users: 42, start_date: "2026-09-01", end_date: "2026-09-28", public_credit_allocated: 52000, public_actual_consumption: 46850, public_unused_credit: 5150, month: 9, year: 2026 },
  { id: "tx-2", potential_id: "DEMO-PUB-002", customer_name: "Infosys", lab_name: "Data Engineering", cloud_provider: "AWS", line_of_business: "Standalone", selling_cost: 57500, input_cost: 39100, input_cost_auto: null, input_cost_actual_alloc: 38920, total_users: 30, start_date: "2026-09-03", end_date: "2026-09-26", public_credit_allocated: 43000, public_actual_consumption: 38920, public_unused_credit: 4080, month: 9, year: 2026 },
  { id: "tx-3", potential_id: "DEMO-PUB-003", customer_name: "TCS", lab_name: "AI Foundations", cloud_provider: "Azure", line_of_business: "VILT", selling_cost: 96500, input_cost: 73400, input_cost_auto: null, input_cost_actual_alloc: 72130, total_users: 55, start_date: "2026-09-05", end_date: "2026-09-30", public_credit_allocated: 76000, public_actual_consumption: 72130, public_unused_credit: 3870, month: 9, year: 2026 },
  { id: "tx-4", potential_id: "DEMO-PUB-004", customer_name: "Wipro", lab_name: "Kubernetes Ops", cloud_provider: "GCP", line_of_business: "Standalone", selling_cost: 44600, input_cost: 28800, input_cost_auto: null, input_cost_actual_alloc: 28240, total_users: 24, start_date: "2026-08-02", end_date: "2026-08-22", public_credit_allocated: 31500, public_actual_consumption: 28240, public_unused_credit: 3260, month: 8, year: 2026 },
  { id: "tx-5", potential_id: "DEMO-PUB-005", customer_name: "Capgemini", lab_name: "Platform SRE", cloud_provider: "Azure", line_of_business: "Integrated", selling_cost: 35200, input_cost: 22900, input_cost_auto: null, input_cost_actual_alloc: 21980, total_users: 20, start_date: "2026-08-10", end_date: "2026-08-27", public_credit_allocated: 25000, public_actual_consumption: 21980, public_unused_credit: 3020, month: 8, year: 2026 },
];

function lineCost(
  row: Pick<PublicCloudRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">,
): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

export function PublicCloudSummary() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const { data, isLoading, isError, error } = useQuery({
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
      const now = new Date();
      const nowTs = now.getTime();
      const nextWeekTs = nowTs + 7 * 24 * 60 * 60 * 1000;
      const revenue = rows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
      const inputCost = rows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
      const profit = revenue - inputCost;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
      const runningNow = rows.filter((row) => {
        if (!row.start_date || !row.end_date) return false;
        const start = new Date(row.start_date).getTime();
        const end = new Date(row.end_date).getTime();
        return start <= nowTs && end >= nowTs;
      }).length;
      const endingSoon = rows.filter((row) => {
        if (!row.end_date) return false;
        const end = new Date(row.end_date).getTime();
        return end >= nowTs && end <= nextWeekTs;
      }).length;
      const creditUsed = rows.reduce((sum, row) => addNullable(sum, row.public_actual_consumption), 0);

      const byMonth = Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const monthRows = rows.filter((row) => row.month === month && row.year === now.getFullYear());
        const monthRevenue = monthRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
        const monthCost = monthRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
        return { month: MONTH_NAMES[idx].slice(0, 3), revenue: monthRevenue, cost: monthCost };
      });

      const providerRevenueMap = new Map<string, number>();
      const providerCreditMap = new Map<string, { used: number; allocated: number }>();
      const lobMap = new Map<string, number>();
      const statusMap = new Map<string, number>();
      const customerMap = new Map<string, number>();
      for (const row of rows) {
        const provider = row.cloud_provider ?? "Unknown";
        providerRevenueMap.set(provider, addNullable(providerRevenueMap.get(provider) ?? 0, row.selling_cost));
        const creditStats = providerCreditMap.get(provider) ?? { used: 0, allocated: 0 };
        creditStats.used = addNullable(creditStats.used, row.public_actual_consumption);
        creditStats.allocated = addNullable(creditStats.allocated, row.public_credit_allocated);
        providerCreditMap.set(provider, creditStats);

        const lob = row.line_of_business ?? "Unknown";
        lobMap.set(lob, (lobMap.get(lob) ?? 0) + 1);

        const customer = row.customer_name ?? "Unknown";
        customerMap.set(customer, addNullable(customerMap.get(customer) ?? 0, row.selling_cost));

        const start = row.start_date ? new Date(row.start_date).getTime() : null;
        const end = row.end_date ? new Date(row.end_date).getTime() : null;
        const status =
          start == null || end == null
            ? "Unscheduled"
            : start > nowTs
              ? "Upcoming"
              : end < nowTs
                ? "Completed"
                : "Running";
        statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
      }

      return {
        rows,
        revenue,
        inputCost,
        profit,
        marginPct,
        runningNow,
        endingSoon,
        creditUsed,
        byMonth,
        providerRevenue: [...providerRevenueMap.entries()].map(([name, value]) => ({ name, value })),
        providerCredit: [...providerCreditMap.entries()].map(([name, value]) => ({
          name,
          used: value.used,
          allocated: value.allocated,
          utilizationPct: value.allocated > 0 ? Number(((value.used / value.allocated) * 100).toFixed(1)) : 0,
        })),
        lobSplit: [...lobMap.entries()].map(([name, value]) => ({ name, value })),
        statusSplit: [...statusMap.entries()].map(([name, value]) => ({ name, value })),
        topCustomers: [...customerMap.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5),
        recent: rows.slice(-8).reverse(),
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading public cloud summary…</CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load Public cloud summary</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
        <SummaryKpi label="Revenue" value={fmtCurrency(data.revenue)} />
        <SummaryKpi label="Input cost" value={fmtCurrency(data.inputCost)} />
        <SummaryKpi label="Profit" value={fmtCurrency(data.profit)} />
        <SummaryKpi label="Margin" value={`${data.marginPct.toFixed(1)}%`} />
        <SummaryKpi label="Lines" value={fmtNumber(data.rows.length)} />
        <SummaryKpi label="Running now" value={fmtNumber(data.runningNow)} />
        <SummaryKpi label="Ending in next 7 days" value={fmtNumber(data.endingSoon)} />
        <SummaryKpi label="Credit used" value={fmtCurrency(data.creditUsed)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Cost overview by month">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data.byMonth}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
              <Tooltip formatter={(value: number) => fmtCurrency(value)} />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Line dataKey="cost" name="Input cost" stroke="var(--chart-3)" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue by cloud provider">
          <ResponsiveContainer width="100%" height={250}>
            <BarChartSafe data={data.providerRevenue} dataKey="value" xDataKey="name" />
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Line of business split">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data.lobSplit} dataKey="value" nameKey="name" outerRadius={85} label>
                {data.lobSplit.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Lab status">
          <ResponsiveContainer width="100%" height={250}>
            <BarChartSafe data={data.statusSplit} dataKey="value" xDataKey="name" />
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Credit utilisation by provider">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data.providerCredit}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis yAxisId="money" fontSize={12} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
              <YAxis yAxisId="pct" orientation="right" fontSize={12} tickFormatter={(value) => `${value}%`} />
              <Tooltip formatter={(value: number, key) => (String(key).includes("Pct") ? `${value}%` : fmtCurrency(value))} />
              <Legend />
              <Bar yAxisId="money" dataKey="allocated" name="Allocated credit" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="money" dataKey="used" name="Used credit" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Line yAxisId="pct" dataKey="utilizationPct" name="Utilization %" stroke="var(--chart-4)" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top public cloud customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topCustomers.map((customer) => (
              <Link
                key={customer.name}
                to="/customers"
                search={{ q: customer.name, status: "all" }}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-muted/30"
              >
                <span className="text-sm font-medium">{customer.name}</span>
                <Badge variant="outline">{fmtCurrency(customer.value)}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent lab transactions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.recent.map((row) => (
            <Link
              key={row.id}
              to="/transactions"
              search={{ q: row.potential_id ?? row.customer_name ?? "" } as never}
              className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{row.potential_id ?? row.lab_name ?? row.id}</div>
                <Badge variant="outline">{row.cloud_provider ?? "Unknown"}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {row.customer_name ?? "Unknown customer"} · Revenue {fmtCurrency(row.selling_cost)} · Cost{" "}
                {fmtCurrency(lineCost(row))}
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryKpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function BarChartSafe({
  data,
  dataKey,
  xDataKey,
}: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  xDataKey: string;
}) {
  return (
    <ComposedChart data={data}>
      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
      <XAxis dataKey={xDataKey} fontSize={12} />
      <YAxis fontSize={12} allowDecimals={false} />
      <Tooltip />
      <Bar dataKey={dataKey} fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
    </ComposedChart>
  );
}
