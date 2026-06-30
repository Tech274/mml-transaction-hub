import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Download, History, RefreshCw, FileWarning, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  async function downloadErrors(run: Run) {
    const { data, error } = await supabase
      .from("bulk_import_row_audit")
      .select("line_number, potential_id, status, error_message, row_data")
      .eq("run_id", run.id)
      .eq("status", "error")
      .order("line_number");
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []) as RowAudit[];
    if (!rows.length) { toast.message("No invalid rows for this run"); return; }
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
    a.href = url; a.download = `${run.filename.replace(/\.csv$/i, "")}-errors.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" />Bulk Import History</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
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
                      {r.invalid_rows > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => downloadErrors(r)} title="Download failed rows CSV">
                          <FileWarning className="h-3.5 w-3.5 mr-1" />Failed rows
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
  return (
    <>
      <SheetHeader>
        <SheetTitle>Import · {run.filename}</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div><span className="text-muted-foreground">By:</span> {run.user_email ?? "—"}</div>
          <div><span className="text-muted-foreground">At:</span> {new Date(run.created_at).toLocaleString()}</div>
          <div><span className="text-muted-foreground">Kind:</span> {run.kind}</div>
          <div><span className="text-muted-foreground">Strategy:</span> {run.duplicate_strategy}</div>
          <div><span className="text-muted-foreground">Status:</span> {run.status}</div>
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
        {run.invalid_rows > 0 && (
          <Button size="sm" variant="outline" onClick={onDownload}>
            <FileWarning className="h-4 w-4 mr-1" />Download error CSV
          </Button>
        )}
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