import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/mml-lab/batches")({
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

function BatchesPage() {
  const { hasAnyRole } = useAuth();
  const canClose = hasAnyRole(["admin", "ops_lead"]);
  const canCreate = hasAnyRole(["admin", "ops_lead", "ops_user"]);
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [labType, setLabType] = useState("public_cloud");
  const [invoice, setInvoice] = useState({
    vendor: "",
    ref: "",
    date: "",
    currency: "INR",
    amount: "",
    fx: "",
    source: "vendor_invoice",
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["lab-batches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lab_batches").select("*").order("batch_code");
      if (error) throw error;
      return (data ?? []) as Batch[];
    },
  });

  const visible = batches.filter((b) => {
    if (tab === "overdue") return (b.flags ?? []).includes("overdue_invoice");
    if (tab === "all") return true;
    return b.status === tab;
  });
  const current = batches.find((b) => b.id === selected) ?? visible[0] ?? null;

  const { data: lines = [] } = useQuery({
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
    <AppShell title="Lab batches">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All"],
            ["open", "Open"],
            ["closed_estimated", "Closed-estimated"],
            ["closed_actual", "Closed-actual"],
            ["overdue", "Overdue invoice"],
          ].map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? "default" : "outline"}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Batches</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canCreate && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Batch name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Select value={labType} onValueChange={setLabType}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public_cloud">Public</SelectItem>
                      <SelectItem value="private_cloud">Private</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={createBatch}>New batch</Button>
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
                        className={current?.id === b.id ? "bg-muted/50" : ""}
                        onClick={() => setSelected(b.id)}
                      >
                        <TableCell>
                          <div className="font-medium">{b.batch_code}</div>
                          <div className="text-xs text-muted-foreground">{b.name}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{b.status}</Badge>
                        </TableCell>
                        <TableCell className="space-x-1">
                          {(b.flags ?? []).map((f) => (
                            <Badge
                              key={f}
                              variant={f === "overdue_invoice" ? "destructive" : "secondary"}
                            >
                              {f}
                            </Badge>
                          ))}
                          {(b.auto_line_count ?? 0) > 0 && (
                            <Badge variant="outline">Auto (avg) × {b.auto_line_count}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
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
            <Card data-testid="batch-detail">
              <CardHeader>
                <CardTitle>{current.batch_code}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  {current.name} · {current.lab_type} · {current.status}
                </div>
                <div>Revenue {fmtCurrency(current.revenue_total)}</div>
                <div>
                  Estimated cost {fmtCurrency(current.estimated_cost_total)} · profit{" "}
                  {profitEst == null ? "—" : fmtCurrency(profitEst)}{" "}
                  <Badge variant="secondary">estimated</Badge>
                </div>
                <div>
                  Actual cost{" "}
                  {current.actual_cost_total == null ? "—" : fmtCurrency(current.actual_cost_total)}{" "}
                  · profit {profitAct == null ? "cost unknown" : fmtCurrency(profitAct)}{" "}
                  {current.actual_cost_total != null && <Badge>actual</Badge>}
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
                    {lines.map((line) => {
                      const eff = effectiveCost(line);
                      return (
                        <TableRow key={line.id}>
                          <TableCell>{line.lab_name ?? line.potential_id}</TableCell>
                          <TableCell>
                            {eff.basis === "auto_avg" && (
                              <Badge variant="outline">Auto (avg)</Badge>
                            )}
                            {eff.basis === "actual" && <Badge>Actual</Badge>}
                            {eff.basis === "entered" && <Badge variant="secondary">Entered</Badge>}
                            {eff.basis === "none" && <Badge variant="outline">Cost unknown</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
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
                  <div className="grid grid-cols-2 gap-2 border-t pt-3">
                    <div className="col-span-2 font-medium">
                      Record invoice or overall batch cost
                    </div>
                    <Input
                      placeholder="Vendor"
                      value={invoice.vendor}
                      onChange={(e) => setInvoice({ ...invoice, vendor: e.target.value })}
                    />
                    <Input
                      placeholder="Reference"
                      value={invoice.ref}
                      onChange={(e) => setInvoice({ ...invoice, ref: e.target.value })}
                    />
                    <Input
                      type="date"
                      value={invoice.date}
                      onChange={(e) => setInvoice({ ...invoice, date: e.target.value })}
                    />
                    <Select
                      value={invoice.currency}
                      onValueChange={(v) => setInvoice({ ...invoice, currency: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INR">INR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Amount"
                      value={invoice.amount}
                      onChange={(e) => setInvoice({ ...invoice, amount: e.target.value })}
                    />
                    {invoice.currency === "USD" && (
                      <Input
                        placeholder="FX to INR"
                        value={invoice.fx}
                        onChange={(e) => setInvoice({ ...invoice, fx: e.target.value })}
                      />
                    )}
                    <Select
                      value={invoice.source}
                      onValueChange={(v) => setInvoice({ ...invoice, source: v })}
                    >
                      <SelectTrigger>
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
                        <div key={i.id} className="col-span-2 text-xs">
                          {i.vendor} {i.currency} {i.amount} → {fmtCurrency(i.amount_inr)} (
                          {i.source})
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
