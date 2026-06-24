import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { TransactionDetailDrawer } from "./transaction-detail-drawer";
import { fmtCurrency, fmtDate, fmtDateTime, fmtNumber, MONTH_NAMES, YEARS } from "@/lib/format";
import { exportToExcel } from "@/lib/export-xlsx";
import { Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";

export type RepoFilter = "all" | "public_cloud" | "private_cloud";

interface Filters {
  search: string;
  month: string;
  year: string;
  customer: string;
  provider: string;
  lob: string;
  startFrom: string;
  startTo: string;
}

const initial: Filters = {
  search: "", month: "all", year: "all", customer: "all",
  provider: "all", lob: "all", startFrom: "", startTo: "",
};

export function TransactionsTable({
  repoFilter = "all", showProviderFilter = true,
}: { repoFilter?: RepoFilter; showProviderFilter?: boolean }) {
  const [filters, setFilters] = useState<Filters>(initial);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const pageSize = 25;
  const { user } = useAuth();

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "all-active"],
    queryFn: async () => {
      const { data } = await supabase.from("customers").select("id, customer_name").order("customer_name");
      return data ?? [];
    },
  });

  const { data: lobs = [] } = useQuery({
    queryKey: ["config", "line_of_business", "labels"],
    queryFn: async () => {
      const { data } = await supabase.from("config_master").select("label").eq("category", "line_of_business").eq("is_active", true).order("sort_order");
      return (data ?? []).map((d) => d.label);
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", repoFilter, filters, page],
    queryFn: async () => {
      let q = supabase.from("transactions").select("*", { count: "exact" }).eq("is_deleted", false);
      if (repoFilter !== "all") q = q.eq("repository_type", repoFilter);
      if (filters.month !== "all") q = q.eq("month", Number(filters.month));
      if (filters.year !== "all") q = q.eq("year", Number(filters.year));
      if (filters.customer !== "all") q = q.eq("customer_id", filters.customer);
      if (filters.provider !== "all") q = q.eq("cloud_provider", filters.provider);
      if (filters.lob !== "all") q = q.eq("line_of_business", filters.lob);
      if (filters.startFrom) q = q.gte("start_date", filters.startFrom);
      if (filters.startTo) q = q.lte("start_date", filters.startTo);
      if (filters.search.trim()) {
        const s = `%${filters.search.trim()}%`;
        q = q.or(`potential_id.ilike.${s},customer_name.ilike.${s},lab_name.ilike.${s},line_of_business.ilike.${s},cloud_provider.ilike.${s}`);
      }
      q = q.order("created_at", { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1);
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const summary = useMemo(() => ({
    users: rows.reduce((s, r) => s + (r.total_users ?? 0), 0),
    revenue: rows.reduce((s, r) => s + Number(r.selling_cost ?? 0), 0),
  }), [rows]);

  function exportCurrent() {
    exportToExcel(
      repoFilter === "public_cloud" ? "public-cloud" : repoFilter === "private_cloud" ? "private-cloud" : "all-transactions",
      rows.map((r) => ({
        "Potential ID": r.potential_id,
        "Month": MONTH_NAMES[r.month - 1],
        "Year": r.year,
        "Customer": r.customer_name,
        "Lab Name": r.lab_name,
        "Repository": r.repository_type,
        "Cloud Provider": r.cloud_provider,
        "Line of Business": r.line_of_business,
        "Start Date": r.start_date,
        "End Date": r.end_date,
        "Total Users": r.total_users,
        "Selling Cost": Number(r.selling_cost),
        "Created At": r.created_at,
        "Updated At": r.updated_at,
      })),
      { generatedBy: user?.email ?? "—", filters: { repository: repoFilter, ...filters } },
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="col-span-2 lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ID, customer, lab…"
              className="pl-9"
              value={filters.search}
              onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(0); }}
            />
          </div>
          <Select value={filters.month} onValueChange={(v) => { setFilters({ ...filters, month: v }); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.year} onValueChange={(v) => { setFilters({ ...filters, year: v }); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.customer} onValueChange={(v) => { setFilters({ ...filters, customer: v }); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Customer" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.lob} onValueChange={(v) => { setFilters({ ...filters, lob: v }); setPage(0); }}>
            <SelectTrigger><SelectValue placeholder="Line of Business" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All LOB</SelectItem>
              {lobs.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          {showProviderFilter && (
            <Select value={filters.provider} onValueChange={(v) => { setFilters({ ...filters, provider: v }); setPage(0); }}>
              <SelectTrigger><SelectValue placeholder="Provider" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {["AWS", "Azure", "GCP", "MakeMyLabs Private Cloud"].map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-2">
            <Input type="date" value={filters.startFrom} onChange={(e) => { setFilters({ ...filters, startFrom: e.target.value }); setPage(0); }} />
            <Input type="date" value={filters.startTo} onChange={(e) => { setFilters({ ...filters, startTo: e.target.value }); setPage(0); }} />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-sm">
          <div className="flex flex-wrap gap-4 text-muted-foreground">
            <span><strong className="text-foreground">{fmtNumber(total)}</strong> records</span>
            <span>Page users: <strong className="text-foreground">{fmtNumber(summary.users)}</strong></span>
            <span>Page revenue: <strong className="text-foreground">{fmtCurrency(summary.revenue)}</strong></span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setFilters(initial); setPage(0); }}>Reset filters</Button>
            <Button size="sm" onClick={exportCurrent}><Download className="h-4 w-4 mr-1" />Export</Button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Potential ID</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lab</TableHead>
                {showProviderFilter && <TableHead>Provider</TableHead>}
                <TableHead>LOB</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Selling Cost</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-10">Loading…</TableCell></TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-10">No transactions match the current filters.</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenId(r.id)}>
                  <TableCell className="font-medium">{r.potential_id}</TableCell>
                  <TableCell>{MONTH_NAMES[r.month - 1]} {r.year}</TableCell>
                  <TableCell>{r.customer_name}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{r.lab_name}</TableCell>
                  {showProviderFilter && (
                    <TableCell><Badge variant="outline">{r.cloud_provider}</Badge></TableCell>
                  )}
                  <TableCell>{r.line_of_business}</TableCell>
                  <TableCell>{fmtDate(r.start_date)}</TableCell>
                  <TableCell>{fmtDate(r.end_date)}</TableCell>
                  <TableCell className="text-right">{fmtNumber(r.total_users)}</TableCell>
                  <TableCell className="text-right">{fmtCurrency(r.selling_cost)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(r.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
          <div className="text-muted-foreground">Page {page + 1} of {totalPages}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      <TransactionDetailDrawer transactionId={openId} open={!!openId} onOpenChange={(b) => !b && setOpenId(null)} />
    </div>
  );
}