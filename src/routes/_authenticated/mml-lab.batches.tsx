import { createFileRoute } from "@tanstack/react-router";
import { CloudTypeBadge } from "@/components/cloud/cloud-type-badge";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { requireRouteRoles } from "@/lib/route-guard";
import { fmtCurrency } from "@/lib/format";
import { effectiveCost } from "@/lib/cost-calculator";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FilterBar, FilterSelect, FilterSummary } from "@/components/filter-bar";
import { TableStateRow } from "@/components/data-table-parts";

export const Route = createFileRoute("/_authenticated/mml-lab/batches")({
  head: () => pageHead("/mml-lab/batches"),
  beforeLoad: requireRouteRoles("/mml-lab/batches"),
  component: BatchesPage,
});

type Batch = {
  id: string;
  batch_code: string;
  name: string | null;
  lab_type: string | null;
  status: string;
  revenue_total: number | null;
  estimated_cost_total: number | null;
  actual_cost_total: number | null;
  known_line_count: number | null;
  auto_line_count: number | null;
  flags: string[];
  closed_at: string | null;
  currency: string;
};

/** Status filter choices (unchanged set; were a button group, now a FilterSelect). */
const STATUS_FILTERS = [
  { value: "open", label: "Open" },
  { value: "closed_estimated", label: "Closed-estimated" },
  { value: "closed_actual", label: "Closed-actual" },
  { value: "overdue", label: "Overdue invoice" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed_estimated: "Closed-estimated",
  closed_actual: "Closed-actual",
};

const FLAG_LABEL: Record<string, string> = {
  overdue_invoice: "Overdue invoice",
};

function BatchesPage() {
  const { hasAnyRole } = useAuth();
  const canClose = hasAnyRole(["admin", "ops_lead"]);
  const canCreate = hasAnyRole(["admin", "ops_lead", "ops_user"]);
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [cloud, setCloud] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  // SCRUM-129: no default cloud type; the user must choose.
  const [labType, setLabType] = useState("");
  const [invoice, setInvoice] = useState({
    vendor: "",
    ref: "",
    date: "",
    currency: "INR",
    amount: "",
    fx: "",
    source: "vendor_invoice",
  });

  const {
    data: batches = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["lab-batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lab_batches").select("*").order("batch_code");
      if (error) throw error;
      return (data ?? []) as Batch[];
    },
  });

  const visible = batches.filter((b) => {
    if (cloud !== "all" && b.lab_type !== cloud) return false;
    if (tab === "overdue") return (b.flags ?? []).includes("overdue_invoice");
    if (tab === "all") return true;
    return b.status === tab;
  });
  const current = batches.find((b) => b.id === selected) ?? visible[0] ?? null;

  const {
    data: lines = [],
    isLoading: linesLoading,
    isError: linesError,
  } = useQuery({
    queryKey: ["lab-batch-lines", current?.id],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, potential_id, lab_name, lab_type, total_users, selling_cost, input_cost, input_cost_auto, input_cost_actual_alloc, is_deleted",
        )
        .eq("lab_batch_id", current!.id)
        .eq("is_deleted", false);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["lab-batch-invoices", current?.id],
    enabled: !!current && canClose,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_batch_invoices")
        .select("*")
        .eq("lab_batch_id", current!.id)
        .order("created_at");
      if (error) return [];
      return data ?? [];
    },
  });

  async function createBatch() {
    if (!labType) {
      toast.error("Choose Private cloud or Public cloud");
      return;
    }
    const { error } = await supabase
      .from("lab_batches")
      .insert({ name: name || null, lab_type: labType, batch_code: "" });
    if (error) toast.error(error.message);
    else {
      toast.success("Batch created");
      setName("");
      qc.invalidateQueries({ queryKey: ["lab-batches"] });
    }
  }

  async function call(
    fn: "close_lab_batch" | "reopen_lab_batch" | "request_lab_batch_recompute",
    id: string,
  ) {
    const { error } = await supabase.rpc(fn, { p_batch_id: id });
    if (error) toast.error(error.message);
    else {
      toast.success("Batch updated");
      qc.invalidateQueries({ queryKey: ["lab-batches"] });
      qc.invalidateQueries({ queryKey: ["lab-batch-lines"] });
    }
  }

  async function recordInvoice() {
    if (!current) return;
    const { error } = await supabase.rpc("record_lab_batch_invoice", {
      p_batch_id: current.id,
      p_vendor: invoice.vendor,
      p_invoice_ref: invoice.ref,
      p_invoice_date: invoice.date || new Date().toISOString().slice(0, 10),
      p_currency: invoice.currency,
      p_amount: Number(invoice.amount),
      p_fx: invoice.currency === "USD" ? Number(invoice.fx) : null,
      p_source: invoice.source,
      p_note: null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Invoice recorded. Profit now uses the actual cost.");
      qc.invalidateQueries({ queryKey: ["lab-batches"] });
      qc.invalidateQueries({ queryKey: ["lab-batch-lines"] });
      qc.invalidateQueries({ queryKey: ["lab-batch-invoices"] });
    }
  }

  const profitEst =
    current && current.revenue_total != null && current.estimated_cost_total != null
      ? Number(current.revenue_total) - Number(current.estimated_cost_total)
      : null;
  const profitAct =
    current && current.revenue_total != null && current.actual_cost_total != null
      ? Number(current.revenue_total) - Number(current.actual_cost_total)
      : null;

  return (
    <AppShell {...pageShell("/mml-lab/batches")}>
      {/* #29: cloud type as Tabs and the existing status choices in one FilterBar. */}
      <FilterBar
        summary={
          <FilterSummary
            items={[{ label: "Showing", value: `${visible.length} of ${batches.length}` }]}
          />
        }
      >
        <Tabs value={cloud} onValueChange={setCloud}>
          <TabsList aria-label="Cloud type">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="private_cloud">Private cloud</TabsTrigger>
            <TabsTrigger value="public_cloud">Public cloud</TabsTrigger>
          </TabsList>
        </Tabs>
        <FilterSelect
          label="Status"
          value={tab}
          onValueChange={setTab}
          allLabel="All statuses"
          options={STATUS_FILTERS}
        />
      </FilterBar>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Batches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canCreate && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="Batch name"
                  aria-label="Batch name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Select value={labType || undefined} onValueChange={setLabType}>
                  <SelectTrigger
                    className="w-full sm:w-40"
                    aria-label="Cloud type"
                    aria-invalid={!labType}
                  >
                    <SelectValue placeholder="Cloud type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private_cloud">Private cloud</SelectItem>
                    <SelectItem value="public_cloud">Public cloud</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={createBatch} disabled={!labType} className="shrink-0">
                  New batch
                </Button>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableStateRow colSpan={4}>Loading batches…</TableStateRow>
                ) : isError ? (
                  <TableStateRow colSpan={4} onRetry={() => refetch()}>
                    Could not load the lab batches.
                  </TableStateRow>
                ) : (
                  visible.length === 0 && (
                    <TableStateRow colSpan={4}>No batches match.</TableStateRow>
                  )
                )}
                {visible.map((b) => {
                  const profit =
                    b.actual_cost_total != null && b.revenue_total != null
                      ? Number(b.revenue_total) - Number(b.actual_cost_total)
                      : b.estimated_cost_total != null && b.revenue_total != null
                        ? Number(b.revenue_total) - Number(b.estimated_cost_total)
                        : null;
                  return (
                    <TableRow
                      key={b.id}
                      data-testid={`batch-${b.batch_code}`}
                      className={cn("cursor-pointer", current?.id === b.id && "bg-muted/50")}
                      aria-selected={current?.id === b.id}
                      onClick={() => setSelected(b.id)}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => setSelected(b.id)}
                        >
                          {b.batch_code}
                        </button>
                        <div className="text-xs text-muted-foreground">{b.name}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="whitespace-nowrap">
                          {STATUS_LABEL[b.status] ?? b.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(b.flags ?? []).map((f) => (
                            <Badge
                              key={f}
                              variant={f === "overdue_invoice" ? "warning" : "secondary"}
                              className="whitespace-nowrap"
                            >
                              {FLAG_LABEL[f] ?? f}
                            </Badge>
                          ))}
                          {(b.auto_line_count ?? 0) > 0 && (
                            <Badge variant="outline" className="whitespace-nowrap tabular-nums">
                              Auto (avg) × {b.auto_line_count}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {profit == null ? "—" : fmtCurrency(profit)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {current && (
          <Card data-testid="batch-detail" className="min-w-0">
            <CardHeader>
              <CardTitle className="text-sm">{current.batch_code}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {current.name && <span>{current.name}</span>}
                <CloudTypeBadge value={current.lab_type} />
                <Badge variant="outline" className="whitespace-nowrap">
                  {STATUS_LABEL[current.status] ?? current.status}
                </Badge>
              </div>
              <div className="tabular-nums">Revenue {fmtCurrency(current.revenue_total)}</div>
              <div className="tabular-nums">
                Estimated cost {fmtCurrency(current.estimated_cost_total)} · profit{" "}
                {profitEst == null ? "—" : fmtCurrency(profitEst)}{" "}
                <Badge variant="secondary">estimated</Badge>
              </div>
              <div className="tabular-nums">
                Actual cost{" "}
                {current.actual_cost_total == null ? "—" : fmtCurrency(current.actual_cost_total)} ·
                profit {profitAct == null ? "cost unknown" : fmtCurrency(profitAct)}{" "}
                {current.actual_cost_total != null && <Badge variant="success">actual</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">
                Known lines {current.known_line_count ?? 0}. Auto-filled{" "}
                {current.auto_line_count ?? 0}. Basis on each line is actual, then entered, then
                auto-filled.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linesLoading ? (
                    <TableStateRow colSpan={3}>Loading lines…</TableStateRow>
                  ) : linesError ? (
                    <TableStateRow colSpan={3}>Could not load the batch lines.</TableStateRow>
                  ) : (
                    lines.length === 0 && (
                      <TableStateRow colSpan={3}>No lines in this batch.</TableStateRow>
                    )
                  )}
                  {lines.map((line) => {
                    const eff = effectiveCost(line);
                    return (
                      <TableRow key={line.id}>
                        <TableCell>{line.lab_name ?? line.potential_id}</TableCell>
                        <TableCell>
                          {eff.basis === "auto_avg" && <Badge variant="outline">Auto (avg)</Badge>}
                          {eff.basis === "actual" && <Badge variant="success">Actual</Badge>}
                          {eff.basis === "entered" && <Badge variant="secondary">Entered</Badge>}
                          {eff.basis === "none" && <Badge variant="outline">Cost unknown</Badge>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {eff.amount == null ? "—" : fmtCurrency(eff.amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {canClose && (
                <div className="flex flex-wrap gap-2">
                  {current.status === "open" && (
                    <Button size="sm" onClick={() => call("close_lab_batch", current.id)}>
                      Close batch
                    </Button>
                  )}
                  {current.status !== "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => call("reopen_lab_batch", current.id)}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => call("request_lab_batch_recompute", current.id)}
                  >
                    Recompute now
                  </Button>
                </div>
              )}
              {canClose && (
                <div className="grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-2">
                  <div className="font-medium sm:col-span-2">
                    Record invoice or overall batch cost
                  </div>
                  <Input
                    placeholder="Vendor"
                    aria-label="Vendor"
                    value={invoice.vendor}
                    onChange={(e) => setInvoice({ ...invoice, vendor: e.target.value })}
                  />
                  <Input
                    placeholder="Reference"
                    aria-label="Reference"
                    value={invoice.ref}
                    onChange={(e) => setInvoice({ ...invoice, ref: e.target.value })}
                  />
                  <Input
                    type="date"
                    aria-label="Invoice date"
                    value={invoice.date}
                    onChange={(e) => setInvoice({ ...invoice, date: e.target.value })}
                  />
                  <Select
                    value={invoice.currency}
                    onValueChange={(v) => setInvoice({ ...invoice, currency: v })}
                  >
                    <SelectTrigger aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Amount"
                    aria-label="Amount"
                    value={invoice.amount}
                    onChange={(e) => setInvoice({ ...invoice, amount: e.target.value })}
                  />
                  {invoice.currency === "USD" && (
                    <Input
                      placeholder="FX to INR"
                      aria-label="FX to INR"
                      value={invoice.fx}
                      onChange={(e) => setInvoice({ ...invoice, fx: e.target.value })}
                    />
                  )}
                  <Select
                    value={invoice.source}
                    onValueChange={(v) => setInvoice({ ...invoice, source: v })}
                  >
                    <SelectTrigger aria-label="Cost source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vendor_invoice">Vendor invoice</SelectItem>
                      <SelectItem value="manual_overall_cost">Overall batch cost</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={recordInvoice}>
                    Record
                  </Button>
                  {invoices
                    .filter((i) => i.status === "active")
                    .map((i) => (
                      <div key={i.id} className="text-xs tabular-nums sm:col-span-2">
                        {i.vendor} {i.currency} {i.amount} → {fmtCurrency(i.amount_inr)} ({i.source}
                        )
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
