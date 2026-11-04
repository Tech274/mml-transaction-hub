import { useMemo, useState } from "react";
import { filterImportRuns, runAuditSummary } from "@/lib/import-history-view";
import { CloudTypeBadge } from "@/components/cloud/cloud-type-badge";
import { cloudTypeLabel } from "@/lib/cloud-provider";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Download,
  History,
  RefreshCw,
  FileWarning,
  FileText,
  GitBranch,
  Trash2,
  Ban,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FilterActions,
  FilterBar,
  FilterSearch,
  FilterSelect,
  FilterSummary,
} from "@/components/filter-bar";
import { TableStateRow } from "@/components/data-table-parts";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { kpiPeriodFor } from "@/lib/kpi-period";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { runArtifactCleanup } from "@/lib/bulk-import.functions";

interface Run {
  id: string;
  user_email: string | null;
  kind: string;
  filename: string;
  duplicate_strategy: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  imported_rows: number;
  skipped_rows: number;
  updated_rows: number;
  linked_rows: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  column_mapping?: Record<string, number> | null;
  update_fields?: string[] | null;
  retry_count?: number | null;
  max_retries?: number | null;
  parent_run_id?: string | null;
  original_csv_path?: string | null;
  error_artifact_path?: string | null;
}

interface RowAudit {
  line_number: number;
  potential_id: string | null;
  status: string;
  error_message: string | null;
  row_data: Record<string, unknown> | null;
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function BulkImportHistory() {
  const [open, setOpen] = useState<Run | null>(null);
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const { isAdmin, user } = useAuth();
  const cleanupFn = useServerFn(runArtifactCleanup);
  const [cleanupDays, setCleanupDays] = useState<number>(90);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupDryRun, setCleanupDryRun] = useState<boolean>(true);

  async function triggerCleanup() {
    if (
      !cleanupDryRun &&
      !confirm(
        `Delete stored CSV and error artifacts older than ${cleanupDays} day(s)? This cannot be undone.`,
      )
    )
      return;
    setCleanupRunning(true);
    try {
      const res = await cleanupFn({ data: { days: cleanupDays, dryRun: cleanupDryRun } });
      const bucketSummary = Object.entries(res.buckets ?? {})
        .map(([b, c]) => `${b}: ${c.total} (csv ${c.originalCsv} + err ${c.errorArtifact})`)
        .join(" · ");
      const verb = res.dryRun ? "Dry-run preview" : "Cleanup done";
      const noun = res.dryRun ? "would remove" : "removed";
      const pathVerb = res.dryRun ? "would clear" : "cleared";
      const line = `${verb} · ${res.expiredRuns} expired runs · ${res.deletedObjects}/${res.pathsAttempted} objects ${noun} · ${res.clearedRows} paths ${pathVerb}${bucketSummary ? ` · ${bucketSummary}` : ""}`;
      // SCRUM-96: partial failures used to be reported as success.
      if (res.errorRefs && res.errorRefs.length > 0) {
        toast.error(
          `${line} · ${res.failedObjects} objects NOT removed, ${res.runsKept} runs kept their paths (ref ${res.errorRefs.join(", ")})`,
        );
      } else {
        toast.success(line);
      }
      if (!res.dryRun) refetch();
    } catch (e) {
      toast.error(`Cleanup failed: ${(e as Error).message}`);
    } finally {
      setCleanupRunning(false);
    }
  }

  const {
    data: runs = [],
    isFetching,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["bulk_import_runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bulk_import_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });

  // SCRUM-128 C8: moved verbatim to lib/import-history-view.ts (pinned by its test).
  const filtered = useMemo(
    () => filterImportRuns(runs, { search, status: statusF, fromDate, toDate }),
    [runs, search, statusF, fromDate, toDate],
  );
  const filtersActive = Boolean(search || statusF !== "all" || fromDate || toDate);

  async function markCancelled(run: Run) {
    if (
      !confirm(
        `Mark this pending import as cancelled?\n\n${run.filename}\n\nNo transactions are changed.`,
      )
    )
      return;
    const { error } = await supabase
      .from("bulk_import_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", run.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void supabase.from("bulk_import_audit_events").insert({
      run_id: run.id,
      event_type: "run_cancelled",
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      details: {
        filename: run.filename,
        kind: run.kind,
        reason: "marked cancelled from import history",
      },
    } as never);
    toast.success("Import marked cancelled");
    refetch();
  }

  async function downloadErrors(run: Run) {
    const { data, error } = await supabase
      .from("bulk_import_row_audit")
      .select("line_number, potential_id, status, error_message, row_data")
      .eq("run_id", run.id)
      .eq("status", "error")
      .order("line_number");
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data ?? []) as RowAudit[];
    if (!rows.length) {
      // Fall back to the stored error artifact when per-row audit is empty.
      if (run.error_artifact_path) {
        toast.message("No per-row audit found — downloading the stored error artifact instead");
        await downloadArtifact(
          run.error_artifact_path,
          `${run.filename.replace(/\.csv$/i, "")}-invalid-rows.json`,
        );
        return;
      }
      toast.message("No invalid rows for this run");
      return;
    }
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.row_data ?? {}))));
    const header = ["line", "potential_id", "status", "error", ...keys];
    const body = rows.map((r) => [
      String(r.line_number),
      r.potential_id ?? "",
      r.status,
      r.error_message ?? "",
      ...keys.map((k) => String((r.row_data ?? {})[k] ?? "")),
    ]);
    const csv = [header, ...body].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.filename.replace(/\.csv$/i, "")}-invalid-rows.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadArtifact(path: string, suggestedName: string) {
    const { data, error } = await supabase.storage.from("bulk-imports").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not create download link");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = suggestedName;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }

  return (
    <div className="space-y-4">
      <FilterBar
        summary={
          <FilterSummary
            items={[{ label: "Showing", value: `${filtered.length} of ${runs.length}` }]}
          />
        }
      >
        <FilterSearch
          label="Search imports"
          placeholder="Search filename or user…"
          value={search}
          onChange={setSearch}
        />
        <FilterSelect
          label="Status"
          value={statusF}
          onValueChange={setStatusF}
          allLabel="All statuses"
          options={[
            { value: "pending", label: "Pending" },
            { value: "completed", label: "Completed" },
            { value: "failed", label: "Failed" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <div className="w-full md:w-40">
          <Label className="sr-only" htmlFor="import-history-from">
            From
          </Label>
          <Input
            id="import-history-from"
            type="date"
            title="From"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="w-full md:w-40">
          <Label className="sr-only" htmlFor="import-history-to">
            To
          </Label>
          <Input
            id="import-history-to"
            type="date"
            title="To"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        {filtersActive && (
          <FilterActions>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                setStatusF("all");
                setFromDate("");
                setToDate("");
              }}
            >
              Reset
            </Button>
          </FilterActions>
        )}
      </FilterBar>

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="size-4 shrink-0" />
            Import history
          </CardTitle>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isAdmin && (
              <div
                className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/30 py-0.5 pl-2 pr-1"
                aria-label="Admin cleanup"
              >
                <span className="text-xs text-muted-foreground">Retention</span>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Math.max(1, Number(e.target.value) || 90))}
                  className="h-7 w-16 text-xs tabular-nums"
                  aria-label="Retention days"
                />
                <span className="text-xs text-muted-foreground">days</span>
                <label
                  className="flex items-center gap-1 pl-1 text-xs text-muted-foreground"
                  title="Preview only — do not delete"
                >
                  <input
                    type="checkbox"
                    checked={cleanupDryRun}
                    onChange={(e) => setCleanupDryRun(e.target.checked)}
                    data-testid="admin-cleanup-dryrun"
                  />
                  Dry-run
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={triggerCleanup}
                  disabled={cleanupRunning}
                  title={
                    cleanupDryRun
                      ? "Preview how many objects/paths would be removed (no deletion)"
                      : "Delete stored CSV + error artifacts older than the chosen days (admin only)"
                  }
                  data-testid="admin-cleanup-trigger"
                >
                  <Trash2 className={`mr-1 size-3.5 ${cleanupRunning ? "animate-pulse" : ""}`} />
                  {cleanupRunning ? "Working…" : cleanupDryRun ? "Preview" : "Run cleanup"}
                </Button>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 size-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Retry</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Valid</TableHead>
                <TableHead className="text-right">Invalid</TableHead>
                <TableHead className="text-right">Imported</TableHead>
                <TableHead className="text-right">Updated</TableHead>
                <TableHead className="text-right">Linked</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableStateRow colSpan={15}>Loading imports…</TableStateRow>
              ) : isError ? (
                <TableStateRow colSpan={15} onRetry={() => refetch()}>
                  Could not load imports.
                </TableStateRow>
              ) : (
                filtered.length === 0 && (
                  <TableStateRow colSpan={15}>
                    {filtersActive ? "No imports match these filters." : "No imports yet."}
                  </TableStateRow>
                )
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {new Date(r.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs">{r.user_email ?? "—"}</TableCell>
                  <TableCell className="max-w-48 truncate" title={r.filename}>
                    {r.filename}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <CloudTypeBadge value={r.kind} />
                  </TableCell>
                  <TableCell className="text-xs">{r.duplicate_strategy}</TableCell>
                  <TableCell>
                    <Badge variant={runStatusVariant(r.status)}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {r.retry_count ?? 0}/{r.max_retries ?? 3}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.total_rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.valid_rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invalid_rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.imported_rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.updated_rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.linked_rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.skipped_rows}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>
                        Details
                      </Button>
                      {r.original_csv_path && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Download original CSV"
                          onClick={() =>
                            downloadArtifact(r.original_csv_path!, r.filename || "original.csv")
                          }
                        >
                          <FileText className="mr-1 size-3.5" />
                          Original
                        </Button>
                      )}
                      {(r.invalid_rows > 0 || !!r.error_artifact_path) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => downloadErrors(r)}
                          title="Download failed rows CSV"
                        >
                          <FileWarning className="mr-1 size-3.5" />
                          Failed rows
                        </Button>
                      )}
                      {isAdmin && r.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markCancelled(r)}
                          title="Mark this stuck pending run as cancelled"
                          data-testid={`mark-cancelled-${r.id}`}
                        >
                          <Ban className="mr-1 size-3.5" />
                          Mark cancelled
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* #27: the wide sheet (§4.12), full width on a phone. */}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {open && <RunDetails run={open} onDownload={() => downloadErrors(open)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Run status badge (§4.8): completed success, failed destructive, pending warning, else secondary. */
function runStatusVariant(status: string): "success" | "destructive" | "warning" | "secondary" {
  if (status === "completed") return "success";
  if (status === "failed") return "destructive";
  if (status === "pending") return "warning";
  return "secondary";
}

function RunDetails({ run, onDownload }: { run: Run; onDownload: () => void }) {
  const {
    data: rows = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["bulk_import_row_audit", run.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bulk_import_row_audit")
        .select("line_number, potential_id, status, error_message")
        .eq("run_id", run.id)
        .order("line_number");
      if (error) throw error;
      return (data ?? []) as RowAudit[];
    },
  });

  // Aggregate per-status counts for this run from the audit log (lib/import-history-view.ts).
  const summary = useMemo(() => runAuditSummary(rows), [rows]);
  const runPeriod = kpiPeriodFor("import.preview");

  return (
    <>
      <SheetHeader>
        <SheetTitle>Import · {run.filename}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        {/* Summary: per-status counts for this run, as inset tiles (G9 pattern). */}
        <KpiGrid inset className="sm:grid-cols-3">
          {[
            { k: "valid", label: "Valid" },
            { k: "invalid", label: "Invalid" },
            { k: "imported", label: "Imported" },
            { k: "updated", label: "Updated" },
            { k: "linked", label: "Linked" },
            { k: "skipped", label: "Skipped" },
          ].map((t) => (
            <SummaryKpi
              key={t.k}
              variant="inset"
              label={t.label}
              value={String(summary[t.k] ?? 0)}
              period={runPeriod}
            />
          ))}
        </KpiGrid>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">By:</span> {run.user_email ?? "—"}
          </div>
          <div>
            <span className="text-muted-foreground">At:</span>{" "}
            {new Date(run.created_at).toLocaleString()}
          </div>
          <div>
            <span className="text-muted-foreground">Cloud type:</span> {cloudTypeLabel(run.kind)}
          </div>
          <div>
            <span className="text-muted-foreground">Strategy:</span> {run.duplicate_strategy}
          </div>
          <div>
            <span className="text-muted-foreground">Status:</span> {run.status}
          </div>
          <div>
            <span className="text-muted-foreground">Retry:</span> {run.retry_count ?? 0}/
            {run.max_retries ?? 3}
            {run.parent_run_id ? " (child run)" : ""}
          </div>
          <div>
            <span className="text-muted-foreground">Imported / Updated / Linked / Skipped:</span>{" "}
            {run.imported_rows} / {run.updated_rows} / {run.linked_rows} / {run.skipped_rows}
          </div>
        </div>
        {(run.column_mapping || run.update_fields) && (
          <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2 text-xs">
            <div className="font-medium text-foreground">Saved settings (reused on retry)</div>
            {run.column_mapping && (
              <div>
                <span className="text-muted-foreground">Column mapping:</span>{" "}
                {Object.keys(run.column_mapping).join(", ")}
              </div>
            )}
            {run.update_fields && run.update_fields.length > 0 && (
              <div>
                <span className="text-muted-foreground">Update fields:</span>{" "}
                {run.update_fields.join(", ")}
              </div>
            )}
          </div>
        )}
        {(run.invalid_rows > 0 || !!run.error_artifact_path) && (
          <Button size="sm" variant="outline" onClick={onDownload}>
            <FileWarning className="mr-1 size-4" />
            Download error CSV
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          {run.original_csv_path && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const { data, error } = await supabase.storage
                  .from("bulk-imports")
                  .createSignedUrl(run.original_csv_path!, 60);
                if (error || !data?.signedUrl) {
                  toast.error(error?.message ?? "Could not create download link");
                  return;
                }
                const a = document.createElement("a");
                a.href = data.signedUrl;
                a.download = run.filename || "original.csv";
                a.target = "_blank";
                a.rel = "noopener";
                a.click();
              }}
            >
              <FileText className="mr-1 size-4" />
              Download original CSV
            </Button>
          )}
          {run.error_artifact_path && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const { data, error } = await supabase.storage
                  .from("bulk-imports")
                  .createSignedUrl(run.error_artifact_path!, 60);
                if (error || !data?.signedUrl) {
                  toast.error(error?.message ?? "Could not create download link");
                  return;
                }
                const a = document.createElement("a");
                a.href = data.signedUrl;
                a.download = `${run.filename.replace(/\.csv$/i, "")}-errors.json`;
                a.target = "_blank";
                a.rel = "noopener";
                a.click();
              }}
            >
              <Download className="mr-1 size-4" />
              Error JSON artifact
            </Button>
          )}
          {run.parent_run_id && (
            <Badge variant="secondary" className="gap-1">
              <GitBranch className="size-3" />
              Retry of {run.parent_run_id.slice(0, 8)}
            </Badge>
          )}
        </div>
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Line</TableHead>
                <TableHead>Potential ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableStateRow colSpan={4}>Loading rows…</TableStateRow>
              ) : isError ? (
                <TableStateRow colSpan={4} onRetry={() => refetch()}>
                  Could not load rows.
                </TableStateRow>
              ) : (
                rows.length === 0 && (
                  <TableStateRow colSpan={4}>No row audit for this import.</TableStateRow>
                )
              )}
              {rows.map((r) => (
                <TableRow key={r.line_number}>
                  <TableCell className="tabular-nums">{r.line_number}</TableCell>
                  <TableCell className="text-xs">{r.potential_id ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "error" ? "destructive" : "outline"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="max-w-64 truncate text-xs text-destructive"
                    title={r.error_message ?? ""}
                  >
                    {r.error_message ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
