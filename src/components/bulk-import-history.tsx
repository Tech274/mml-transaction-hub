import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Download, History, RefreshCw, FileWarning, Search, FileText, GitBranch, Trash2, Ban } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function csvEscape(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

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
    if (!cleanupDryRun && !confirm(`Delete stored CSV and error artifacts older than ${cleanupDays} day(s)? This cannot be undone.`)) return;
    setCleanupRunning(true);
    try {
      const res = await cleanupFn({ data: { days: cleanupDays, dryRun: cleanupDryRun } });
      const bucketSummary = Object.entries(res.buckets ?? {})
        .map(
          ([b, c]) =>
            `${b}: ${c.total} (csv ${c.originalCsv} + err ${c.errorArtifact})`,
        )
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

  const { data: runs = [], isFetching, refetch } = useQuery({
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (q && !r.filename.toLowerCase().includes(q) && !(r.user_email ?? "").toLowerCase().includes(q)) return false;
      if (statusF !== "all" && r.status !== statusF) return false;
      if (fromDate && new Date(r.created_at) < new Date(fromDate)) return false;
      if (toDate && new Date(r.created_at) > new Date(toDate + "T23:59:59")) return false;
      return true;
    });
  }, [runs, search, statusF, fromDate, toDate]);

  async function markCancelled(run: Run) {
    if (!confirm(`Mark this pending import as cancelled?\n\n${run.filename}\n\nNo transactions are changed.`)) return;
    const { error } = await supabase
      .from("bulk_import_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", run.id);
    if (error) { toast.error(error.message); return; }
    void supabase.from("bulk_import_audit_events").insert({
      run_id: run.id,
      event_type: "run_cancelled",
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      details: { filename: run.filename, kind: run.kind, reason: "marked cancelled from import history" },
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
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []) as RowAudit[];
    if (!rows.length) {
      // Fall back to the stored error artifact when per-row audit is empty.
      if (run.error_artifact_path) {
        toast.message("No per-row audit found — downloading the stored error artifact instead");
        await downloadArtifact(run.error_artifact_path, `${run.filename.replace(/\.csv$/i, "")}-invalid-rows.json`);
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
    a.href = url; a.download = `${run.filename.replace(/\.csv$/i, "")}-invalid-rows.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadArtifact(path: string, suggestedName: string) {
    const { data, error } = await supabase.storage.from("bulk-imports").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { toast.error(error?.message ?? "Could not create download link"); return; }
    const a = document.createElement("a");
    a.href = data.signedUrl; a.download = suggestedName; a.target = "_blank"; a.rel = "noopener"; a.click();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" />Bulk Import History</CardTitle>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <div className="flex items-center gap-1 border rounded-md pl-2 pr-1 py-0.5 bg-muted/30" aria-label="Admin cleanup">
              <span className="text-xs text-muted-foreground">Retention</span>
              <Input
                type="number" min={1} max={3650}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Math.max(1, Number(e.target.value) || 90))}
                className="h-7 w-16 text-xs"
                aria-label="Retention days"
              />
              <span className="text-xs text-muted-foreground">days</span>
              <label className="flex items-center gap-1 text-xs text-muted-foreground pl-1" title="Preview only — do not delete">
                <input
                  type="checkbox"
                  checked={cleanupDryRun}
                  onChange={(e) => setCleanupDryRun(e.target.checked)}
                  data-testid="admin-cleanup-dryrun"
                />
                Dry-run
              </label>
              <Button
                size="sm" variant="ghost"
                onClick={triggerCleanup}
                disabled={cleanupRunning}
                title={cleanupDryRun ? "Preview how many objects/paths would be removed (no deletion)" : "Delete stored CSV + error artifacts older than the chosen days (admin only)"}
                data-testid="admin-cleanup-trigger"
              >
                <Trash2 className={`h-3.5 w-3.5 mr-1 ${cleanupRunning ? "animate-pulse" : ""}`} />
                {cleanupRunning ? "Working…" : cleanupDryRun ? "Preview" : "Run cleanup"}
              </Button>
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search filename or user…"
              className="pl-7 h-9 w-[240px]"
            />
          </div>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-[150px]" aria-label="From" />
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-[150px]" aria-label="To" />
          {(search || statusF !== "all" || fromDate || toDate) && (
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setStatusF("all"); setFromDate(""); setToDate(""); }}>Reset</Button>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{filtered.length} of {runs.length}</div>
        </div>
        <div className="overflow-x-auto border rounded-md">
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
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={15} className="text-center text-muted-foreground py-6">No matching imports</TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{r.user_email ?? "—"}</TableCell>
                  <TableCell className="max-w-[180px] truncate" title={r.filename}>{r.filename}</TableCell>
                  <TableCell>{r.kind === "public_cloud" ? "Public" : "Private"}</TableCell>
                  <TableCell className="text-xs">{r.duplicate_strategy}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "completed" ? "outline" : r.status === "failed" ? "destructive" : "secondary"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {(r.retry_count ?? 0)}/{r.max_retries ?? 3}
                  </TableCell>
                  <TableCell className="text-right">{r.total_rows}</TableCell>
                  <TableCell className="text-right">{r.valid_rows}</TableCell>
                  <TableCell className="text-right">{r.invalid_rows}</TableCell>
                  <TableCell className="text-right">{r.imported_rows}</TableCell>
                  <TableCell className="text-right">{r.updated_rows}</TableCell>
                  <TableCell className="text-right">{r.linked_rows}</TableCell>
                  <TableCell className="text-right">{r.skipped_rows}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Details</Button>
                      {r.original_csv_path && (
                        <Button
                          size="sm" variant="ghost"
                          title="Download original CSV"
                          onClick={() => downloadArtifact(r.original_csv_path!, r.filename || "original.csv")}
                        >
                          <FileText className="h-3.5 w-3.5 mr-1" />Original
                        </Button>
                      )}
                      {(r.invalid_rows > 0 || !!r.error_artifact_path) && (
                        <Button size="sm" variant="ghost" onClick={() => downloadErrors(r)} title="Download failed rows CSV">
                          <FileWarning className="h-3.5 w-3.5 mr-1" />Failed rows
                        </Button>
                      )}
                      {isAdmin && r.status === "pending" && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => markCancelled(r)}
                          title="Mark this stuck pending run as cancelled"
                          data-testid={`mark-cancelled-${r.id}`}
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" />Mark cancelled
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          {open && <RunDetails run={open} onDownload={() => downloadErrors(open)} />}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function RunDetails({ run, onDownload }: { run: Run; onDownload: () => void }) {
  const { data: rows = [], isLoading } = useQuery({
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

  // Aggregate per-status counts for this run+user from the audit log.
  const summary = useMemo(() => {
    const counts: Record<string, number> = { valid: 0, error: 0, imported: 0, updated: 0, linked: 0, skipped: 0 };
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    counts.valid = (counts.imported ?? 0) + (counts.updated ?? 0) + (counts.linked ?? 0);
    counts.invalid = counts.error ?? 0;
    return counts;
  }, [rows]);

  return (
    <>
      <SheetHeader>
        <SheetTitle>Import · {run.filename}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        {/* Summary panel: aggregates per status for this run + user */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { k: "valid", label: "Valid", cls: "text-green-700" },
            { k: "invalid", label: "Invalid", cls: "text-destructive" },
            { k: "imported", label: "Imported", cls: "text-foreground" },
            { k: "updated", label: "Updated", cls: "text-foreground" },
            { k: "linked", label: "Linked", cls: "text-foreground" },
            { k: "skipped", label: "Skipped", cls: "text-muted-foreground" },
          ].map((s) => (
            <div key={s.k} className="rounded-md border p-2 text-center">
              <div className={`text-lg font-semibold ${s.cls}`}>{summary[s.k] ?? 0}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><span className="text-muted-foreground">By:</span> {run.user_email ?? "—"}</div>
          <div><span className="text-muted-foreground">At:</span> {new Date(run.created_at).toLocaleString()}</div>
          <div><span className="text-muted-foreground">Kind:</span> {run.kind}</div>
          <div><span className="text-muted-foreground">Strategy:</span> {run.duplicate_strategy}</div>
          <div><span className="text-muted-foreground">Status:</span> {run.status}</div>
          <div><span className="text-muted-foreground">Retry:</span> {(run.retry_count ?? 0)}/{run.max_retries ?? 3}{run.parent_run_id ? " (child run)" : ""}</div>
          <div><span className="text-muted-foreground">Imported / Updated / Linked / Skipped:</span> {run.imported_rows} / {run.updated_rows} / {run.linked_rows} / {run.skipped_rows}</div>
        </div>
        {(run.column_mapping || run.update_fields) && (
          <div className="rounded-md border p-2 text-xs space-y-1 bg-muted/30">
            <div className="font-medium text-foreground">Saved settings (reused on retry)</div>
            {run.column_mapping && (
              <div><span className="text-muted-foreground">Column mapping:</span> {Object.keys(run.column_mapping).join(", ")}</div>
            )}
            {run.update_fields && run.update_fields.length > 0 && (
              <div><span className="text-muted-foreground">Update fields:</span> {run.update_fields.join(", ")}</div>
            )}
          </div>
        )}
        {(run.invalid_rows > 0 || !!run.error_artifact_path) && (
          <Button size="sm" variant="outline" onClick={onDownload}>
            <FileWarning className="h-4 w-4 mr-1" />Download error CSV
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          {run.original_csv_path && (
            <Button size="sm" variant="outline" onClick={async () => {
              const { data, error } = await supabase.storage.from("bulk-imports").createSignedUrl(run.original_csv_path!, 60);
              if (error || !data?.signedUrl) { toast.error(error?.message ?? "Could not create download link"); return; }
              const a = document.createElement("a");
              a.href = data.signedUrl; a.download = run.filename || "original.csv"; a.target = "_blank"; a.rel = "noopener"; a.click();
            }}>
              <FileText className="h-4 w-4 mr-1" />Download original CSV
            </Button>
          )}
          {run.error_artifact_path && (
            <Button size="sm" variant="outline" onClick={async () => {
              const { data, error } = await supabase.storage.from("bulk-imports").createSignedUrl(run.error_artifact_path!, 60);
              if (error || !data?.signedUrl) { toast.error(error?.message ?? "Could not create download link"); return; }
              const a = document.createElement("a");
              a.href = data.signedUrl; a.download = `${run.filename.replace(/\.csv$/i,"")}-errors.json`; a.target = "_blank"; a.rel = "noopener"; a.click();
            }}>
              <Download className="h-4 w-4 mr-1" />Error JSON artifact
            </Button>
          )}
          {run.parent_run_id && (
            <Badge variant="secondary" className="gap-1"><GitBranch className="h-3 w-3" />Retry of {run.parent_run_id.slice(0, 8)}</Badge>
          )}
        </div>
        <div className="border rounded-md overflow-x-auto">
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
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">Loading…</TableCell></TableRow>}
              {rows.map((r) => (
                <TableRow key={r.line_number}>
                  <TableCell>{r.line_number}</TableCell>
                  <TableCell className="text-xs">{r.potential_id ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "error" ? "destructive" : "outline"} className="text-xs">{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-destructive max-w-[260px] truncate" title={r.error_message ?? ""}>
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
