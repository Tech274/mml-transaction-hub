import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  FilterActions,
  FilterBar,
  FilterSearch,
  FilterSelect,
  FilterSummary,
} from "@/components/filter-bar";
import { TableStateRow } from "@/components/data-table-parts";
import { filterImportAuditEvents } from "@/lib/import-history-view";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, ClipboardList, Eye } from "lucide-react";

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

  const {
    data: rows = [],
    isFetching,
    isLoading,
    isError,
    refetch,
  } = useQuery({
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

  // SCRUM-128 C8: moved verbatim to lib/import-history-view.ts (pinned by its test).
  const filtered = useMemo(
    () => filterImportAuditEvents(rows, { runId, eventType, line }),
    [rows, runId, eventType, line],
  );
  const filtersActive = Boolean(runId || eventType !== "all" || line);

  return (
    <div className="space-y-4">
      <FilterBar
        summary={
          <FilterSummary
            items={[
              {
                label: "Showing",
                value: `${filtered.length} of ${rows.length}`,
                testId: "audit-count",
              },
            ]}
          />
        }
      >
        <FilterSearch
          label="Run ID"
          placeholder="Filter by run ID (or parent)"
          value={runId}
          onChange={setRunId}
          testId="audit-filter-run-id"
        />
        <FilterSelect
          label="Event"
          value={eventType}
          onValueChange={setEventType}
          allLabel="All event types"
          width="md"
          testId="audit-filter-event"
          options={EVENT_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <div className="w-full md:w-28">
          <Label className="sr-only" htmlFor="audit-filter-line">
            Line number
          </Label>
          <Input
            id="audit-filter-line"
            type="number"
            min={1}
            placeholder="Line #"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            className="tabular-nums"
            data-testid="audit-filter-line"
          />
        </div>
        {filtersActive && (
          <FilterActions>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRunId("");
                setEventType("all");
                setLine("");
              }}
            >
              Reset
            </Button>
          </FilterActions>
        )}
      </FilterBar>

      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="size-4 shrink-0" />
            Import audit log
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1 size-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
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
                <TableHead className="w-14">
                  <span className="sr-only">Detail</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableStateRow colSpan={8}>Loading audit events…</TableStateRow>
              ) : isError ? (
                <TableStateRow colSpan={8} onRetry={() => refetch()}>
                  Could not load audit events.
                </TableStateRow>
              ) : (
                filtered.length === 0 && (
                  <TableStateRow colSpan={8}>
                    {filtersActive ? "No matching audit events." : "No audit events yet."}
                  </TableStateRow>
                )
              )}
              {filtered.map((r) => {
                const lines = (r.details?.line_numbers ?? []) as number[];
                const fields = (r.details?.fields_applied ?? []) as string[];
                return (
                  <TableRow key={r.id} data-testid={`audit-row-${r.id}`}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {new Date(r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.event_type === "retry_started" ? "default" : "outline"}>
                        {r.event_type}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="max-w-40 truncate font-mono text-xs"
                      title={r.run_id ?? ""}
                    >
                      {r.run_id ?? "—"}
                    </TableCell>
                    <TableCell
                      className="max-w-40 truncate font-mono text-xs"
                      title={r.parent_run_id ?? ""}
                    >
                      {r.parent_run_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {lines.length ? lines.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {fields.length ? fields.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs" title={r.actor_email ?? ""}>
                      {r.actor_email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setOpen(r)}
                        data-testid={`audit-detail-${r.id}`}
                        aria-label="View detail"
                      >
                        <Eye className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
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
                  <dd className="break-all font-mono text-xs" data-testid="detail-run-id">
                    {open.run_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Parent run ID</dt>
                  <dd className="break-all font-mono text-xs">{open.parent_run_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Line numbers</dt>
                  <dd className="text-xs tabular-nums" data-testid="detail-line-numbers">
                    {(open.details?.line_numbers ?? []).length
                      ? (open.details!.line_numbers as number[]).join(", ")
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Selected fields</dt>
                  <dd className="flex flex-wrap gap-1" data-testid="detail-fields-applied">
                    {((open.details?.fields_applied ?? []) as string[]).map((f) => (
                      <Badge key={f} variant="secondary">
                        {f}
                      </Badge>
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
                  <dd className="text-xs tabular-nums">
                    {new Date(open.created_at).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Raw details</dt>
                  <dd>
                    <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-xs">
                      {JSON.stringify(open.details ?? {}, null, 2)}
                    </pre>
                  </dd>
                </div>
              </dl>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
