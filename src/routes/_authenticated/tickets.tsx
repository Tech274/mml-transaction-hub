import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { RefreshCw, LifeBuoy, AlertTriangle, Eye, Loader2, CheckCircle2, X, UserCheck, History, Flame } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  getTicketsOverview, syncFreshdeskNow, getAgentDirectory, setMyAgentIdentity,
  getTicketHistory, resolveTicket, getTicketDescription, type TicketRow, type TicketsOverview,
} from "@/lib/freshdesk.functions";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/tickets")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === "mine" ? ("mine" as const) : ("all" as const),
    quick: (["all", "open", "pending", "resolved", "closed", "overdue", "escalated"] as const).includes(
      search.quick as never,
    )
      ? (search.quick as Quick)
      : ("all" as const),
  }),
  component: TicketsPage,

  head: () => ({
    meta: [
      { title: "Support Tickets Dashboard | MakeMyLabs" },
      { name: "description", content: "Freshdesk support tickets synced into MakeMyLabs: status, priority, agent workload, agent queues and ticket resolution." },
      { property: "og:title", content: "Support Tickets Dashboard | MakeMyLabs" },
      { property: "og:description", content: "Freshdesk support tickets synced into MakeMyLabs: status, priority, agent workload, agent queues and ticket resolution." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--muted-foreground))",
];

const OPEN_LIKE = ["Open", "Waiting on Customer", "Waiting on Third Party"];
const STATUS_OPTIONS = ["Open", "Pending", "Waiting on Customer", "Waiting on Third Party", "Resolved", "Closed"];
const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

type Quick = "all" | "open" | "pending" | "resolved" | "closed" | "overdue" | "escalated";

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
  { id: 5142, subject: "Unable to launch DevOps lab VM", status: "Open", priority: "High", type: "Incident", source: "Portal", requester_name: "Priya Menon", requester_email: "priya@cognizant.com", company_name: "Cognizant", agent_name: "Ritu Sharma", group_name: "Cloud Labs", tags: ["vm", "launch"], due_by: "2026-09-29T09:30:00Z", is_escalated: true, ticket_created_at: "2026-09-29T03:40:00Z", ticket_updated_at: "2026-09-29T04:50:00Z", synced_at: "2026-09-29T05:15:00Z" },
  { id: 5139, subject: "Seat quota mismatch in AI Foundations cohort", status: "Pending", priority: "Medium", type: "Service Request", source: "Email", requester_name: "Arun Das", requester_email: "arun@infosys.com", company_name: "Infosys", agent_name: "Ritu Sharma", group_name: "Cloud Labs", tags: ["quota"], due_by: "2026-09-29T13:00:00Z", is_escalated: false, ticket_created_at: "2026-09-28T15:12:00Z", ticket_updated_at: "2026-09-29T02:20:00Z", synced_at: "2026-09-29T05:15:00Z" },
  { id: 5131, subject: "Need invoice split by BU for private batch", status: "Waiting on Customer", priority: "Low", type: "Question", source: "Portal", requester_name: "Sanjay Rao", requester_email: "sanjay@tcs.com", company_name: "TCS", agent_name: "Nisha Patel", group_name: "Cloud Labs", tags: ["invoice"], due_by: "2026-09-30T10:00:00Z", is_escalated: false, ticket_created_at: "2026-09-28T08:10:00Z", ticket_updated_at: "2026-09-29T00:45:00Z", synced_at: "2026-09-29T05:15:00Z" },
  { id: 5128, subject: "Freshdesk webhook retry warnings", status: "Open", priority: "Urgent", type: "Incident", source: "Email", requester_name: "Platform Bot", requester_email: "alerts@mml.local", company_name: "MakeMyLabs", agent_name: "Amit Singh", group_name: "Platform Ops", tags: ["integration", "webhook"], due_by: "2026-09-29T07:00:00Z", is_escalated: true, ticket_created_at: "2026-09-28T04:42:00Z", ticket_updated_at: "2026-09-29T04:10:00Z", synced_at: "2026-09-29T05:15:00Z" },
  { id: 5124, subject: "Add learners to AKS lab after go-live", status: "Resolved", priority: "Medium", type: "Service Request", source: "Portal", requester_name: "Megha Iyer", requester_email: "megha@wipro.com", company_name: "Wipro", agent_name: "Ritu Sharma", group_name: "Cloud Labs", tags: ["learners"], due_by: "2026-09-28T12:00:00Z", is_escalated: false, ticket_created_at: "2026-09-27T17:20:00Z", ticket_updated_at: "2026-09-28T11:05:00Z", synced_at: "2026-09-29T05:15:00Z" },
  { id: 5116, subject: "Lab DNS issue in APAC region", status: "Closed", priority: "High", type: "Incident", source: "Email", requester_name: "Rahul Nair", requester_email: "rahul@hcl.com", company_name: "HCL", agent_name: "Nisha Patel", group_name: "Cloud Labs", tags: ["dns", "apac"], due_by: "2026-09-27T06:30:00Z", is_escalated: false, ticket_created_at: "2026-09-26T20:10:00Z", ticket_updated_at: "2026-09-27T06:10:00Z", synced_at: "2026-09-29T05:15:00Z" },
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
  connection: { ok: true, message: "Connected to Freshdesk sandbox", domain: "mml-helpdesk.freshdesk.com" },
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

function isOverdue(t: TicketRow) {
  return !!t.due_by && new Date(t.due_by).getTime() < Date.now() && !["Resolved", "Closed"].includes(t.status ?? "");
}

function matchesQuick(t: TicketRow, quick: Quick) {
  switch (quick) {
    case "all": return true;
    case "open": return OPEN_LIKE.includes(t.status ?? "");
    case "pending": return t.status === "Pending";
    case "resolved": return t.status === "Resolved";
    case "closed": return t.status === "Closed";
    case "escalated": return t.is_escalated;
    case "overdue": return isOverdue(t);
  }
}

function TicketsPage() {
  const qc = useQueryClient();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
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

  const counts = useMemo(() => ({
    total: scoped.length,
    open: scoped.filter((r) => OPEN_LIKE.includes(r.status ?? "")).length,
    pending: scoped.filter((r) => r.status === "Pending").length,
    resolved: scoped.filter((r) => r.status === "Resolved").length,
    closed: scoped.filter((r) => r.status === "Closed").length,
    overdue: scoped.filter(isOverdue).length,
    escalated: scoped.filter((r) => r.is_escalated).length,
  }), [scoped]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((r) => {
      if (!matchesQuick(r, quick)) return false;
      if (status !== "all" && r.status !== status) return false;
      if (priority !== "all" && r.priority !== priority) return false;
      if (agent !== "all" && (r.agent_name ?? "Unassigned") !== agent) return false;
      if (!needle) return true;
      return [r.subject, r.requester_name, r.requester_email, r.company_name, String(r.id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [scoped, q, quick, status, priority, agent]);

  const queue = useMemo(
    () =>
      scoped
        .filter((r) => !["Resolved", "Closed"].includes(r.status ?? ""))
        .sort((a, b) => {
          const pa = PRIORITY_RANK[a.priority ?? ""] ?? 4;
          const pb = PRIORITY_RANK[b.priority ?? ""] ?? 4;
          if (pa !== pb) return pa - pb;
          const oa = isOverdue(a) ? 0 : 1;
          const ob = isOverdue(b) ? 0 : 1;
          if (oa !== ob) return oa - ob;
          return (a.due_by ?? a.ticket_created_at ?? "").localeCompare(b.due_by ?? b.ticket_created_at ?? "");
        })
        .slice(0, 10),
    [scoped],
  );

  const charts = useMemo(() => {
    const tally = (pick: (r: TicketRow) => string | null | undefined) => {
      const m = new Map<string, number>();
      for (const r of scoped) {
        const k = pick(r) || "Unassigned";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    };
    const months = new Map<string, number>();
    for (const r of scoped) {
      if (!r.ticket_created_at) continue;
      const dt = new Date(r.ticket_created_at);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
      months.set(key, (months.get(key) ?? 0) + 1);
    }
    return {
      by_status: tally((r) => r.status),
      by_priority: tally((r) => r.priority),
      by_agent: tally((r) => r.agent_name).slice(0, 10),
      by_month: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([month, value]) => ({ month, value })),
    };
  }, [scoped]);

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
    <AppShell title="Support tickets">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="h-5 w-5" /> Freshdesk tickets
              </CardTitle>
              <CardDescription>
                {d?.connection.ok ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connected{d.connection.domain ? ` to ${d.connection.domain}` : ""}
                  </span>
                ) : (
                  "Tickets are pulled from your Freshdesk helpdesk."
                )}
                {d?.last_synced_at && (
                  <> · last synced {formatDistanceToNow(new Date(d.last_synced_at))} ago</>
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => overview.refetch()} disabled={overview.isFetching}>
                <RefreshCw className={`h-4 w-4 mr-1 ${overview.isFetching ? "animate-spin" : ""}`} /> Refresh
              </Button>
              {canSync && (
                <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
                  {sync.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <LifeBuoy className="h-4 w-4 mr-1" />}
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
              onView={(v) => { setView(v); setPage(0); }}
            />

            {overview.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading tickets…
              </div>
            )}
            {overview.isError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Could not load tickets</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{overview.error instanceof Error ? overview.error.message : "Unknown error"}</p>
                  <Button size="sm" variant="outline" onClick={() => overview.refetch()}>Retry</Button>
                </AlertDescription>
              </Alert>
            )}
            {d?.truncated && (
              <Alert variant="destructive" className="mb-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Showing the newest 20,000 tickets only</AlertTitle>
                <AlertDescription>Totals on this page cover those tickets. Server-side totals are the next SCRUM-94 step.</AlertDescription>
              </Alert>
            )}
            {d && !d.connection.ok && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Freshdesk not connected</AlertTitle>
                <AlertDescription>{d.connection.message}</AlertDescription>
              </Alert>
            )}
            {d && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Stat label="Total tickets" value={counts.total} active={quick === "all"} onClick={() => pick("all")} />
                <Stat label="Open" value={counts.open} active={quick === "open"} onClick={() => pick("open")} />
                <Stat label="Pending" value={counts.pending} active={quick === "pending"} onClick={() => pick("pending")} />
                <Stat label="Resolved" value={counts.resolved} active={quick === "resolved"} onClick={() => pick("resolved")} />
                <Stat label="Closed" value={counts.closed} active={quick === "closed"} onClick={() => pick("closed")} />
                <Stat
                  label="Overdue"
                  value={counts.overdue}
                  tone={counts.overdue > 0 ? "warn" : undefined}
                  active={quick === "overdue"}
                  onClick={() => pick("overdue")}
                />
              </div>
            )}
            {quick !== "all" && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" className="gap-1">
                  {QUICK_LABEL[quick]} only
                  <button aria-label="Clear filter" onClick={() => pick("all")}><X className="h-3 w-3" /></button>
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {view === "mine" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Flame className="h-4 w-4" /> My priority queue
              </CardTitle>
              <CardDescription>
                {myAgent
                  ? `Highest-priority open tickets assigned to ${myAgent}, overdue first.`
                  : "Choose which helpdesk agent you are to see your queue."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {queue.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing open in your queue right now.</p>
              )}
              {queue.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOpen(t)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">#{t.id} · {t.subject ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t.company_name ?? t.requester_name ?? "—"}
                      {t.due_by && <> · due {format(new Date(t.due_by), "dd MMM HH:mm")}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isOverdue(t) && <Badge variant="destructive">Overdue</Badge>}
                    <Badge variant={t.priority === "Urgent" || t.priority === "High" ? "destructive" : "outline"}>
                      {t.priority ?? "—"}
                    </Badge>
                    <Badge variant="outline">{t.status ?? "—"}</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {d && counts.total > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Tickets by status">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={charts.by_status} dataKey="value" nameKey="name" outerRadius={90} label>
                    {charts.by_status.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Tickets by priority">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={charts.by_priority}
                  onClick={(e: { activeLabel?: string }) => {
                    if (e?.activeLabel) { setQuick("all"); setPriority(e.activeLabel); setPage(0); }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Top agents by ticket volume">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={charts.by_agent}
                  layout="vertical"
                  onClick={(e: { activeLabel?: string }) => {
                    if (e?.activeLabel) { setQuick("all"); setAgent(e.activeLabel); setPage(0); }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Tickets created per month">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={charts.by_month}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{view === "mine" ? "My tickets" : "All tickets"}</CardTitle>
            <CardDescription>{filtered.length.toLocaleString()} matching tickets · click a row to open it</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <Input
                placeholder="Search subject, requester, company, ID"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
              />
              <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setQuick("all"); setPage(0); }} options={statusOptions} />
              <FilterSelect label="Priority" value={priority} onChange={(v) => { setPriority(v); setPage(0); }} options={priorityOptions} />
              <FilterSelect label="Agent" value={agent} onChange={(v) => { setAgent(v); setPage(0); }} options={agentOptions} />
            </div>
            <div className="overflow-x-auto">
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
                  {pageRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        {counts.total ? "No tickets match these filters." : canSync ? "No tickets yet — use “Sync now” to pull them from Freshdesk." : "No tickets synced yet."}
                      </TableCell>
                    </TableRow>
                  )}
                  {pageRows.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => setOpen(t)}>
                      <TableCell className="font-mono text-xs">{t.id}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{t.subject ?? "—"}</TableCell>
                      <TableCell className="text-xs">{t.requester_name ?? t.requester_email ?? "—"}</TableCell>
                      <TableCell className="text-xs">{t.company_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={t.status === "Open" ? "default" : t.status === "Pending" ? "secondary" : "outline"}>
                          {t.status ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.priority === "Urgent" || t.priority === "High" ? "destructive" : "outline"}>
                          {t.priority ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{t.agent_name ?? "Unassigned"}</TableCell>
                      <TableCell className="text-xs">
                        {t.ticket_created_at ? format(new Date(t.ticket_created_at), "dd MMM yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setOpen(t); }}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
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
  agents, identity, view, onView,
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <Tabs value={view} onValueChange={(v) => onView(v as "all" | "mine")}>
        <TabsList>
          <TabsTrigger value="all">All tickets</TabsTrigger>
          <TabsTrigger value="mine">My tickets</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="ml-auto flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <UserCheck className="h-3.5 w-3.5" /> I am
        </span>
        <Select value={identity?.agent_name ?? ""} onValueChange={(v) => save.mutate(v)} disabled={agents.length === 0}>
          <SelectTrigger className="h-8 w-[220px]">
            <SelectValue placeholder={agents.length ? "Select your agent name" : "Agent list unavailable"} />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {identity?.auto_matched && <Badge variant="secondary">matched by email</Badge>}
      </div>
    </div>
  );
}

function TicketDetailSheet({
  ticket, onClose, canAct, agents,
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
      setAssignee(""); setNextStatus(""); setNote("");
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
                <Field label="Created" value={ticket.ticket_created_at ? format(new Date(ticket.ticket_created_at), "dd MMM yyyy HH:mm") : null} />
                <Field label="Due by" value={ticket.due_by ? format(new Date(ticket.due_by), "dd MMM yyyy HH:mm") : null} />
              </div>
              {ticket.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {ticket.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              )}
              {description.isLoading && (
                <p className="text-xs text-muted-foreground">Loading description…</p>
              )}
              {description.isError && (
                <p className="text-xs text-destructive">
                  Could not load the description: {description.error instanceof Error ? description.error.message : "unknown error"}
                </p>
              )}
              {description.data?.description_text && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{description.data.description_text}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="resolve" className="space-y-4">
              {!canAct ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>View only</AlertTitle>
                  <AlertDescription>Your role cannot change ticket assignment or status.</AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Assign to agent</Label>
                    <Select value={assignee} onValueChange={setAssignee} disabled={agents.length === 0}>
                      <SelectTrigger>
                        <SelectValue placeholder={ticket.agent_name ?? "Unassigned"} />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Update status</Label>
                    <Select value={nextStatus} onValueChange={setNextStatus}>
                      <SelectTrigger><SelectValue placeholder={ticket.status ?? "Select a status"} /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                      Notes are added to the ticket in Freshdesk as a private note and recorded in the audit log.
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
              {history.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
                </div>
              )}
              {history.isError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Could not load history</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>{history.error instanceof Error ? history.error.message : "Unknown error"}</p>
                    <Button size="sm" variant="outline" onClick={() => history.refetch()}>Retry</Button>
                  </AlertDescription>
                </Alert>
              )}
              {history.data && (
                <div className="space-y-3">
                  {history.data.actions.length === 0 && history.data.conversations.length === 0 && (
                    <p className="text-sm text-muted-foreground">No activity recorded for this ticket yet.</p>
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
                      {a.resolution_note && <p className="mt-1 whitespace-pre-wrap">{a.resolution_note}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">by {a.actor_email ?? "unknown"}</p>
                    </div>
                  ))}
                  {history.data.conversations.length > 0 && <Separator />}
                  {history.data.conversations.map((c) => (
                    <div key={c.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline">{c.incoming ? "Customer reply" : c.private ? "Private note" : "Agent reply"}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {c.created_at ? format(new Date(c.created_at), "dd MMM yyyy HH:mm") : "—"}
                        </span>
                      </div>
                      {c.from_email && <p className="mt-1 text-xs text-muted-foreground">{c.from_email}</p>}
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

function Stat({
  label, value, tone, active, onClick,
}: { label: string; value: number; tone?: "warn"; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${active ? "border-primary ring-1 ring-primary" : ""}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${tone === "warn" ? "text-destructive" : ""}`}>{value.toLocaleString()}</p>
    </button>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
      </SelectContent>
    </Select>
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
