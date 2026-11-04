import { createFileRoute } from "@tanstack/react-router";
import { countLabel } from "@/lib/sync-health";
import { formatNextScheduledRun } from "@/lib/sync-schedule-label";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { RefreshCw, Database, AlertTriangle, Eye, Loader2, LifeBuoy } from "lucide-react";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { ErrorState, LoadingState } from "@/components/page-states";
import { TableStateRow } from "@/components/data-table-parts";
import { kpiPeriodFor } from "@/lib/kpi-period";
import { useAuth } from "@/lib/auth-context";
import {
  getSyncOverview,
  triggerSyncNow,
  listSnapshotRows,
  type SyncRunRow,
  type SnapshotRow,
} from "@/lib/sync.functions";
import type { SyncHealth } from "@/lib/sync-health";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { requireRouteRoles } from "@/lib/route-guard";

export const Route = createFileRoute("/_authenticated/sync-status")({
  head: () => pageHead("/sync-status"),
  beforeLoad: requireRouteRoles("/sync-status"),
  component: SyncStatusPage,
});

function SyncStatusPage() {
  const qc = useQueryClient();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
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
        toast.success(
          `Snapshot complete — ${r.report_rows} rows from ${r.transactions_count} records`,
        );
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

  const statePeriod = kpiPeriodFor("sync.state");

  return (
    <AppShell {...pageShell("/sync-status")}>
      <Card>
        {/* #24: title + description on the left, actions wrap on the right. */}
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="size-4 shrink-0" /> Snapshot pipeline
            </CardTitle>
            <CardDescription>
              Captures monthly revenue, cost, profit and margin per customer, lab, provider and line
              of business. Runs automatically every day at {d?.snapshot_schedule_utc ?? "02:00 UTC"}
              .
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => overview.refetch()}
              disabled={overview.isFetching}
            >
              <RefreshCw className={`mr-1 size-4 ${overview.isFetching ? "animate-spin" : ""}`} />{" "}
              Refresh
            </Button>
            {isAdmin && (
              <Button size="sm" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Database className="mr-1 size-4" />
                )}
                Run now
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.isLoading && <LoadingState thing="sync status" inCard />}
          {overview.isError && (
            <ErrorState
              thing="sync status"
              error={overview.error}
              onRetry={() => overview.refetch()}
            />
          )}
          {d && d.count_error_refs.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Some counts could not be loaded</AlertTitle>
              <AlertDescription className="text-xs">
                Shown as "unavailable", not 0. Ref {d.count_error_refs.join(", ")}.
              </AlertDescription>
            </Alert>
          )}
          {d && (
            <KpiGrid inset className="xl:grid-cols-5">
              <SummaryKpi
                variant="inset"
                label="Customers"
                value={countLabel(d.live_counts.customers)}
                period={statePeriod}
              />
              <SummaryKpi
                variant="inset"
                label="Transactions"
                value={countLabel(d.live_counts.transactions)}
                period={statePeriod}
              />
              <SummaryKpi
                variant="inset"
                label="Snapshot rows"
                value={countLabel(d.snapshot_rows)}
                period={statePeriod}
              />
              <SummaryKpi
                variant="inset"
                label="Last successful sync"
                value={
                  d.last_success?.finished_at
                    ? `${formatDistanceToNow(new Date(d.last_success.finished_at))} ago`
                    : "Never"
                }
                period={statePeriod}
              />
              <SummaryKpi
                variant="inset"
                label="Next scheduled run"
                value={formatNextScheduledRun(d.next_cron_at)}
                period={statePeriod}
              />
            </KpiGrid>
          )}
        </CardContent>
      </Card>

      {d && <FreshdeskSyncCard runs={d.freshdesk.runs} health={d.freshdesk.health} />}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">Snapshot run history</CardTitle>
          <CardDescription>Last 50 snapshot runs, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
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
                <TableHead>
                  <span className="sr-only">Detail</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.isLoading ? (
                <TableStateRow colSpan={9}>Loading runs…</TableStateRow>
              ) : (
                (d?.runs ?? []).length === 0 && (
                  <TableStateRow colSpan={9}>
                    No runs yet.{" "}
                    {isAdmin
                      ? "Use “Run now” to capture the first snapshot."
                      : "The first scheduled run is pending."}
                  </TableStateRow>
                )
              )}
              {(d?.runs ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {format(new Date(r.started_at), "dd MMM yyyy HH:mm")}
                  </TableCell>
                  <TableCell>{r.trigger_source === "cron" ? "Schedule" : "Manual"}</TableCell>
                  <TableCell>
                    <Badge variant={runStatusVariant(r.status)}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.customers_count.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.transactions_count.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.report_rows.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.triggered_by_email ?? "system"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenRun(r)}
                      aria-label="View run detail"
                    >
                      <Eye className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!openRun} onOpenChange={(o) => !o && setOpenRun(null)}>
        {/* §4.12: the wide sheet. */}
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Snapshot run detail</SheetTitle>
            <SheetDescription>
              {openRun
                ? `${format(new Date(openRun.started_at), "dd MMM yyyy HH:mm")} · ${openRun.status}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {openRun?.error_message && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="size-4" />
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
                {openRun.error_message}
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-4">
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
                {detailRows.isLoading ? (
                  <TableStateRow colSpan={9}>Loading rows…</TableStateRow>
                ) : detailRows.isError ? (
                  <TableStateRow colSpan={9} onRetry={() => detailRows.refetch()}>
                    {detailRows.error instanceof Error
                      ? detailRows.error.message
                      : "Failed to load rows"}
                  </TableStateRow>
                ) : (
                  !detailRowsData?.length && (
                    <TableStateRow colSpan={9}>No snapshot rows for this run.</TableStateRow>
                  )
                )}
                {(detailRowsData ?? []).map((row, i) => (
                  <TableRow key={row.id ?? i}>
                    <TableCell className="tabular-nums">
                      {row.month}/{row.year}
                    </TableCell>
                    <TableCell>{row.customer_name}</TableCell>
                    <TableCell>{row.lab_name}</TableCell>
                    <TableCell>{row.cloud_provider}</TableCell>
                    <TableCell>{row.line_of_business}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(row.revenue).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(row.cost).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(row.profit).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(row.margin_pct).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

const EXAMPLE_FRESHDESK_RUNS: SyncRunRow[] = [
  {
    id: "fd-1",
    kind: "freshdesk",
    trigger_source: "cron",
    status: "success",
    customers_count: 0,
    transactions_count: 0,
    report_rows: 0,
    error_message: null,
    triggered_by_email: null,
    started_at: "2026-09-29T04:00:00Z",
    finished_at: "2026-09-29T04:01:00Z",
    duration_ms: 61000,
    fetched_count: 122,
    upserted_count: 27,
  },
  {
    id: "fd-2",
    kind: "freshdesk",
    trigger_source: "cron",
    status: "success",
    customers_count: 0,
    transactions_count: 0,
    report_rows: 0,
    error_message: null,
    triggered_by_email: null,
    started_at: "2026-09-29T03:00:00Z",
    finished_at: "2026-09-29T03:00:51Z",
    duration_ms: 51000,
    fetched_count: 118,
    upserted_count: 19,
  },
  {
    id: "fd-3",
    kind: "freshdesk",
    trigger_source: "cron",
    status: "error",
    customers_count: 0,
    transactions_count: 0,
    report_rows: 0,
    error_message: "Freshdesk timeout after 30s",
    triggered_by_email: null,
    started_at: "2026-09-29T02:00:00Z",
    finished_at: "2026-09-29T02:00:31Z",
    duration_ms: 31000,
    fetched_count: 0,
    upserted_count: 0,
  },
];

const EXAMPLE_SYNC_RUNS: SyncRunRow[] = [
  {
    id: "sn-1",
    kind: "snapshot",
    trigger_source: "manual",
    status: "success",
    customers_count: 14,
    transactions_count: 118,
    report_rows: 62,
    error_message: null,
    triggered_by_email: "admin.demo@mml.local",
    started_at: "2026-09-29T05:08:00Z",
    finished_at: "2026-09-29T05:08:15Z",
    duration_ms: 15000,
  },
  {
    id: "sn-2",
    kind: "snapshot",
    trigger_source: "cron",
    status: "success",
    customers_count: 14,
    transactions_count: 116,
    report_rows: 61,
    error_message: null,
    triggered_by_email: null,
    started_at: "2026-09-29T02:00:00Z",
    finished_at: "2026-09-29T02:00:12Z",
    duration_ms: 12000,
  },
  {
    id: "sn-3",
    kind: "snapshot",
    trigger_source: "cron",
    status: "error",
    customers_count: 14,
    transactions_count: 115,
    report_rows: 0,
    error_message: "Could not read report_snapshots: connection reset",
    triggered_by_email: null,
    started_at: "2026-09-28T02:00:00Z",
    finished_at: "2026-09-28T02:00:07Z",
    duration_ms: 7000,
  },
];

const EXAMPLE_SNAPSHOT_ROWS: SnapshotRow[] = [
  {
    id: "r1",
    year: 2026,
    month: 9,
    customer_name: "Cognizant",
    lab_name: "DevOps Pro",
    cloud_provider: "Azure",
    line_of_business: "Training",
    transactions_count: 8,
    total_users: 92,
    revenue: 348000,
    cost: 247500,
    profit: 100500,
    margin_pct: 28.9,
  },
  {
    id: "r2",
    year: 2026,
    month: 9,
    customer_name: "Infosys",
    lab_name: "Data Engineering",
    cloud_provider: "AWS",
    line_of_business: "Delivery",
    transactions_count: 6,
    total_users: 71,
    revenue: 264000,
    cost: 181200,
    profit: 82800,
    margin_pct: 31.4,
  },
  {
    id: "r3",
    year: 2026,
    month: 9,
    customer_name: "TCS",
    lab_name: "AI Foundations",
    cloud_provider: "Azure",
    line_of_business: "Training",
    transactions_count: 7,
    total_users: 84,
    revenue: 309000,
    cost: 219100,
    profit: 89900,
    margin_pct: 29.1,
  },
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

// §4.8, same as the Dashboard Freshdesk card: Healthy success, Last run failed warning.
const HEALTH_BADGE: Record<
  SyncHealth["state"],
  { label: string; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  ok: { label: "Healthy", variant: "success" },
  warning: { label: "Last run failed", variant: "warning" },
  failing: { label: "Failing", variant: "destructive" },
  stale: { label: "Stale", variant: "destructive" },
  never: { label: "No runs yet", variant: "outline" },
};

// SCRUM-74 (G-07) / SCRUM-72: Freshdesk sync health from sync_runs (kind = 'freshdesk').
function FreshdeskSyncCard({ runs, health }: { runs: SyncRunRow[]; health: SyncHealth }) {
  const badge = HEALTH_BADGE[health.state];
  const alerting = health.state === "failing" || health.state === "stale";
  const statePeriod = kpiPeriodFor("sync.state");
  const last24h = kpiPeriodFor("sync.last24h");
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <LifeBuoy className="size-4 shrink-0" /> Freshdesk ticket sync{" "}
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardTitle>
        <CardDescription>
          Hourly import of Cloud Labs tickets. An alert shows here after 2 failed runs in a row or 3
          hours without a successful run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {alerting && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>{health.message}</AlertTitle>
            {health.lastError && (
              <AlertDescription className="whitespace-pre-wrap font-mono text-xs">
                {health.lastError}
              </AlertDescription>
            )}
          </Alert>
        )}
        <KpiGrid inset className="xl:grid-cols-4">
          <SummaryKpi
            variant="inset"
            label="Last successful run"
            value={
              health.lastSuccessAt
                ? `${formatDistanceToNow(new Date(health.lastSuccessAt))} ago`
                : "Never"
            }
            period={statePeriod}
          />
          <SummaryKpi
            variant="inset"
            label="Failures in a row"
            value={String(health.consecutiveFailures)}
            period={statePeriod}
          />
          <SummaryKpi
            variant="inset"
            label="Runs"
            value={String(health.runsLast24h)}
            period={last24h}
          />
          <SummaryKpi
            variant="inset"
            label="Failed"
            value={String(health.failuresLast24h)}
            period={last24h}
          />
        </KpiGrid>
        {runs.length > 0 && (
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
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {format(new Date(r.started_at), "dd MMM yyyy HH:mm")}
                  </TableCell>
                  <TableCell>{r.trigger_source === "cron" ? "Schedule" : "Manual"}</TableCell>
                  <TableCell>
                    <Badge variant={runStatusVariant(r.status)}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.fetched_count ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.upserted_count ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </TableCell>
                  <TableCell
                    className="max-w-xs truncate text-xs text-muted-foreground"
                    title={r.error_message ?? ""}
                  >
                    {r.error_message ?? ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Run status badge (§4.8): success success, running warning, anything else destructive. */
function runStatusVariant(status: string): "success" | "warning" | "destructive" {
  if (status === "success") return "success";
  if (status === "running") return "warning";
  return "destructive";
}
