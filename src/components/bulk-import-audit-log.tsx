import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Search, ClipboardList, Eye } from "lucide-react";

type Details = {
  fields_applied?: string[];
  line_numbers?: number[];
  [k: string]: unknown;
};

interface AuditRow {
  id: string;
  run_id: string | null;
  parent_run_id: string | null;
  event_type: string;
  actor_email: string | null;
  actor_id: string | null;
  details: Details | null;
  created_at: string;
}

const EVENT_TYPES = [
  "import_started",
  "import_completed",
  "import_failed",
  "run_cancelled",
  "apply_suggestions",
  "retry_started",
] as const;

export function BulkImportAuditLog() {
  const [runId, setRunId] = useState("");
  const [eventType, setEventType] = useState<string>("all");
  const [line, setLine] = useState("");
  const [open, setOpen] = useState<AuditRow | null>(null);

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: ["bulk-import-audit-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bulk_import_audit_events")
        .select("id,run_id,parent_run_id,event_type,actor_email,actor_id,details,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const filtered = useMemo(() => {
    const idQ = runId.trim().toLowerCase();
    const lineQ = line.trim() ? Number(line.trim()) : null;
    return rows.filter((r) => {
      if (eventType !== "all" && r.event_type !== eventType) return false;
      if (idQ) {
        const inRun = (r.run_id ?? "").toLowerCase().includes(idQ);
        const inParent = (r.parent_run_id ?? "").toLowerCase().includes(idQ);
        if (!inRun && !inParent) return false;
      }
      if (lineQ !== null && !Number.isNaN(lineQ)) {
        const nums = (r.details?.line_numbers ?? []) as number[];
        if (!nums.includes(lineQ)) return false;
      }
      return true;
    });
  }, [rows, runId, eventType, line]);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />Bulk Import Audit Log
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter by run_id (or parent)"
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                className="pl-7 h-8 w-72 text-xs"
                data-testid="audit-filter-run-id"
              />
            </div>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger className="h-8 w-48 text-xs" data-testid="audit-filter-event">
                <SelectValue placeholder="Event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All event types</SelectItem>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={1}
              placeholder="Line #"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className="h-8 w-24 text-xs"
              data-testid="audit-filter-line"
            />
            <span className="text-xs text-muted-foreground ml-auto" data-testid="audit-count">
              {filtered.length} of {rows.length}
            </span>
          </div>
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Lines</TableHead>
                  <TableHead>Fields</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="w-14"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">No matching audit events.</TableCell></TableRow>
                )}
                {filtered.map((r) => {
                  const lines = (r.details?.line_numbers ?? []) as number[];
                  const fields = (r.details?.fields_applied ?? []) as string[];
                  return (
                    <TableRow key={r.id} data-testid={`audit-row-${r.id}`}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant={r.event_type === "retry_started" ? "default" : "outline"} className="text-xs">{r.event_type}</Badge>
                      </TableCell>
                      <TableCell className="text-[11px] font-mono truncate max-w-[160px]" title={r.run_id ?? ""}>{r.run_id ?? "—"}</TableCell>
                      <TableCell className="text-[11px] font-mono truncate max-w-[160px]" title={r.parent_run_id ?? ""}>{r.parent_run_id ?? "—"}</TableCell>
                      <TableCell className="text-xs">{lines.length ? lines.join(", ") : "—"}</TableCell>
                      <TableCell className="text-xs">{fields.length ? fields.join(", ") : "—"}</TableCell>
                      <TableCell className="text-xs truncate max-w-[180px]" title={r.actor_email ?? ""}>{r.actor_email ?? "—"}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => setOpen(r)} data-testid={`audit-detail-${r.id}`} aria-label="View detail">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Badge variant="outline">{open.event_type}</Badge>
                  Audit event detail
                </SheetTitle>
              </SheetHeader>
              <dl className="mt-4 space-y-3 text-sm" data-testid="audit-detail-panel">
                <div>
                  <dt className="text-xs text-muted-foreground">Run ID</dt>
                  <dd className="font-mono text-xs break-all" data-testid="detail-run-id">{open.run_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Parent run ID</dt>
                  <dd className="font-mono text-xs break-all">{open.parent_run_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Line numbers</dt>
                  <dd className="text-xs" data-testid="detail-line-numbers">
                    {(open.details?.line_numbers ?? []).length
                      ? (open.details!.line_numbers as number[]).join(", ")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Selected fields</dt>
                  <dd className="flex flex-wrap gap-1" data-testid="detail-fields-applied">
                    {((open.details?.fields_applied ?? []) as string[]).map((f) => (
                      <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
                    ))}
                    {!((open.details?.fields_applied ?? []) as string[]).length && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Actor</dt>
                  <dd className="text-xs">{open.actor_email ?? open.actor_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">When</dt>
                  <dd className="text-xs">{new Date(open.created_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Raw details</dt>
                  <dd>
                    <pre className="text-[11px] bg-muted/50 rounded-md p-2 overflow-x-auto">
                      {JSON.stringify(open.details ?? {}, null, 2)}
                    </pre>
                  </dd>
                </div>
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
