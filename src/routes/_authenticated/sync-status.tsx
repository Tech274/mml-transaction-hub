import { createFileRoute } from "@tanstack/react-router";
import { countLabel } from "@/lib/sync-health";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { RefreshCw, Database, AlertTriangle, Eye, Loader2, LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  getSyncOverview, triggerSyncNow, listSnapshotRows, type SyncRunRow, type SnapshotRow,
} from "@/lib/sync.functions";
import type { SyncHealth } from "@/lib/sync-health";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/sync-status")({
  component: SyncStatusPage,
});

function SyncStatusPage() {
  const qc = useQueryClient();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["admin"]);
  const overviewFn = useServerFn(getSyncOverview);
  const runNowFn = useServerFn(triggerSyncNow);
  const rowsFn = useServerFn(listSnapshotRows);
  const [openRun, setOpenRun] = useState<SyncRunRow | null>(null);

  const overview = useQuery({
    queryKey: ["sync", "overview"],
    queryFn: () => overviewFn(),
    enabled: !isExampleCaptureMode,
  });

  const runNow = useMutation({
    mutationFn: () => runNowFn(),
    onSuccess: (r) => {
      if (r.status === "success") {
        toast.success(`Snapshot complete — ${r.report_rows} rows from ${r.transactions_count} records`);
      } else {
        toast.error(r.error_message ?? "Snapshot failed");
      }
      qc.invalidateQueries({ queryKey: ["sync"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Snapshot failed"),
  });

  const detailRows = useQuery({
    queryKey: ["sync", "rows", openRun?.id],
    queryFn: () => rowsFn({ data: { run_id: openRun!.id, limit: 200 } }) as Promise<SnapshotRow[]>,
    enabled: !!openRun && !isExampleCaptureMode,
  });

  const d = isExampleCaptureMode ? EXAMPLE_SYNC_OVERVIEW : overview.data;
  const detailRowsData = isExampleCaptureMode ? EXAMPLE_SNAPSHOT_ROWS : detailRows.data;

  return (
    <AppShell title="Sync status">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" /> Snapshot pipeline
              </CardTitle>
              <CardDescription>
                Captures monthly revenue, cost, profit and margin per customer, lab, provider and line of business.
                Runs automatically every day at {d?.snapshot_schedule_utc ?? "02:00 UTC"}.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => overview.refetch()} disabled={overview.isFetching}>
                <RefreshCw className={`h-4 w-4 mr-1 ${overview.isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
              {isAdmin && (
                <Button size="sm" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                  {runNow.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Database className="h-4 w-4 mr-1" />}
                  Run now
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {overview.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading status…
              </div>
            )}
            {overview.isError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not load sync status</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{overview.error instanceof Error ? overview.error.message : "Unknown error"}</p>
                  <Button size="sm" variant="outline" onClick={() => overview.refetch()}>Retry</Button>
                </AlertDescription>
              </Alert>
            )}
            {d && d.count_error_refs.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Some counts could not be loaded</AlertTitle>
                <AlertDescription className="text-xs">
                  Shown as "unavailable", not 0. Ref {d.count_error_refs.join(", ")}.
                </AlertDescription>
              </Alert>
            )}
            {d && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat label="Customers" value={countLabel(d.live_counts.customers)} />
                <Stat label="Transactions" value={countLabel(d.live_counts.transactions)} />
                <Stat label="Snapshot rows" value={countLabel(d.snapshot_rows)} />
                <Stat
                  label="Last successful sync"
                  value={
                    d.last_success?.finished_at
                      ? `${formatDistanceToNow(new Date(d.last_success.finished_at))} ago`
                      : "Never"
                  }
                />
                <Stat label="Next scheduled run" value={format(new Date(d.next_cron_at), "dd MMM, HH:mm 'UTC'")} />
              </div>
            )}
          </CardContent>
        </Card>

        {d && <FreshdeskSyncCard runs={d.freshdesk.runs} health={d.freshdesk.health} />}

        <Card>
          <CardHeader>
            <CardTitle>Snapshot run history</CardTitle>
            <CardDescription>Last 50 snapshot runs, newest first.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Customers</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(d?.runs ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No runs yet. {isAdmin ? "Use “Run now” to capture the first snapshot." : "The first scheduled run is pending."}
                    </TableCell>
                  </TableRow>
                )}
                {(d?.runs ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.started_at), "dd MMM yyyy HH:mm")}</TableCell>
                    <TableCell className="capitalize">{r.trigger_source === "cron" ? "Schedule" : "Manual"}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "success" ? "default" : r.status === "running" ? "secondary" : "destructive"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{r.customers_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.transactions_count.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.report_rows.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.triggered_by_email ?? "system"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpenRun(r)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!openRun} onOpenChange={(o) => !o && setOpenRun(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Snapshot run detail</SheetTitle>
            <SheetDescription>
              {openRun ? `${format(new Date(openRun.started_at), "dd MMM yyyy HH:mm")} · ${openRun.status}` : ""}
            </SheetDescription>
          </SheetHeader>
          {openRun?.error_message && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription className="font-mono text-xs whitespace-pre-wrap">{openRun.error_message}</AlertDescription>
            </Alert>
          )}
          <div className="mt-4 overflow-x-auto">
            {detailRows.isLoading && <p className="text-sm text-muted-foreground">Loading rows…</p>}
            {detailRows.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {detailRows.error instanceof Error ? detailRows.error.message : "Failed to load rows"}
                </AlertDescription>
              </Alert>
            )}
            {detailRows.data && detailRows.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No snapshot rows for this run.</p>
            )}
            {!!detailRowsData?.length && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Lab</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>LOB</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailRowsData.map((row, i) => (
                    <TableRow key={row.id ?? i}>
                      <TableCell>{row.month}/{row.year}</TableCell>
                      <TableCell>{row.customer_name}</TableCell>
                      <TableCell>{row.lab_name}</TableCell>
                      <TableCell>{row.cloud_provider}</TableCell>
                      <TableCell>{row.line_of_business}</TableCell>
                      <TableCell className="text-right">{Number(row.revenue).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(row.cost).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(row.profit).toLocaleString()}</TableCell>
                      <TableCell className="text-right">{Number(row.margin_pct).toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

const EXAMPLE_FRESHDESK_RUNS: SyncRunRow[] = [
  { id: "fd-1", kind: "freshdesk", trigger_source: "cron", status: "success", customers_count: 0, transactions_count: 0, report_rows: 0, error_message: null, triggered_by_email: null, started_at: "2026-09-29T04:00:00Z", finished_at: "2026-09-29T04:01:00Z", duration_ms: 61000, fetched_count: 122, upserted_count: 27 },
  { id: "fd-2", kind: "freshdesk", trigger_source: "cron", status: "success", customers_count: 0, transactions_count: 0, report_rows: 0, error_message: null, triggered_by_email: null, started_at: "2026-09-29T03:00:00Z", finished_at: "2026-09-29T03:00:51Z", duration_ms: 51000, fetched_count: 118, upserted_count: 19 },
  { id: "fd-3", kind: "freshdesk", trigger_source: "cron", status: "error", customers_count: 0, transactions_count: 0, report_rows: 0, error_message: "Freshdesk timeout after 30s", triggered_by_email: null, started_at: "2026-09-29T02:00:00Z", finished_at: "2026-09-29T02:00:31Z", duration_ms: 31000, fetched_count: 0, upserted_count: 0 },
];

const EXAMPLE_SYNC_RUNS: SyncRunRow[] = [
  { id: "sn-1", kind: "snapshot", trigger_source: "manual", status: "success", customers_count: 14, transactions_count: 118, report_rows: 62, error_message: null, triggered_by_email: "admin.demo@mml.local", started_at: "2026-09-29T05:08:00Z", finished_at: "2026-09-29T05:08:15Z", duration_ms: 15000 },
  { id: "sn-2", kind: "snapshot", trigger_source: "cron", status: "success", customers_count: 14, transactions_count: 116, report_rows: 61, error_message: null, triggered_by_email: null, started_at: "2026-09-29T02:00:00Z", finished_at: "2026-09-29T02:00:12Z", duration_ms: 12000 },
  { id: "sn-3", kind: "snapshot", trigger_source: "cron", status: "error", customers_count: 14, transactions_count: 115, report_rows: 0, error_message: "Could not read report_snapshots: connection reset", triggered_by_email: null, started_at: "2026-09-28T02:00:00Z", finished_at: "2026-09-28T02:00:07Z", duration_ms: 7000 },
];

const EXAMPLE_SNAPSHOT_ROWS: SnapshotRow[] = [
  { id: "r1", year: 2026, month: 9, customer_name: "Cognizant", lab_name: "DevOps Pro", cloud_provider: "Azure", line_of_business: "Training", transactions_count: 8, total_users: 92, revenue: 348000, cost: 247500, profit: 100500, margin_pct: 28.9 },
  { id: "r2", year: 2026, month: 9, customer_name: "Infosys", lab_name: "Data Engineering", cloud_provider: "AWS", line_of_business: "Delivery", transactions_count: 6, total_users: 71, revenue: 264000, cost: 181200, profit: 82800, margin_pct: 31.4 },
  { id: "r3", year: 2026, month: 9, customer_name: "TCS", lab_name: "AI Foundations", cloud_provider: "Azure", line_of_business: "Training", transactions_count: 7, total_users: 84, revenue: 309000, cost: 219100, profit: 89900, margin_pct: 29.1 },
];

const EXAMPLE_SYNC_OVERVIEW = {
  runs: EXAMPLE_SYNC_RUNS,
  last_success: EXAMPLE_SYNC_RUNS[0],
  live_counts: { customers: 14, transactions: 118 },
  snapshot_rows: 62,
  count_error_refs: [],
  next_cron_at: "2026-09-30T02:00:00Z",
  snapshot_schedule_utc: "02:00 UTC",
  freshdesk: {
    runs: EXAMPLE_FRESHDESK_RUNS,
    health: {
      state: "warning" as SyncHealth["state"],
      message: "Last run failed once; monitoring",
      lastRunAt: "2026-09-29T04:00:00Z",
      consecutiveFailures: 1,
      runsLast24h: 8,
      failuresLast24h: 1,
      lastSuccessAt: "2026-09-29T04:00:00Z",
      lastFailureAt: "2026-09-29T02:00:00Z",
      lastError: "Freshdesk timeout after 30s",
    },
  },
};

const HEALTH_BADGE: Record<SyncHealth["state"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { label: "Healthy", variant: "default" },
  warning: { label: "Last run failed", variant: "secondary" },
  failing: { label: "Failing", variant: "destructive" },
  stale: { label: "Stale", variant: "destructive" },
  never: { label: "No runs yet", variant: "outline" },
};

// SCRUM-74 (G-07) / SCRUM-72: Freshdesk sync health from sync_runs (kind = 'freshdesk').
function FreshdeskSyncCard({ runs, health }: { runs: SyncRunRow[]; health: SyncHealth }) {
  const badge = HEALTH_BADGE[health.state];
  const alerting = health.state === "failing" || health.state === "stale";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5" /> Freshdesk ticket sync <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardTitle>
        <CardDescription>
          Hourly import of Cloud Labs tickets. An alert shows here after 2 failed runs in a row or 3 hours without a successful run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerting && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{health.message}</AlertTitle>
            {health.lastError && (
              <AlertDescription className="font-mono text-xs whitespace-pre-wrap">{health.lastError}</AlertDescription>
            )}
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Last successful run"
            value={health.lastSuccessAt ? `${formatDistanceToNow(new Date(health.lastSuccessAt))} ago` : "Never"}
          />
          <Stat label="Failures in a row" value={String(health.consecutiveFailures)} />
          <Stat label="Runs (last 24h)" value={String(health.runsLast24h)} />
          <Stat label="Failed (last 24h)" value={String(health.failuresLast24h)} />
        </div>
        {runs.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Fetched</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.slice(0, 12).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{format(new Date(r.started_at), "dd MMM yyyy HH:mm")}</TableCell>
                    <TableCell>{r.trigger_source === "cron" ? "Schedule" : "Manual"}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "success" ? "default" : r.status === "running" ? "secondary" : "destructive"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{r.fetched_count ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.upserted_count ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={r.error_message ?? ""}>
                      {r.error_message ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
