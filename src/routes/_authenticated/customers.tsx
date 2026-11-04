// SCRUM-128 C7 (plan P08): Customers on the shared standard: FilterBar, SortableHead,
// TableStateRow (loading / error / empty), TablePagination, success/warning tokens, dialog widths.
// The numbers live in lib/customers-list.ts (moved verbatim, pinned in its test).
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readAllRows } from "@/lib/read-all";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtCurrency, fmtNumber } from "@/lib/format";
import {
  customerExportRow,
  customerTotals,
  filterCustomers,
  sortCustomers,
  type CustomerRow,
  type CustomerSortKey,
  type CustomerStatusFilter,
} from "@/lib/customers-list";
import { FilterActions, FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar";
import { SortableHead, TablePagination, TableStateRow } from "@/components/data-table-parts";
import { cn } from "@/lib/utils";
import { exportToExcel } from "@/lib/export-xlsx";
import { buildExcelBlobAsync, downloadBlob, type ExportProgress } from "@/lib/export-xlsx-async";
import { startJob, updateJob, finishJob, registerRetryHandler } from "@/lib/export-jobs";
import { Progress } from "@/components/ui/progress";
import { Download, Pencil } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useServerFn } from "@tanstack/react-start";
import { createCustomerFn, updateCustomerFn, setCustomerActiveFn } from "@/lib/customers.functions";
import { CustomersExampleView } from "@/components/customers-example-view";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

type SortKey = CustomerSortKey;
const PAGE_SIZE = 25;
const ASYNC_EXPORT_THRESHOLD = 200; // rows above this use the async progress flow

type CustomersSearch = {
  am?: string;
  status?: "active" | "inactive" | "all";
  q?: string;
  range?: 3 | 6 | 12;
};

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => pageHead("/customers"),
  validateSearch: (s: Record<string, unknown>): CustomersSearch => {
    const rangeNum = Number(s.range);
    return {
      am: typeof s.am === "string" ? s.am : undefined,
      status:
        s.status === "active" || s.status === "inactive" || s.status === "all"
          ? s.status
          : undefined,
      q: typeof s.q === "string" ? s.q : undefined,
      range:
        rangeNum === 3 || rangeNum === 6 || rangeNum === 12 ? (rangeNum as 3 | 6 | 12) : undefined,
    };
  },
  component: CustomersPage,
});

// SCRUM-128 C7: hooks must not run after an early return, so capture mode and the live page are
// two components (was one component returning early before its hooks).
function CustomersPage() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  if (isExampleCaptureMode) {
    return (
      <AppShell {...pageShell("/customers")}>
        <CustomersExampleView />
      </AppShell>
    );
  }
  return <CustomersLivePage />;
}

const COLUMN_COUNT = 10;

function CustomersLivePage() {
  const { user, hasAnyRole } = useAuth();
  const { can } = usePermissions();
  const searchParams = Route.useSearch();
  const canToggle = hasAnyRole(["admin", "ops_lead"]);
  const canEdit = hasAnyRole(["admin", "ops_lead"]) && can("feature_customer_edit");
  const qc = useQueryClient();
  const [search, setSearch] = useState(searchParams.q ?? "");
  const [amFilter, setAmFilter] = useState<string>(searchParams.am ?? "__all");
  const [statusFilter, setStatusFilter] = useState<CustomerStatusFilter>(
    searchParams.status ?? "all",
  );
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

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["customers-summary"],
    queryFn: async () => {
      // SCRUM-70: all rows, not just the first 1,000; errors are shown instead of empty totals.
      const customers = await readAllRows(
        () =>
          supabase
            .from("customers")
            .select(
              "id, customer_name, is_active, account_manager_name, contact_email, contact_phone, industry, notes, created_at, deactivation_reason",
            )
            .order("customer_name")
            .order("id"),
        "Customers",
      );
      const tx = await readAllRows(
        () =>
          supabase
            .from("transactions")
            .select("customer_id, total_users, input_cost, selling_cost")
            .eq("is_deleted", false)
            .order("id"),
        "Customer transactions",
      );
      return customerTotals(customers, tx);
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

  const filtered = useMemo(
    () => filterCustomers(rows, { search, amFilter, statusFilter, range: searchParams.range }),
    [rows, search, amFilter, statusFilter, searchParams.range],
  );

  const sorted = useMemo(
    () => sortCustomers(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, amFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "customer_name" || key === "account_manager_name" ? "asc" : "desc");
    }
  }

  const sortProps = (k: SortKey) => ({
    active: sortKey === k,
    direction: sortDir,
    onSort: () => toggleSort(k),
  });

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
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
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

  const toExportRow = customerExportRow;

  function exportFilters(scope: string) {
    return {
      scope,
      search,
      accountManager: amFilter,
      status: statusFilter,
      sortBy: sortKey,
      sortDir,
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
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  return (
    <AppShell {...pageShell("/customers")}>
      <FilterBar>
        <div className="w-full md:min-w-64 md:flex-1">
          <FilterSearch
            value={search}
            onChange={setSearch}
            placeholder="Search customers, account manager, industry…"
            label="Search customers"
          />
        </div>
        <FilterSelect
          label="Account manager"
          width="md"
          value={amFilter}
          onValueChange={setAmFilter}
          allLabel="All account managers"
          allValue="__all"
          options={[
            { value: "__none", label: "— Unassigned —" },
            ...amOptions.map((n) => ({ value: n, label: n })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as CustomerStatusFilter)}
          allLabel="All statuses"
          options={[
            { value: "active", label: "Active only" },
            { value: "inactive", label: "Inactive only" },
          ]}
        />
        <FilterActions>
          {can("feature_excel_export") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Download className="mr-1 size-4" aria-hidden />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Excel export</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => doExport(sorted, "all-filtered")}>
                  All filtered ({sorted.length})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport(paginated, "current-page")}>
                  Current page ({paginated.length})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doExport(rows, "all")}>
                  All customers ({rows.length})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 size-4" aria-hidden />
              Add customer
            </Button>
          )}
        </FilterActions>
      </FilterBar>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Customer" {...sortProps("customer_name")} />
              <SortableHead label="Account manager" {...sortProps("account_manager_name")} />
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <SortableHead label="Transactions" className="text-right" {...sortProps("count")} />
              <SortableHead label="Total users" className="text-right" {...sortProps("users")} />
              <SortableHead
                label="Total revenue"
                className="text-right"
                {...sortProps("revenue")}
              />
              <TableHead className="text-right">Input cost</TableHead>
              <SortableHead label="Profit" className="text-right" {...sortProps("profit")} />
              <SortableHead label="Margin" className="text-right" {...sortProps("margin")} />
              {canToggle && (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableStateRow colSpan={COLUMN_COUNT + 1}>Loading customers…</TableStateRow>
            )}
            {!isLoading && error && (
              <TableStateRow colSpan={COLUMN_COUNT + 1} onRetry={() => void refetch()}>
                Could not load customers: {error instanceof Error ? error.message : "Unknown error"}
              </TableStateRow>
            )}
            {paginated.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <div>{r.customer_name}</div>
                  {r.industry && <div className="text-xs text-muted-foreground">{r.industry}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {r.account_manager_name || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {r.contact_email && <div>{r.contact_email}</div>}
                  {r.contact_phone && (
                    <div className="text-muted-foreground">{r.contact_phone}</div>
                  )}
                  {!r.contact_email && !r.contact_phone && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={r.is_active ? "success" : "secondary"}>
                    {r.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.count)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNumber(r.users)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCurrency(r.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCurrency(r.cost)}</TableCell>
                <TableCell
                  className={cn("text-right tabular-nums", r.profit < 0 && "text-destructive")}
                >
                  {fmtCurrency(r.profit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.revenue > 0 ? `${r.margin.toFixed(1)}%` : "—"}
                </TableCell>
                {canToggle && (
                  <TableCell className="whitespace-nowrap text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        <Pencil className="mr-1 size-3.5" aria-hidden />
                        Edit
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => toggle(r.id, r.is_active)}>
                      {r.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!isLoading && !error && paginated.length === 0 && (
              <TableStateRow colSpan={COLUMN_COUNT + 1}>No customers found.</TableStateRow>
            )}
          </TableBody>
        </Table>
        <div className="border-t border-border px-4 py-3">
          <TablePagination
            page={currentPage}
            pageCount={totalPages}
            onPageChange={setPage}
            summary={
              sorted.length === 0
                ? "0 results"
                : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, sorted.length)} of ${sorted.length} · Page ${currentPage} of ${totalPages}`
            }
          />
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
          } catch (e: any) {
            toast.error(e?.message ?? "Failed");
          }
        }}
      />
    </AppShell>
  );
}

function AsyncExportDialog({
  open,
  onClose,
  rows,
  filename,
  meta,
  scope,
  generatedBy,
}: {
  open: boolean;
  onClose: () => void;
  rows: Record<string, unknown>[];
  filename: string;
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
    if (!open) {
      setProgress(null);
      setBlob(null);
      setError(null);
      return;
    }
    let stopped = false;
    const ac = new AbortController();
    setController(ac);
    setCancelled(false);
    const jobId = startJob({
      filename,
      scope,
      total: rows.length,
      user: generatedBy,
    });
    let attempts = 1;
    (async () => {
      try {
        setError(null);
        setBlob(null);
        setProgress(null);
        const b = await buildExcelBlobAsync(
          rows,
          meta,
          (p) => {
            if (stopped) return;
            setProgress(p);
            if (p.attempt && p.attempt > attempts) attempts = p.attempt;
            updateJob(jobId, { processed: p.processed, total: p.total, attempts });
          },
          500,
          ac.signal,
        );
        if (!stopped) {
          setBlob(b);
          finishJob(jobId, "done");
        }
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
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId]);

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : progress?.phase === "writing"
        ? 95
        : progress?.phase === "done"
          ? 100
          : 5;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Preparing Excel export</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {cancelled ? (
              <div className="text-warning font-medium">Export cancelled.</div>
            ) : error ? (
              <div className="space-y-1">
                <div className="text-destructive font-medium">Export failed</div>
                <div className="text-xs text-destructive/80 break-words">{error}</div>
              </div>
            ) : (
              <>
                {progress?.message ?? "Starting…"}
                {progress?.attempt && progress.attempt > 1 && (
                  <span className="ml-1 text-xs text-warning">(attempt {progress.attempt})</span>
                )}
              </>
            )}
          </div>
          <Progress value={pct} />
          <div className="text-xs text-muted-foreground">
            {progress
              ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()} rows`
              : ""}
          </div>
        </div>
        <DialogFooter>
          {!blob && !error && !cancelled && (
            <Button
              variant="outline"
              onClick={() => {
                controller?.abort();
              }}
            >
              Cancel export
            </Button>
          )}
          {cancelled && (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setCancelled(false);
                  setRunId((n) => n + 1);
                }}
              >
                Restart
              </Button>
            </>
          )}
          {error && (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => setRunId((n) => n + 1)}>Retry</Button>
            </>
          )}
          {blob && (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => {
                  downloadBlob(blob, filename);
                  onClose();
                }}
              >
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateReasonDialog({
  customer,
  onClose,
  onConfirm,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (customer) {
      setReason("");
      setBusy(false);
    }
  }, [customer]);

  async function confirm() {
    const r = reason.trim();
    if (!r) {
      toast.error("Please enter a reason.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(r);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!customer}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || !reason.trim()}>
            {busy ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountManagerPicker({
  valueId,
  valueName,
  onChange,
}: {
  valueId: string | null;
  valueName: string | null;
  onChange: (v: { id: string | null; name: string | null }) => void;
}) {
  const { data: managers = [] } = useQuery({
    queryKey: ["account-managers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("account_managers")
        .select("id, name, is_active")
        .order("name");
      return data ?? [];
    },
  });
  const active = managers.filter((m: any) => m.is_active);
  const selected = valueId ?? active.find((m: any) => m.name === valueName)?.id ?? "";
  return (
    <Select
      value={selected || "__none"}
      onValueChange={(v) => {
        if (v === "__none") return onChange({ id: null, name: null });
        const m = active.find((x: any) => x.id === v);
        onChange({ id: v, name: m?.name ?? null });
      }}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select account manager" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">— None —</SelectItem>
        {active.map((m: any) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddCustomerDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      setForm({
        customer_name: "",
        account_manager_id: null,
        account_manager_name: "",
        contact_email: "",
        contact_phone: "",
        industry: "",
        notes: "",
      });
    }
  }, [open]);

  async function save() {
    setSaving(true);
    try {
      await create({
        data: {
          customer_name: form.customer_name,
          account_manager_id: form.account_manager_id,
          account_manager_name: form.account_manager_name,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          industry: form.industry,
          notes: form.notes,
        },
      });
      toast.success("Customer added");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label>Customer name *</Label>
            <Input
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Account Manager</Label>
            <AccountManagerPicker
              valueId={form.account_manager_id}
              valueName={form.account_manager_name || null}
              onChange={(v) =>
                setForm({ ...form, account_manager_id: v.id, account_manager_name: v.name ?? "" })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Input
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact email</Label>
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact phone</Label>
            <Input
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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
      await update({
        data: {
          id: customer.id,
          customer_name: form.customer_name,
          account_manager_id: form.account_manager_id,
          account_manager_name: form.account_manager_name,
          contact_email: form.contact_email,
          contact_phone: form.contact_phone,
          industry: form.industry,
          notes: form.notes,
        },
      });
      toast.success("Customer details saved");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={!!customer}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit customer details</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2 space-y-1.5">
            <Label>Customer name *</Label>
            <Input
              value={form.customer_name}
              onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Account Manager</Label>
            <AccountManagerPicker
              valueId={form.account_manager_id}
              valueName={form.account_manager_name || null}
              onChange={(v) =>
                setForm({ ...form, account_manager_id: v.id, account_manager_name: v.name ?? "" })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Input
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact email</Label>
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact phone</Label>
            <Input
              value={form.contact_phone}
              onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
