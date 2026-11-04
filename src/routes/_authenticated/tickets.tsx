import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { pageDocumentTitle, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { ChartCard } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { LoadingState } from "@/components/page-states";
import { TablePagination, TableStateRow } from "@/components/data-table-parts";
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_TOOLTIP,
  PIE_SLICE_STROKE,
  chartSeriesColor,
} from "@/lib/chart-standard";
import { kpiPeriodFor } from "@/lib/kpi-period";
import {
  PRIORITY_RANK,
  type Quick,
  filterTickets,
  isOverdue,
  priorityQueue,
  ticketCounts,
  ticketSummaryMetrics,
  type TicketCounts,
} from "@/lib/tickets-summary";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  LifeBuoy,
  AlertTriangle,
  Eye,
  Loader2,
  CheckCircle2,
  X,
  UserCheck,
  History,
  Flame,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  getTicketsOverview,
  syncFreshdeskNow,
  getAgentDirectory,
  setMyAgentIdentity,
  getTicketHistory,
  resolveTicket,
  getTicketDescription,
  type TicketRow,
  type TicketsOverview,
} from "@/lib/freshdesk.functions";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { requireRouteRoles } from "@/lib/route-guard";
import { fmtNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tickets")({
  beforeLoad: requireRouteRoles("/tickets"),
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === "mine" ? ("mine" as const) : ("all" as const),
    quick: (
      ["all", "open", "pending", "resolved", "closed", "overdue", "escalated"] as const
    ).includes(search.quick as never)
      ? (search.quick as Quick)
      : ("all" as const),
  }),
  component: TicketsPage,

  head: () => ({
    meta: [
      { title: pageDocumentTitle("/tickets") },
      {
        name: "description",
        content:
          "Freshdesk support tickets synced into MakeMyLabs: status, priority, agent workload, agent queues and ticket resolution.",
      },
      { property: "og:title", content: pageDocumentTitle("/tickets") },
      {
        property: "og:description",
        content:
          "Freshdesk support tickets synced into MakeMyLabs: status, priority, agent workload, agent queues and ticket resolution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const STATUS_OPTIONS = [
  "Open",
  "Pending",
  "Waiting on Customer",
  "Waiting on Third Party",
  "Resolved",
  "Closed",
];
const QUICK_LABEL: Record<Quick, string> = {
  all: "All tickets",
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
  overdue: "Overdue",
  escalated: "Escalated",
};

const EXAMPLE_TICKETS: TicketRow[] = [
  {
    id: 5142,
    subject: "Unable to launch DevOps lab VM",
    status: "Open",
    priority: "High",
    type: "Incident",
    source: "Portal",
    requester_name: "Priya Menon",
    requester_email: "priya@cognizant.com",
    company_name: "Cognizant",
    agent_name: "Ritu Sharma",
    group_name: "Cloud Labs",
    tags: ["vm", "launch"],
    due_by: "2026-09-29T09:30:00Z",
    is_escalated: true,
    ticket_created_at: "2026-09-29T03:40:00Z",
    ticket_updated_at: "2026-09-29T04:50:00Z",
    synced_at: "2026-09-29T05:15:00Z",
  },
  {
    id: 5139,
    subject: "Seat quota mismatch in AI Foundations cohort",
    status: "Pending",
    priority: "Medium",
    type: "Service Request",
    source: "Email",
    requester_name: "Arun Das",
    requester_email: "arun@infosys.com",
    company_name: "Infosys",
    agent_name: "Ritu Sharma",
    group_name: "Cloud Labs",
    tags: ["quota"],
    due_by: "2026-09-29T13:00:00Z",
    is_escalated: false,
    ticket_created_at: "2026-09-28T15:12:00Z",
    ticket_updated_at: "2026-09-29T02:20:00Z",
    synced_at: "2026-09-29T05:15:00Z",
  },
  {
    id: 5131,
    subject: "Need invoice split by BU for private batch",
    status: "Waiting on Customer",
    priority: "Low",
    type: "Question",
    source: "Portal",
    requester_name: "Sanjay Rao",
    requester_email: "sanjay@tcs.com",
    company_name: "TCS",
    agent_name: "Nisha Patel",
    group_name: "Cloud Labs",
    tags: ["invoice"],
    due_by: "2026-09-30T10:00:00Z",
    is_escalated: false,
    ticket_created_at: "2026-09-28T08:10:00Z",
    ticket_updated_at: "2026-09-29T00:45:00Z",
    synced_at: "2026-09-29T05:15:00Z",
  },
  {
    id: 5128,
    subject: "Freshdesk webhook retry warnings",
    status: "Open",
    priority: "Urgent",
    type: "Incident",
    source: "Email",
    requester_name: "Platform Bot",
    requester_email: "alerts@mml.local",
    company_name: "MakeMyLabs",
    agent_name: "Amit Singh",
    group_name: "Platform Ops",
    tags: ["integration", "webhook"],
    due_by: "2026-09-29T07:00:00Z",
    is_escalated: true,
    ticket_created_at: "2026-09-28T04:42:00Z",
    ticket_updated_at: "2026-09-29T04:10:00Z",
    synced_at: "2026-09-29T05:15:00Z",
  },
  {
    id: 5124,
    subject: "Add learners to AKS lab after go-live",
    status: "Resolved",
    priority: "Medium",
    type: "Service Request",
    source: "Portal",
    requester_name: "Megha Iyer",
    requester_email: "megha@wipro.com",
    company_name: "Wipro",
    agent_name: "Ritu Sharma",
    group_name: "Cloud Labs",
    tags: ["learners"],
    due_by: "2026-09-28T12:00:00Z",
    is_escalated: false,
    ticket_created_at: "2026-09-27T17:20:00Z",
    ticket_updated_at: "2026-09-28T11:05:00Z",
    synced_at: "2026-09-29T05:15:00Z",
  },
  {
    id: 5116,
    subject: "Lab DNS issue in APAC region",
    status: "Closed",
    priority: "High",
    type: "Incident",
    source: "Email",
    requester_name: "Rahul Nair",
    requester_email: "rahul@hcl.com",
    company_name: "HCL",
    agent_name: "Nisha Patel",
    group_name: "Cloud Labs",
    tags: ["dns", "apac"],
    due_by: "2026-09-27T06:30:00Z",
    is_escalated: false,
    ticket_created_at: "2026-09-26T20:10:00Z",
    ticket_updated_at: "2026-09-27T06:10:00Z",
    synced_at: "2026-09-29T05:15:00Z",
  },
];

const EXAMPLE_TICKETS_OVERVIEW: TicketsOverview = {
  tickets: EXAMPLE_TICKETS,
  total: EXAMPLE_TICKETS.length,
  counts: { open: 3, pending: 1, resolved: 1, closed: 1, escalated: 2, overdue: 1 },
  by_status: [
    { name: "Open", value: 2 },
    { name: "Pending", value: 1 },
    { name: "Waiting on Customer", value: 1 },
    { name: "Resolved", value: 1 },
    { name: "Closed", value: 1 },
  ],
  by_priority: [
    { name: "Urgent", value: 1 },
    { name: "High", value: 2 },
    { name: "Medium", value: 2 },
    { name: "Low", value: 1 },
  ],
  by_agent: [
    { name: "Ritu Sharma", value: 3 },
    { name: "Nisha Patel", value: 2 },
    { name: "Amit Singh", value: 1 },
  ],
  by_group: [
    { name: "Cloud Labs", value: 5 },
    { name: "Platform Ops", value: 1 },
  ],
  by_month: [
    { month: "2026-06", value: 22 },
    { month: "2026-07", value: 27 },
    { month: "2026-08", value: 31 },
    { month: "2026-09", value: 34 },
  ],
  last_synced_at: "2026-09-29T05:15:00Z",
  connection: {
    ok: true,
    message: "Connected to Freshdesk sandbox",
    domain: "mml-helpdesk.freshdesk.com",
  },
  truncated: false,
};

const EXAMPLE_AGENT_DIRECTORY = {
  agents: [
    { id: 1401, name: "Ritu Sharma", email: "ritu.sharma@mml.local" },
    { id: 1402, name: "Nisha Patel", email: "nisha.patel@mml.local" },
    { id: 1403, name: "Amit Singh", email: "amit.singh@mml.local" },
  ],
  identity: { agent_name: "Ritu Sharma", agent_id: 1401, auto_matched: true },
};

function TicketsPage() {
  const qc = useQueryClient();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const { hasAnyRole } = useAuth();
  const canSync = hasAnyRole(["admin", "ops_lead"]);
  const canAct = hasAnyRole(["admin", "ops_lead", "ops_user"]);
  const overviewFn = useServerFn(getTicketsOverview);
  const syncFn = useServerFn(syncFreshdeskNow);
  const directoryFn = useServerFn(getAgentDirectory);

  const search = Route.useSearch();
  const [view, setView] = useState<"all" | "mine">(search.view);
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick>(search.quick);

  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [agent, setAgent] = useState("all");
  const [open, setOpen] = useState<TicketRow | null>(null);
  const [page, setPage] = useState(0);
  const perPage = 25;

  useEffect(() => {
    setView(search.view);
    setQuick(search.quick);
    setPage(0);
  }, [search.view, search.quick]);

  const overview = useQuery({
    queryKey: ["freshdesk", "overview"],
    queryFn: () => overviewFn(),
    enabled: !isExampleCaptureMode,
  });
  const directory = useQuery({
    queryKey: ["freshdesk", "agents"],
    queryFn: () => directoryFn(),
    enabled: !isExampleCaptureMode,
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: {} }),
    onSuccess: (r) => {
      if (r.status === "success") toast.success(`Synced ${r.upserted} tickets from Freshdesk`);
      else toast.error(r.error_message ?? "Freshdesk sync failed");
      qc.invalidateQueries({ queryKey: ["freshdesk"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Freshdesk sync failed"),
  });

  const d = isExampleCaptureMode ? EXAMPLE_TICKETS_OVERVIEW : overview.data;
  const directoryData = isExampleCaptureMode ? EXAMPLE_AGENT_DIRECTORY : directory.data;
  const myAgent = directoryData?.identity?.agent_name ?? null;

  const scoped = useMemo(() => {
    const rows = d?.tickets ?? [];
    if (view === "mine" && myAgent) return rows.filter((r) => r.agent_name === myAgent);
    return rows;
  }, [d, view, myAgent]);

  // SCRUM-128 C7: counts, filters and the queue moved verbatim to lib/tickets-summary.ts
  // (pinned by lib/__tests__/tickets-summary.test.ts).
  const counts = useMemo(() => ticketCounts(scoped), [scoped]);

  const filtered = useMemo(
    () => filterTickets(scoped, { q, quick, status, priority, agent }),
    [scoped, q, quick, status, priority, agent],
  );

  const queue = useMemo(() => priorityQueue(scoped), [scoped]);

  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));

  const pick = (nextQuick: Quick) => {
    setQuick(nextQuick);
    setStatus("all");
    setPage(0);
  };

  const statusOptions = useMemo(() => {
    const set = new Set(scoped.map((r) => r.status).filter(Boolean) as string[]);
    return [...set].sort();
  }, [scoped]);
  const priorityOptions = useMemo(() => {
    const set = new Set(scoped.map((r) => r.priority).filter(Boolean) as string[]);
    return [...set].sort((a, b) => (PRIORITY_RANK[a] ?? 4) - (PRIORITY_RANK[b] ?? 4));
  }, [scoped]);
  const agentOptions = useMemo(() => {
    const set = new Set(scoped.map((r) => r.agent_name ?? "Unassigned"));
    return [...set].sort();
  }, [scoped]);

  return (
    <AppShell {...pageShell("/tickets")}>
      <div className="space-y-4">
        <SupportTicketsSummary
          rows={scoped}
          counts={counts}
          canSync={canSync}
          syncPending={sync.isPending}
          onSyncNow={() => sync.mutate()}
        />

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-sm">
                <LifeBuoy className="size-4 shrink-0" /> Freshdesk tickets
              </CardTitle>
              <CardDescription>
                {d?.connection.ok ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckCircle2 className="size-3.5" /> Connected
                    {d.connection.domain ? ` to ${d.connection.domain}` : ""}
                  </span>
                ) : (
                  "Tickets are pulled from your Freshdesk helpdesk."
                )}
                {d?.last_synced_at && (
                  <> · last synced {formatDistanceToNow(new Date(d.last_synced_at))} ago</>
                )}
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => overview.refetch()}
                disabled={overview.isFetching}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1 ${overview.isFetching ? "animate-spin" : ""}`}
                />{" "}
                Refresh
              </Button>
              {canSync && (
                <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <LifeBuoy className="h-4 w-4 mr-1" />
                  )}
                  Sync now
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <AgentIdentityBar
              agents={directoryData?.agents ?? []}
              identity={directoryData?.identity ?? null}
              view={view}
              onView={(v) => {
                setView(v);
                setPage(0);
              }}
            />

            {overview.isLoading && <LoadingState thing="tickets" inCard />}
            {overview.isError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not load tickets</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {overview.error instanceof Error ? overview.error.message : "Unknown error"}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => overview.refetch()}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {d?.truncated && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Showing the newest 20,000 tickets only</AlertTitle>
                <AlertDescription>
                  Totals on this page cover those tickets. Server-side totals are the next SCRUM-94
                  step.
                </AlertDescription>
              </Alert>
            )}
            {d && !d.connection.ok && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Freshdesk not connected</AlertTitle>
                <AlertDescription>{d.connection.message}</AlertDescription>
              </Alert>
            )}
            {quick !== "all" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary" className="gap-1">
                  {QUICK_LABEL[quick]} filter is active
                  <button type="button" aria-label="Clear filter" onClick={() => pick("all")}>
                    <X className="size-3" />
                  </button>
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {view === "mine" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Flame className="size-4 shrink-0" /> My priority queue
              </CardTitle>
              <CardDescription>
                {myAgent
                  ? `Highest-priority open tickets assigned to ${myAgent}, overdue first.`
                  : "Choose which helpdesk agent you are to see your queue."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {queue.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing open in your queue right now.
                </p>
              )}
              {queue.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setOpen(t)}
                  className="flex w-full flex-col gap-2 rounded-md border border-border p-3 text-left hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      #{t.id} · {t.subject ?? "—"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.company_name ?? t.requester_name ?? "—"}
                      {t.due_by && <> · due {format(new Date(t.due_by), "dd MMM HH:mm")}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {isOverdue(t) && <Badge variant="destructive">Overdue</Badge>}
                    <Badge
                      variant={
                        t.priority === "Urgent" || t.priority === "High" ? "destructive" : "outline"
                      }
                    >
                      {t.priority ?? "—"}
                    </Badge>
                    <Badge variant="outline">{t.status ?? "—"}</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        <FilterBar>
          <FilterSearch
            label="Search tickets"
            placeholder="Search subject, requester, company, ID"
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(0);
            }}
          />
          <FilterSelect
            label="Status"
            value={status}
            width="md"
            onValueChange={(v) => {
              setStatus(v);
              setQuick("all");
              setPage(0);
            }}
            allLabel="All statuses"
            options={statusOptions.map((o) => ({ value: o, label: o }))}
          />
          <FilterSelect
            label="Priority"
            value={priority}
            width="md"
            onValueChange={(v) => {
              setPriority(v);
              setPage(0);
            }}
            allLabel="All priorities"
            options={priorityOptions.map((o) => ({ value: o, label: o }))}
          />
          <FilterSelect
            label="Agent"
            value={agent}
            onValueChange={(v) => {
              setAgent(v);
              setPage(0);
            }}
            allLabel="All agents"
            width="md"
            options={agentOptions.map((o) => ({ value: o, label: o }))}
          />
        </FilterBar>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {view === "mine" ? "My tickets" : "All tickets"}
            </CardTitle>
            <CardDescription>
              <span className="tabular-nums">{filtered.length.toLocaleString()}</span> matching
              tickets · click a row to open it
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.isLoading && !isExampleCaptureMode ? (
                  <TableStateRow colSpan={9}>Loading tickets…</TableStateRow>
                ) : overview.isError && !isExampleCaptureMode ? (
                  <TableStateRow colSpan={9} onRetry={() => overview.refetch()}>
                    Could not load tickets.
                  </TableStateRow>
                ) : (
                  pageRows.length === 0 && (
                    <TableStateRow colSpan={9}>
                      {counts.total
                        ? "No tickets match these filters."
                        : canSync
                          ? "No tickets yet — use “Sync now” to pull them from Freshdesk."
                          : "No tickets synced yet."}
                    </TableStateRow>
                  )
                )}
                {pageRows.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpen(t)}>
                    <TableCell className="font-mono text-xs tabular-nums">{t.id}</TableCell>
                    <TableCell className="max-w-72 truncate">{t.subject ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {t.requester_name ?? t.requester_email ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{t.company_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.status === "Open"
                            ? "default"
                            : t.status === "Pending"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {t.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.priority === "Urgent" || t.priority === "High"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {t.priority ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{t.agent_name ?? "Unassigned"}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {t.ticket_created_at
                        ? format(new Date(t.ticket_created_at), "dd MMM yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Open ticket ${t.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(t);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              page={page + 1}
              pageCount={pages}
              onPageChange={(p) => setPage(p - 1)}
            />
          </CardContent>
        </Card>
      </div>

      <TicketDetailSheet
        ticket={open}
        onClose={() => setOpen(null)}
        canAct={canAct}
        agents={directoryData?.agents ?? []}
      />
    </AppShell>
  );
}

function AgentIdentityBar({
  agents,
  identity,
  view,
  onView,
}: {
  agents: { id: number; name: string; email: string | null }[];
  identity: { agent_name: string; agent_id: number | null; auto_matched: boolean } | null;
  view: "all" | "mine";
  onView: (v: "all" | "mine") => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(setMyAgentIdentity);
  const save = useMutation({
    mutationFn: (name: string) => {
      const a = agents.find((x) => x.name === name);
      return saveFn({ data: { agentName: name, agentId: a?.id ?? null } });
    },
    onSuccess: () => {
      toast.success("Saved — your tickets will use this agent");
      qc.invalidateQueries({ queryKey: ["freshdesk", "agents"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <Tabs value={view} onValueChange={(v) => onView(v as "all" | "mine")}>
        <TabsList>
          <TabsTrigger value="all">All tickets</TabsTrigger>
          <TabsTrigger value="mine">My tickets</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
        <UserCheck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <FilterSelect
          label="I am"
          value={identity?.agent_name ?? ""}
          onValueChange={(v) => save.mutate(v)}
          width="md"
          placeholder={agents.length ? "Select your agent name" : "Agent list unavailable"}
          options={agents.map((a) => ({ value: a.name, label: a.name }))}
        />
        {identity?.auto_matched && (
          <Badge variant="secondary" className="shrink-0">
            matched by email
          </Badge>
        )}
      </div>
    </div>
  );
}

function TicketDetailSheet({
  ticket,
  onClose,
  canAct,
  agents,
}: {
  ticket: TicketRow | null;
  onClose: () => void;
  canAct: boolean;
  agents: { id: number; name: string; email: string | null }[];
}) {
  const qc = useQueryClient();
  const historyFn = useServerFn(getTicketHistory);
  const resolveFn = useServerFn(resolveTicket);

  const [assignee, setAssignee] = useState<string>("");
  const [nextStatus, setNextStatus] = useState<string>("");
  const [note, setNote] = useState("");

  const descriptionFn = useServerFn(getTicketDescription);
  // SCRUM-94: description is loaded only when a ticket is opened.
  const description = useQuery({
    queryKey: ["freshdesk", "description", ticket?.id],
    queryFn: () => descriptionFn({ data: { ticketId: ticket!.id } }),
    enabled: !!ticket,
    staleTime: 60_000,
  });

  const history = useQuery({
    queryKey: ["freshdesk", "history", ticket?.id],
    queryFn: () => historyFn({ data: { ticketId: ticket!.id } }),
    enabled: !!ticket,
  });

  const submit = useMutation({
    mutationFn: () => {
      const a = agents.find((x) => x.name === assignee);
      return resolveFn({
        data: {
          ticketId: ticket!.id,
          ...(assignee ? { agentId: a?.id ?? null, agentName: assignee } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(note.trim() ? { resolutionNote: note.trim() } : {}),
        },
      });
    },
    onSuccess: () => {
      toast.success("Ticket updated in Freshdesk");
      setAssignee("");
      setNextStatus("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["freshdesk"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the ticket"),
  });

  const nothingToDo = !assignee && !nextStatus && !note.trim();
  const closing = nextStatus === "Resolved" || nextStatus === "Closed";

  return (
    <Sheet open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Ticket #{ticket?.id}</SheetTitle>
          <SheetDescription>{ticket?.subject ?? ""}</SheetDescription>
        </SheetHeader>
        {ticket && (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="resolve">Resolve</TabsTrigger>
              <TabsTrigger value="timeline">
                <History className="mr-1 h-3.5 w-3.5" /> Timeline
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status" value={ticket.status} />
                <Field label="Priority" value={ticket.priority} />
                <Field label="Type" value={ticket.type} />
                <Field label="Source" value={ticket.source} />
                <Field label="Requester" value={ticket.requester_name ?? ticket.requester_email} />
                <Field label="Email" value={ticket.requester_email} />
                <Field label="Company" value={ticket.company_name} />
                <Field label="Agent" value={ticket.agent_name ?? "Unassigned"} />
                <Field label="Group" value={ticket.group_name} />
                <Field label="Escalated" value={ticket.is_escalated ? "Yes" : "No"} />
                <Field
                  label="Created"
                  value={
                    ticket.ticket_created_at
                      ? format(new Date(ticket.ticket_created_at), "dd MMM yyyy HH:mm")
                      : null
                  }
                />
                <Field
                  label="Due by"
                  value={
                    ticket.due_by ? format(new Date(ticket.due_by), "dd MMM yyyy HH:mm") : null
                  }
                />
              </div>
              {ticket.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ticket.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              {description.isLoading && (
                <p className="text-xs text-muted-foreground">Loading description…</p>
              )}
              {description.isError && (
                <p className="text-xs text-destructive">
                  Could not load the description:{" "}
                  {description.error instanceof Error ? description.error.message : "unknown error"}
                </p>
              )}
              {description.data?.description_text && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">
                    {description.data.description_text}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="resolve" className="space-y-4">
              {!canAct ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>View only</AlertTitle>
                  <AlertDescription>
                    Your role cannot change ticket assignment or status.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Assign to agent</Label>
                    <Select
                      value={assignee}
                      onValueChange={setAssignee}
                      disabled={agents.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={ticket.agent_name ?? "Unassigned"} />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.name}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Update status</Label>
                    <Select value={nextStatus} onValueChange={setNextStatus}>
                      <SelectTrigger>
                        <SelectValue placeholder={ticket.status ?? "Select a status"} />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{closing ? "Resolution note (required)" : "Note (optional)"}</Label>
                    <Textarea
                      rows={4}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What was done to resolve this ticket?"
                    />
                    <p className="text-xs text-muted-foreground">
                      Notes are added to the ticket in Freshdesk as a private note and recorded in
                      the audit log.
                    </p>
                  </div>
                  <Button
                    onClick={() => submit.mutate()}
                    disabled={submit.isPending || nothingToDo || (closing && !note.trim())}
                  >
                    {submit.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    {closing ? "Close ticket with note" : "Save changes"}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="space-y-3">
              {history.isLoading && <LoadingState thing="history" inCard />}
              {history.isError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Could not load history</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      {history.error instanceof Error ? history.error.message : "Unknown error"}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => history.refetch()}>
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {history.data && (
                <div className="space-y-3">
                  {history.data.actions.length === 0 && history.data.conversations.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No activity recorded for this ticket yet.
                    </p>
                  )}
                  {history.data.actions.map((a) => (
                    <div key={a.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary">{a.action.replace(/_/g, " ")}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(a.created_at), "dd MMM yyyy HH:mm")}
                        </span>
                      </div>
                      {a.field_name && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.field_name}: {a.old_value ?? "—"} → {a.new_value ?? "—"}
                        </p>
                      )}
                      {a.resolution_note && (
                        <p className="mt-1 whitespace-pre-wrap">{a.resolution_note}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        by {a.actor_email ?? "unknown"}
                      </p>
                    </div>
                  ))}
                  {history.data.conversations.length > 0 && <Separator />}
                  {history.data.conversations.map((c) => (
                    <div key={c.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">
                          {c.incoming
                            ? "Customer reply"
                            : c.private
                              ? "Private note"
                              : "Agent reply"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {c.created_at ? format(new Date(c.created_at), "dd MMM yyyy HH:mm") : "—"}
                        </span>
                      </div>
                      {c.from_email && (
                        <p className="mt-1 text-xs text-muted-foreground">{c.from_email}</p>
                      )}
                      {c.body_text && <p className="mt-1 whitespace-pre-wrap">{c.body_text}</p>}
                    </div>
                  ))}
                  {history.data.conversations_error && (
                    <p className="text-xs text-muted-foreground">
                      Freshdesk conversation history unavailable: {history.data.conversations_error}
                    </p>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}

function SupportTicketsSummary({
  rows,
  counts,
  canSync,
  syncPending,
  onSyncNow,
}: {
  rows: TicketRow[];
  counts: TicketCounts;
  canSync: boolean;
  syncPending: boolean;
  onSyncNow: () => void;
}) {
  // SCRUM-128 C7: every number comes from lib/tickets-summary.ts (moved verbatim, pinned by
  // lib/__tests__/tickets-summary.test.ts). Periods: kpi-period.ts tickets.* rules.
  const {
    resolvedLast7,
    closedLast7,
    dueResolvedCount,
    resolvedWithinDue,
    resolvedWithinDuePct,
    avgResolutionHours,
    dueTodayCount,
    dueThisWeekCount,
    byPriority,
    byAgent,
    byCustomer,
    weeklyTrend,
    recentActivity,
  } = ticketSummaryMetrics(rows);
  const nowPeriod = kpiPeriodFor("tickets.state");
  const last7Period = kpiPeriodFor("tickets.last7");
  const todayPeriod = kpiPeriodFor("tickets.dueToday");
  const statusTiles: { label: string; value: number; quick: Quick }[] = [
    { label: "Open", value: counts.open, quick: "open" },
    { label: "Pending", value: counts.pending, quick: "pending" },
    { label: "Overdue", value: counts.overdue, quick: "overdue" },
    { label: "Escalated", value: counts.escalated, quick: "escalated" },
    { label: "Resolved", value: counts.resolved, quick: "resolved" },
    { label: "Closed", value: counts.closed, quick: "closed" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-sm font-semibold">Summary</h2>
          <p className="text-sm text-muted-foreground">
            At-a-glance support health with one-click drill-downs into the list.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to="/tickets" search={{ quick: "all", view: "all" }}>
              Open full list
            </Link>
          </Button>
        </div>
      </div>

      <KpiGrid>
        {statusTiles.map((tile) => (
          <SummaryKpi
            key={tile.quick}
            label={tile.label}
            value={tile.value.toLocaleString()}
            period={nowPeriod}
            to="/tickets"
            search={{ quick: tile.quick, view: "all" }}
          />
        ))}
      </KpiGrid>

      <KpiGrid>
        <SummaryKpi
          label="Resolved recently"
          value={resolvedLast7.toLocaleString()}
          period={last7Period}
        />
        <SummaryKpi
          label="Closed recently"
          value={closedLast7.toLocaleString()}
          period={last7Period}
        />
        <SummaryKpi
          label="Avg resolution time"
          value={`${avgResolutionHours.toFixed(1)} h`}
          period={last7Period}
        />
        <SummaryKpi
          label="Resolved within due by"
          value={`${resolvedWithinDuePct}%`}
          period={last7Period}
          subline={`${resolvedWithinDue.toLocaleString()} of ${dueResolvedCount.toLocaleString()}`}
        />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Due-by status</CardTitle>
          </CardHeader>
          <CardContent>
            <KpiGrid inset>
              <SummaryKpi
                variant="inset"
                label="Overdue"
                value={counts.overdue.toLocaleString()}
                period={nowPeriod}
              />
              <SummaryKpi
                variant="inset"
                label="Due"
                value={dueTodayCount.toLocaleString()}
                period={todayPeriod}
              />
              <SummaryKpi
                variant="inset"
                label="Due in next 7 days"
                value={dueThisWeekCount.toLocaleString()}
                period={nowPeriod}
              />
            </KpiGrid>
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Freshdesk ticket sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              Keep support data current before review captures and triage actions.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canSync && (
                <Button size="sm" onClick={onSyncNow} disabled={syncPending}>
                  {syncPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                  Sync now
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                Sync now is available to Super Admin and Ops Lead.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Tickets by priority" description={`${fmtNumber(rows.length)} tickets`}>
          {byPriority.length === 0 ? (
            <NoDataYet />
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart>
                <Pie
                  data={byPriority}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={85}
                  innerRadius={54}
                  {...PIE_SLICE_STROKE}
                >
                  {byPriority.map((_, idx) => (
                    <Cell key={idx} fill={chartSeriesColor(idx)} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
                <Legend />
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-foreground text-xs font-semibold"
                >
                  {fmtNumber(rows.length)}
                </text>
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard title="Opened vs resolved (weekly)" description="Last 8 weeks">
          {rows.length === 0 ? (
            <NoDataYet />
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={weeklyTrend}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="week" tick={CHART_AXIS_TICK} />
                <YAxis tick={CHART_AXIS_TICK} allowDecimals={false} domain={[0, "auto"]} />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend />
                <Line
                  type="linear"
                  dataKey="opened"
                  name="Opened"
                  stroke={chartSeriesColor(0)}
                  strokeWidth={2}
                />
                <Line
                  type="linear"
                  dataKey="resolved"
                  name="Resolved/Closed"
                  stroke={chartSeriesColor(1)}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Recent ticket activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentActivity.length === 0 && <NoDataYet compact />}
            {recentActivity.map((ticket) => (
              <div
                key={ticket.id}
                className="w-full rounded-md border border-border px-3 py-2 text-left"
              >
                <div className="truncate text-sm font-medium">
                  #{ticket.id} · {ticket.subject ?? "—"}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {ticket.company_name ?? "Unknown"} · {ticket.status ?? "—"} ·{" "}
                  {ticket.priority ?? "—"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Tickets by agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byAgent.length === 0 && <NoDataYet compact />}
            {byAgent.map((entry) => (
              <Link
                key={entry.name}
                to="/tickets"
                search={{ quick: "all", view: "all" }}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/30"
              >
                <span className="truncate text-sm">{entry.name}</span>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {entry.value.toLocaleString()}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Tickets by customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byCustomer.length === 0 && <NoDataYet compact />}
            {byCustomer.map((entry) => (
              <Link
                key={entry.name}
                to="/tickets"
                search={{ quick: "all", view: "all" }}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-muted/30"
              >
                <span className="truncate text-sm">{entry.name}</span>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {entry.value.toLocaleString()}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
