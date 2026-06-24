import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { exportToExcel } from "@/lib/export-xlsx";
import { Download, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

function CustomersPage() {
  const { user, hasAnyRole } = useAuth();
  const canToggle = hasAnyRole(["admin", "ops_lead"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["customers-summary"],
    queryFn: async () => {
      const { data: customers } = await supabase.from("customers").select("id, customer_name, is_active").order("customer_name");
      const { data: tx } = await supabase.from("transactions").select("customer_id, total_users, selling_cost").eq("is_deleted", false);
      const map = new Map<string, { count: number; users: number; revenue: number }>();
      for (const t of tx ?? []) {
        const e = map.get(t.customer_id) ?? { count: 0, users: 0, revenue: 0 };
        e.count += 1;
        e.users += t.total_users ?? 0;
        e.revenue += Number(t.selling_cost ?? 0);
        map.set(t.customer_id, e);
      }
      return (customers ?? []).map((c) => ({
        ...c,
        ...(map.get(c.id) ?? { count: 0, users: 0, revenue: 0 }),
      }));
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
            Customer: r.customer_name, Status: r.is_active ? "Active" : "Inactive",
            Transactions: r.count, "Total Users": r.users, "Total Revenue": r.revenue,
          })), { generatedBy: user?.email ?? "—", filters: { search } })}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
              <TableHead className="text-right">Total Users</TableHead>
              <TableHead className="text-right">Total Revenue</TableHead>
              {canToggle && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.customer_name}</TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell className="text-right">{fmtNumber(r.count)}</TableCell>
                <TableCell className="text-right">{fmtNumber(r.users)}</TableCell>
                <TableCell className="text-right">{fmtCurrency(r.revenue)}</TableCell>
                {canToggle && (
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => toggle(r.id, r.is_active)}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">No customers found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </AppShell>
  );
}