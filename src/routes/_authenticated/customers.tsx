import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { exportToExcel } from "@/lib/export-xlsx";
import { Download, Search, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

function CustomersPage() {
  const { user, hasAnyRole } = useAuth();
  const canToggle = hasAnyRole(["admin", "ops_lead"]);
  const canEdit = hasAnyRole(["admin", "ops_lead"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["customers-summary"],
    queryFn: async () => {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, customer_name, is_active, account_manager_name, contact_email, contact_phone, industry, notes")
        .order("customer_name");
      const { data: tx } = await supabase
        .from("transactions")
        .select("customer_id, total_users, input_cost, selling_cost")
        .eq("is_deleted", false);
      const map = new Map<string, { count: number; users: number; revenue: number; cost: number }>();
      for (const t of tx ?? []) {
        const e = map.get(t.customer_id) ?? { count: 0, users: 0, revenue: 0, cost: 0 };
        e.count += 1;
        e.users += t.total_users ?? 0;
        e.revenue += Number(t.selling_cost ?? 0);
        e.cost += Number(t.input_cost ?? 0);
        map.set(t.customer_id, e);
      }
      return (customers ?? []).map((c) => {
        const m = map.get(c.id) ?? { count: 0, users: 0, revenue: 0, cost: 0 };
        const profit = m.revenue - m.cost;
        const margin = m.revenue > 0 ? (profit / m.revenue) * 100 : 0;
        return { ...c, ...m, profit, margin };
      });
    },
  });

  const filtered = rows.filter((r) => r.customer_name.toLowerCase().includes(search.toLowerCase()));

  async function toggle(id: string, current: boolean) {
    const { error } = await supabase.from("customers").update({ is_active: !current }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["customers-summary"] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  return (
    <AppShell title="Customers">
      <Card className="p-4 mb-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customers…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => exportToExcel("customers-summary", filtered.map((r) => ({
            Customer: r.customer_name,
            "Account Manager": r.account_manager_name ?? "",
            Industry: r.industry ?? "",
            "Contact Email": r.contact_email ?? "",
            "Contact Phone": r.contact_phone ?? "",
            Status: r.is_active ? "Active" : "Inactive",
            Transactions: r.count, "Total Users": r.users,
            "Total Revenue": r.revenue, "Total Input Cost": r.cost,
            "Total Profit": r.profit, "Margin %": Number(r.margin.toFixed(2)),
          })), { generatedBy: user?.email ?? "—", filters: { search } })}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Account Manager</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">Total Users</TableHead>
              <TableHead className="text-right">Total Revenue</TableHead>
              <TableHead className="text-right">Input Cost</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              {canToggle && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <div>{r.customer_name}</div>
                  {r.industry && <div className="text-xs text-muted-foreground">{r.industry}</div>}
                </TableCell>
                <TableCell className="text-sm">{r.account_manager_name || <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-xs">
                  {r.contact_email && <div>{r.contact_email}</div>}
                  {r.contact_phone && <div className="text-muted-foreground">{r.contact_phone}</div>}
                  {!r.contact_email && !r.contact_phone && <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right">{fmtNumber(r.count)}</TableCell>
                <TableCell className="text-right">{fmtNumber(r.users)}</TableCell>
                <TableCell className="text-right">{fmtCurrency(r.revenue)}</TableCell>
                <TableCell className="text-right">{fmtCurrency(r.cost)}</TableCell>
                <TableCell className={`text-right ${r.profit < 0 ? "text-destructive" : ""}`}>{fmtCurrency(r.profit)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.revenue > 0 ? `${r.margin.toFixed(1)}%` : "—"}</TableCell>
                {canToggle && (
                  <TableCell className="text-right whitespace-nowrap">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => toggle(r.id, r.is_active)}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No customers found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </Card>
      <EditCustomerDialog
        customer={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ["customers-summary"] });
          qc.invalidateQueries({ queryKey: ["customers"] });
        }}
      />
    </AppShell>
  );
}

type CustomerRow = {
  id: string;
  customer_name: string;
  is_active: boolean;
  account_manager_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  notes: string | null;
  count: number;
  users: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

function EditCustomerDialog({
  customer, onClose, onSaved,
}: { customer: CustomerRow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    customer_name: "",
    account_manager_name: "",
    contact_email: "",
    contact_phone: "",
    industry: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setForm({
        customer_name: customer.customer_name,
        account_manager_name: customer.account_manager_name ?? "",
        contact_email: customer.contact_email ?? "",
        contact_phone: customer.contact_phone ?? "",
        industry: customer.industry ?? "",
        notes: customer.notes ?? "",
      });
    }
  }, [customer]);

  async function save() {
    if (!customer) return;
    const name = form.customer_name.trim();
    if (!name) return toast.error("Customer name is required");
    if (form.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())) {
      return toast.error("Enter a valid contact email");
    }
    setSaving(true);
    const { error } = await supabase.from("customers").update({
      customer_name: name,
      account_manager_name: form.account_manager_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      industry: form.industry.trim() || null,
      notes: form.notes.trim() || null,
    }).eq("id", customer.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Customer details saved");
    onSaved();
  }

  return (
    <Dialog open={!!customer} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit customer details</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label>Customer name *</Label>
            <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Account Manager</Label>
            <Input value={form.account_manager_name} onChange={(e) => setForm({ ...form, account_manager_name: e.target.value })} placeholder="e.g. Priya Sharma" />
          </div>
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Contact email</Label>
            <Input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Contact phone</Label>
            <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}