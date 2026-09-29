import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Line,
} from "recharts";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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

type BatchRow = {
  id: string;
  batch_code: string;
  name: string | null;
  status: string;
  revenue_total: number | null;
  estimated_cost_total: number | null;
  actual_cost_total: number | null;
  flags: string[] | null;
  needs_recompute: boolean;
  updated_at: string;
};

type TxRow = {
  id: string;
  lab_batch_id: string | null;
  customer_name: string | null;
  month: number | null;
  year: number | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_auto: number | null;
  input_cost_actual_alloc: number | null;
};

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const EXAMPLE_BATCHES: BatchRow[] = [
  { id: "pb-1", batch_code: "LB-PRIV-0929-A", name: "Azure FinOps Cohort", status: "open", revenue_total: 285000, estimated_cost_total: 169500, actual_cost_total: 162300, flags: ["cost_locked"], needs_recompute: false, updated_at: "2026-09-29T05:28:00Z" },
  { id: "pb-2", batch_code: "LB-PRIV-0929-B", name: "Cloud Security Bootcamp", status: "closed_actual", revenue_total: 212000, estimated_cost_total: 132400, actual_cost_total: 128000, flags: [], needs_recompute: false, updated_at: "2026-09-28T15:20:00Z" },
  { id: "pb-3", batch_code: "LB-PRIV-0929-C", name: "Data Platform Residency", status: "open", revenue_total: 196000, estimated_cost_total: 118000, actual_cost_total: 112200, flags: [], needs_recompute: true, updated_at: "2026-09-27T11:45:00Z" },
];

const EXAMPLE_TRANSACTIONS: TxRow[] = [
  { id: "t1", lab_batch_id: "pb-1", customer_name: "Cognizant", month: 9, year: 2026, selling_cost: 98000, input_cost: 60000, input_cost_auto: null, input_cost_actual_alloc: 58200 },
  { id: "t2", lab_batch_id: "pb-1", customer_name: "Infosys", month: 9, year: 2026, selling_cost: 93000, input_cost: 51000, input_cost_auto: null, input_cost_actual_alloc: 47200 },
  { id: "t3", lab_batch_id: "pb-1", customer_name: "TCS", month: 9, year: 2026, selling_cost: 94000, input_cost: 57500, input_cost_auto: null, input_cost_actual_alloc: 56900 },
  { id: "t4", lab_batch_id: "pb-2", customer_name: "Wipro", month: 8, year: 2026, selling_cost: 106000, input_cost: 65000, input_cost_auto: null, input_cost_actual_alloc: 64200 },
  { id: "t5", lab_batch_id: "pb-2", customer_name: "HCL", month: 8, year: 2026, selling_cost: 106000, input_cost: 64000, input_cost_auto: null, input_cost_actual_alloc: 63800 },
  { id: "t6", lab_batch_id: "pb-3", customer_name: "Accenture", month: 7, year: 2026, selling_cost: 98000, input_cost: 56000, input_cost_auto: null, input_cost_actual_alloc: 55300 },
  { id: "t7", lab_batch_id: "pb-3", customer_name: "Capgemini", month: 7, year: 2026, selling_cost: 98000, input_cost: 57000, input_cost_auto: null, input_cost_actual_alloc: 56900 },
];

function lineCost(row: Pick<TxRow, "input_cost_actual_alloc" | "input_cost" | "input_cost_auto">): number {
  return row.input_cost_actual_alloc ?? row.input_cost ?? row.input_cost_auto ?? 0;
}

export function PrivateCloudSummary() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["private-cloud-summary-v1"],
    queryFn: async () => {
      const batches = isExampleCaptureMode
        ? EXAMPLE_BATCHES
        : ((await supabase
            .from("lab_batches")
            .select(
              "id,batch_code,name,status,revenue_total,estimated_cost_total,actual_cost_total,flags,needs_recompute,updated_at",
            )
            .eq("lab_type", "private_cloud")
            .order("batch_code")).data ?? []) as BatchRow[];
      const batchIds = batches.map((batch) => batch.id);
      const tx = isExampleCaptureMode
        ? EXAMPLE_TRANSACTIONS
        : batchIds.length === 0
          ? []
          : await readAllRows(
              () =>
                supabase
                  .from("transactions")
                  .select(
                    "id,lab_batch_id,customer_name,month,year,selling_cost,input_cost,input_cost_auto,input_cost_actual_alloc,is_deleted,repository_type",
                  )
                  .eq("repository_type", "private_cloud")
                  .eq("is_deleted", false)
                  .in("lab_batch_id", batchIds)
                  .order("id"),
              "Private cloud summary transactions",
            );
      const now = new Date();
      const year = now.getFullYear();
      const revenue = batches.reduce((sum, row) => addNullable(sum, row.revenue_total), 0);
      const actualCost = batches.reduce((sum, row) => addNullable(sum, row.actual_cost_total), 0);
      const estimatedCost = batches.reduce((sum, row) => addNullable(sum, row.estimated_cost_total), 0);
      const profit = revenue - actualCost;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;

      const byMonth = Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const monthRows = tx.filter((row) => row.year === year && row.month === month);
        const monthRevenue = monthRows.reduce((sum, row) => addNullable(sum, row.selling_cost), 0);
        const monthCost = monthRows.reduce((sum, row) => addNullable(sum, lineCost(row)), 0);
        const monthMargin = monthRevenue > 0 ? ((monthRevenue - monthCost) / monthRevenue) * 100 : 0;
        return {
          month: MONTH_NAMES[idx].slice(0, 3),
          revenue: monthRevenue,
          cost: monthCost,
          marginPct: Number(monthMargin.toFixed(1)),
        };
      });

      const statusMap = new Map<string, number>();
      for (const batch of batches) {
        statusMap.set(batch.status, (statusMap.get(batch.status) ?? 0) + 1);
      }

      const byBatchLineActual = new Map<string, number>();
      for (const row of tx) {
        if (!row.lab_batch_id) continue;
        byBatchLineActual.set(
          row.lab_batch_id,
          addNullable(byBatchLineActual.get(row.lab_batch_id) ?? 0, row.input_cost_actual_alloc),
        );
      }
      const reconciliation = batches.map((batch) => {
        const lineActual = byBatchLineActual.get(batch.id) ?? 0;
        const batchActual = Number(batch.actual_cost_total ?? 0);
        const batchEstimate = Number(batch.estimated_cost_total ?? 0);
        const diff = Math.abs(lineActual - batchActual);
        return {
          ...batch,
          lineActual,
          reconciled: diff < 0.01,
          batchActual,
          batchEstimate,
        };
      });

      const customerRevenue = new Map<string, number>();
      for (const row of tx) {
        const customer = row.customer_name ?? "Unknown";
        customerRevenue.set(customer, addNullable(customerRevenue.get(customer) ?? 0, row.selling_cost));
      }
      const topCustomers = [...customerRevenue.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      const locked = batches.filter((batch) => (batch.flags ?? []).some((flag) => flag.toLowerCase().includes("lock"))).length;
      const recomputePending = batches.filter((batch) => batch.needs_recompute).length;

      return {
        batches,
        tx,
        revenue,
        actualCost,
        estimatedCost,
        profit,
        marginPct,
        byMonth,
        statusSplit: [...statusMap.entries()].map(([name, value]) => ({ name, value })),
        reconciliation,
        topCustomers,
        locked,
        recomputePending,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading private cloud summary…</CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load Private cloud summary</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
        <SummaryKpi label="Batches" value={fmtNumber(data.batches.length)} />
        <SummaryKpi label="Revenue" value={fmtCurrency(data.revenue)} />
        <SummaryKpi label="Actual cost" value={fmtCurrency(data.actualCost)} />
        <SummaryKpi label="Estimated cost" value={fmtCurrency(data.estimatedCost)} />
        <SummaryKpi label="Profit" value={fmtCurrency(data.profit)} />
        <SummaryKpi label="Margin" value={`${data.marginPct.toFixed(1)}%`} />
        <SummaryKpi label="Cost locks" value={fmtNumber(data.locked)} />
        <SummaryKpi label="Recompute pending" value={fmtNumber(data.recomputePending)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Revenue and margin by month">
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data.byMonth}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis yAxisId="money" fontSize={12} tickFormatter={(value) => `${Math.round(value / 1000)}k`} />
              <YAxis yAxisId="margin" orientation="right" fontSize={12} tickFormatter={(value) => `${value}%`} />
              <Tooltip formatter={(value: number, name) => (String(name).includes("%") ? `${value}%` : fmtCurrency(value))} />
              <Legend />
              <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              <Line yAxisId="money" dataKey="cost" name="Cost" stroke="var(--chart-2)" strokeWidth={2} />
              <Line yAxisId="margin" dataKey="marginPct" name="Margin %" stroke="var(--chart-3)" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Batch status">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data.statusSplit} dataKey="value" nameKey="name" outerRadius={85} label>
                {data.statusSplit.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Reconciled costs (actual vs estimate)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.reconciliation.map((batch) => (
              <div key={batch.id} className="rounded-md border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {batch.batch_code} {batch.name ? `· ${batch.name}` : ""}
                  </div>
                  {batch.reconciled ? (
                    <Badge variant="default" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Reconciled ✓
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Review needed</Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Σ line actual costs = {fmtCurrency(batch.lineActual)} · batch actual cost ={" "}
                  {fmtCurrency(batch.batchActual)} · estimate = {fmtCurrency(batch.batchEstimate)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top customers by revenue</CardTitle>
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
          <CardTitle className="text-sm">Recent batches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.batches.slice(0, 8).map((batch) => (
            <Link
              key={batch.id}
              to="/mml-lab/batches"
              className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{batch.batch_code}</div>
                <Badge variant="outline">{batch.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Revenue {fmtCurrency(batch.revenue_total)} · Actual cost {fmtCurrency(batch.actual_cost_total)} ·
                Updated {new Date(batch.updated_at).toLocaleString()}
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
