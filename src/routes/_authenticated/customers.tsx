import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import { exportToExcel } from "@/lib/export-xlsx";
import { buildExcelBlobAsync, downloadBlob, type ExportProgress } from "@/lib/export-xlsx-async";
import { startJob, updateJob, finishJob, registerRetryHandler } from "@/lib/export-jobs";
import { Progress } from "@/components/ui/progress";
import { Download, Search, Pencil, ArrowUpDown } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useServerFn } from "@tanstack/react-start";
import { createCustomerFn, updateCustomerFn, setCustomerActiveFn } from "@/lib/customers.functions";

type SortKey = "customer_name" | "account_manager_name" | "count" | "users" | "revenue" | "profit" | "margin";
const PAGE_SIZE = 25;
const ASYNC_EXPORT_THRESHOLD = 200; // rows above this use the async progress flow

type CustomersSearch = { am?: string; status?: "active" | "inactive" | "all"; q?: string; range?: 3 | 6 | 12 };

export const Route = createFileRoute("/_authenticated/customers")({
  validateSearch: (s: Record<string, unknown>): CustomersSearch => {
    const rangeNum = Number(s.range);
    return {
      am: typeof s.am === "string" ? s.am : undefined,
      status: s.status === "active" || s.status === "inactive" || s.status === "all" ? s.status : undefined,
      q: typeof s.q === "string" ? s.q : undefined,
      range: rangeNum === 3 || rangeNum === 6 || rangeNum === 12 ? (rangeNum as 3 | 6 | 12) : undefined,
    };
  },
  component: CustomersPage,
});

function CustomersPage() {
  const { user, hasAnyRole } = useAuth();
  const { can } = usePermissions();
  const searchParams = Route.useSearch();
  const canToggle = hasAnyRole(["admin", "ops_lead"]);
  const canEdit = hasAnyRole(["admin", "ops_lead"]) && can("feature_customer_edit");
  const qc = useQueryClient();
  const [search, setSearch] = useState(searchParams.q ?? "");
  const [amFilter, setAmFilter] = useState<string>(searchParams.am ?? "__all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(searchParams.status ?? "all");
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("customer_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [asyncExport, setAsyncExport] = useState<{ open: boolean; scope: string } | null>(null);
  const setActive = useServerFn(setCustomerActiveFn);
  const [deactivating, setDeactivating] = useState<CustomerRow | null>(null);

  // Apply incoming search-param changes (e.g., drill-down link reuse)
  useEffect(() => {
    if (searchParams.am !== undefined) setAmFilter(searchParams.am);
    if (searchParams.status !== undefined) setStatusFilter(searchParams.status);
    if (searchParams.q !== undefined) setSearch(searchParams.q);
  }, [searchParams.am, searchParams.status, searchParams.q]);

  const { data: rows = [] } = useQuery({
    queryKey: ["customers-summary"],
    queryFn: async () => {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, customer_name, is_active, account_manager_name, contact_email, contact_phone, industry, notes, created_at, deactivation_reason")
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

  const { data: accountManagers = [] } = useQuery({
    queryKey: ["account-managers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("account_managers")
        .select("id, name, is_active")
        .order("name");
      return data ?? [];
    },
  });

  const amOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.account_manager_name) set.add(r.account_manager_name);
    for (const a of accountManagers) if (a.is_active) set.add(a.name);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows, accountManagers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const range = searchParams.range;
    let cutoff: Date | null = null;
    if (range) {
      cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - range);
      cutoff.setHours(0, 0, 0, 0);
    }
    return rows.filter((r) => {
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      if (amFilter !== "__all") {
        if (amFilter === "__none") { if (r.account_manager_name) return false; }
        else if ((r.account_manager_name ?? "") !== amFilter) return false;
      }
      if (cutoff) {
        if (!r.created_at || new Date(r.created_at) < cutoff) return false;
      }
      if (!q) return true;
      return (
        r.customer_name.toLowerCase().includes(q) ||
        (r.account_manager_name ?? "").toLowerCase().includes(q) ||
        (r.industry ?? "").toLowerCase().includes(q) ||
        (r.contact_email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, amFilter, statusFilter, searchParams.range]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av: any = (a as any)[sortKey] ?? (typeof (a as any)[sortKey] === "number" ? 0 : "");
      const bv: any = (b as any)[sortKey] ?? (typeof (b as any)[sortKey] === "number" ? 0 : "");
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, amFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "customer_name" || key === "account_manager_name" ? "asc" : "desc"); }
  }

  function SortHeader({ k, label, className }: { k: SortKey; label: string; className?: string }) {
    return (
      <TableHead className={className}>
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
          {label}<ArrowUpDown className="h-3 w-3 opacity-60" />
        </button>
      </TableHead>
    );
  }

  async function toggle(id: string, current: boolean) {
    if (current) {
      // Deactivating — open the reason dialog instead of acting immediately
      const row = rows.find((r) => r.id === id);
      if (row) setDeactivating(row);
      return;
    }
    try {
      await setActive({ data: { id, active: true, reason: null } });
      toast.success("Customer activated");
      qc.invalidateQueries({ queryKey: ["customers-summary"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  function doExport(set: CustomerRow[], scope: string) {
    if (set.length > ASYNC_EXPORT_THRESHOLD) {
      if (!can("feature_export_jobs_trigger")) {
        toast.error("You don't have permission to run large async exports.");
        return;
      }
      setAsyncExport({ open: true, scope });
      return;
    }
    exportToExcel(`customers-${scope}`, set.map(toExportRow), {
      generatedBy: user?.email ?? "—",
      filters: exportFilters(scope),
    });
  }

  function toExportRow(r: CustomerRow) {
    return {
      Customer: r.customer_name,
      "Account Manager": r.account_manager_name ?? "",
      Industry: r.industry ?? "",
      "Contact Email": r.contact_email ?? "",
      "Contact Phone": r.contact_phone ?? "",
      Status: r.is_active ? "Active" : "Inactive",
      Transactions: r.count, "Total Users": r.users,
      "Total Revenue": r.revenue, "Total Input Cost": r.cost,
      "Total Profit": r.profit, "Margin %": Number(r.margin.toFixed(2)),
    };
  }

  function exportFilters(scope: string) {
    return {
      scope, search, accountManager: amFilter, status: statusFilter, sortBy: sortKey, sortDir,
      ...(scope === "current-page" ? { page: currentPage, pageSize: PAGE_SIZE } : {}),
    };
  }

  function asyncExportRows(): CustomerRow[] {
    if (!asyncExport) return [];
    if (asyncExport.scope === "all") return rows;
    if (asyncExport.scope === "current-page") return paginated;
    return sorted;
  }

  // Register retry handlers so the Admin "View error" drawer can re-trigger
  // a failed export using the same scope + current page filters/sort.
  useEffect(() => {
    const scopes = ["all", "current-page", "filtered"] as const;
    const unregs = scopes.map((s) =>
      registerRetryHandler(`customers-${s}`, () => {
        setAsyncExport({ open: true, scope: s });
      }),
    );
    return () => { for (const u of unregs) u(); };
  }, []);

  return (
    <AppShell title="Customers">
      <Card className="p-4 mb-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customers, account manager, industry…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="w-full md:w-64">
            <Select value={amFilter} onValueChange={setAmFilter}>
              <SelectTrigger><SelectValue placeholder="All account managers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All account managers</SelectItem>
                <SelectItem value="__none">— Unassigned —</SelectItem>
                {amOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full md:w-40">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="inactive">Inactive only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {can("feature_excel_export") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm"><Download className="h-4 w-4 mr-1" />Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Excel export</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => doExport(sorted, "all-filtered")}>All filtered ({sorted.length})</DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport(paginated, "current-page")}>Current page ({paginated.length})</DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport(rows, "all")}>All customers ({rows.length})</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-1" />Add Customer
            </Button>
          )}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader k="customer_name" label="Customer" />
              <SortHeader k="account_manager_name" label="Account Manager" />
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <SortHeader k="count" label="Transactions" className="text-right" />
              <SortHeader k="users" label="Total Users" className="text-right" />
              <SortHeader k="revenue" label="Total Revenue" className="text-right" />
              <TableHead className="text-right">Input Cost</TableHead>
              <SortHeader k="profit" label="Profit" className="text-right" />
              <SortHeader k="margin" label="Margin" className="text-right" />
              {canToggle && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((r) => (
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
            {paginated.length === 0 && (
              <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">No customers found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
          <div className="text-muted-foreground">
            {sorted.length === 0 ? "0 results" :
              `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
            <span className="text-muted-foreground">Page {currentPage} of {totalPages}</span>
            <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>Next</Button>
          </div>
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
      <AddCustomerDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          qc.invalidateQueries({ queryKey: ["customers-summary"] });
          qc.invalidateQueries({ queryKey: ["customers"] });
        }}
      />
      <AsyncExportDialog
        open={!!asyncExport?.open}
        onClose={() => setAsyncExport(null)}
        rows={asyncExportRows().map(toExportRow)}
        filename={`customers-${asyncExport?.scope ?? "export"}-${new Date().toISOString().slice(0, 10)}.xlsx`}
        meta={{ generatedBy: user?.email ?? "—", filters: exportFilters(asyncExport?.scope ?? "") }}
        scope={`customers-${asyncExport?.scope ?? "export"}`}
        generatedBy={user?.email ?? "—"}
      />
      <DeactivateReasonDialog
        customer={deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={async (reason) => {
          if (!deactivating) return;
          try {
            await setActive({ data: { id: deactivating.id, active: false, reason } });
            toast.success("Customer deactivated");
            qc.invalidateQueries({ queryKey: ["customers-summary"] });
            qc.invalidateQueries({ queryKey: ["customers"] });
            setDeactivating(null);
          } catch (e: any) { toast.error(e?.message ?? "Failed"); }
        }}
      />
    </AppShell>
  );
}

function AsyncExportDialog({
  open, onClose, rows, filename, meta, scope, generatedBy,
}: {
  open: boolean; onClose: () => void;
  rows: Record<string, unknown>[]; filename: string;
  meta: { generatedBy: string; filters?: Record<string, unknown> };
  scope: string;
  generatedBy: string;
}) {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [controller, setController] = useState<AbortController | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (!open) { setProgress(null); setBlob(null); setError(null); return; }
    let stopped = false;
    const ac = new AbortController();
    setController(ac);
    setCancelled(false);
    const jobId = startJob({
      filename, scope, total: rows.length, user: generatedBy,
    });
    let attempts = 1;
    (async () => {
      try {
        setError(null); setBlob(null); setProgress(null);
        const b = await buildExcelBlobAsync(rows, meta, (p) => {
          if (stopped) return;
          setProgress(p);
          if (p.attempt && p.attempt > attempts) attempts = p.attempt;
          updateJob(jobId, { processed: p.processed, total: p.total, attempts });
        }, 500, ac.signal);
        if (!stopped) { setBlob(b); finishJob(jobId, "done"); }
      } catch (e: any) {
        if (stopped) return;
        if (e?.name === "ExportCancelledError" || ac.signal.aborted) {
          setCancelled(true);
          finishJob(jobId, "cancelled");
        } else {
          const msg = e?.message ?? "Export failed";
          setError(msg);
          finishJob(jobId, "error", { message: msg, name: e?.name, stack: e?.stack });
        }
      }
    })();
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId]);

  const pct = progress && progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : (progress?.phase === "writing" ? 95 : progress?.phase === "done" ? 100 : 5);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Preparing Excel export</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {cancelled ? (
              <div className="text-amber-600 font-medium">Export cancelled.</div>
            ) : error ? (
              <div className="space-y-1">
                <div className="text-destructive font-medium">Export failed</div>
                <div className="text-xs text-destructive/80 break-words">{error}</div>
              </div>
            ) : (
              <>
                {progress?.message ?? "Starting…"}
                {progress?.attempt && progress.attempt > 1 && (
                  <span className="ml-1 text-xs text-amber-600">(attempt {progress.attempt})</span>
                )}
              </>
            )}
          </div>
          <Progress value={pct} />
          <div className="text-xs text-muted-foreground">
            {progress ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()} rows` : ""}
          </div>
        </div>
        <DialogFooter>
          {!blob && !error && !cancelled && (
            <Button variant="outline" onClick={() => { controller?.abort(); }}>
              Cancel export
            </Button>
          )}
          {cancelled && (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              <Button onClick={() => { setCancelled(false); setRunId((n) => n + 1); }}>Restart</Button>
            </>
          )}
          {error && <>
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button onClick={() => setRunId((n) => n + 1)}>Retry</Button>
          </>}
          {blob && <>
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button onClick={() => { downloadBlob(blob, filename); onClose(); }}>
              <Download className="h-4 w-4 mr-1" />Download
            </Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateReasonDialog({
  customer, onClose, onConfirm,
}: { customer: CustomerRow | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (customer) { setReason(""); setBusy(false); } }, [customer]);

  async function confirm() {
    const r = reason.trim();
    if (!r) { toast.error("Please enter a reason."); return; }
    setBusy(true);
    try { await onConfirm(r); } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!customer} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate {customer?.customer_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Deactivation reason *</Label>
          <Textarea
            rows={3}
            placeholder="e.g. contract ended, duplicate record, customer churned…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The reason is recorded in the customer audit log.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || !reason.trim()}>
            {busy ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountManagerPicker({
  valueId, valueName, onChange,
}: { valueId: string | null; valueName: string | null; onChange: (v: { id: string | null; name: string | null }) => void }) {
  const { data: managers = [] } = useQuery({
    queryKey: ["account-managers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("account_managers").select("id, name, is_active").order("name");
      return data ?? [];
    },
  });
  const active = managers.filter((m: any) => m.is_active);
  const selected = valueId ?? (active.find((m: any) => m.name === valueName)?.id ?? "");
  return (
    <Select
      value={selected || "__none"}
      onValueChange={(v) => {
        if (v === "__none") return onChange({ id: null, name: null });
        const m = active.find((x: any) => x.id === v);
        onChange({ id: v, name: m?.name ?? null });
      }}
    >
      <SelectTrigger><SelectValue placeholder="Select account manager" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">— None —</SelectItem>
        {active.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function AddCustomerDialog({
  open, onClose, onSaved,
}: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    customer_name: "",
    account_manager_id: null as string | null,
    account_manager_name: "",
    contact_email: "",
    contact_phone: "",
    industry: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const create = useServerFn(createCustomerFn);

  useEffect(() => {
    if (open) {
      setForm({ customer_name: "", account_manager_id: null, account_manager_name: "", contact_email: "", contact_phone: "", industry: "", notes: "" });
    }
  }, [open]);

  async function save() {
    setSaving(true);
    try {
      await create({ data: {
        customer_name: form.customer_name,
        account_manager_id: form.account_manager_id,
        account_manager_name: form.account_manager_name,
        contact_email: form.contact_email,
        contact_phone: form.contact_phone,
        industry: form.industry,
        notes: form.notes,
      } });
      toast.success("Customer added");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add customer</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label>Customer name *</Label>
            <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Account Manager</Label>
            <AccountManagerPicker
              valueId={form.account_manager_id}
              valueName={form.account_manager_name || null}
              onChange={(v) => setForm({ ...form, account_manager_id: v.id, account_manager_name: v.name ?? "" })}
            />
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
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  created_at?: string | null;
  deactivation_reason?: string | null;
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
    account_manager_id: null as string | null,
    account_manager_name: "",
    contact_email: "",
    contact_phone: "",
    industry: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const update = useServerFn(updateCustomerFn);

  useEffect(() => {
    if (customer) {
      setForm({
        customer_name: customer.customer_name,
        account_manager_id: null,
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
    setSaving(true);
    try {
      await update({ data: {
        id: customer.id,
        customer_name: form.customer_name,
        account_manager_id: form.account_manager_id,
        account_manager_name: form.account_manager_name,
        contact_email: form.contact_email,
        contact_phone: form.contact_phone,
        industry: form.industry,
        notes: form.notes,
      } });
      toast.success("Customer details saved");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save customer");
    } finally {
      setSaving(false);
    }
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
          <div className="md:col-span-2 space-y-1.5">
            <Label>Account Manager</Label>
            <AccountManagerPicker
              valueId={form.account_manager_id}
              valueName={form.account_manager_name || null}
              onChange={(v) => setForm({ ...form, account_manager_id: v.id, account_manager_name: v.name ?? "" })}
            />
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
