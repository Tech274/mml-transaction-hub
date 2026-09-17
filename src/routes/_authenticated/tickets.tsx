import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { RefreshCw, LifeBuoy, AlertTriangle, Eye, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getTicketsOverview, syncFreshdeskNow, type TicketRow } from "@/lib/freshdesk.functions";

export const Route = createFileRoute("/_authenticated/tickets")({
  component: TicketsPage,
  head: () => ({
    meta: [
      { title: "Support Tickets Dashboard | MakeMyLabs" },
      { name: "description", content: "Freshdesk support tickets synced into MakeMyLabs: status, priority, agent workload and ticket trends." },
      { property: "og:title", content: "Support Tickets Dashboard | MakeMyLabs" },
      { property: "og:description", content: "Freshdesk support tickets synced into MakeMyLabs: status, priority, agent workload and ticket trends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2, 173 58% 39%))", "hsl(var(--chart-3, 197 37% 24%))", "hsl(var(--chart-4, 43 74% 66%))", "hsl(var(--chart-5, 27 87% 67%))", "hsl(var(--muted-foreground))"];

function TicketsPage() {
  const qc = useQueryClient();
  const { hasAnyRole } = useAuth();
  const canSync = hasAnyRole(["admin", "ops_lead"]);
  const overviewFn = useServerFn(getTicketsOverview);
  const syncFn = useServerFn(syncFreshdeskNow);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [agent, setAgent] = useState("all");
  const [open, setOpen] = useState<TicketRow | null>(null);
  const [page, setPage] = useState(0);
  const perPage = 25;

  const overview = useQuery({ queryKey: ["freshdesk", "overview"], queryFn: () => overviewFn() });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: {} }),
    onSuccess: (r) => {
      if (r.status === "success") toast.success(`Synced ${r.upserted} tickets from Freshdesk`);
      else toast.error(r.error_message ?? "Freshdesk sync failed");
      qc.invalidateQueries({ queryKey: ["freshdesk"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Freshdesk sync failed"),
  });

  const d = overview.data;

  const filtered = useMemo(() => {
    const rows = d?.tickets ?? [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (priority !== "all" && r.priority !== priority) return false;
      if (agent !== "all" && (r.agent_name ?? "Unassigned") !== agent) return false;
      if (!needle) return true;
      return [r.subject, r.requester_name, r.requester_email, r.company_name, String(r.id)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [d, q, status, priority, agent]);

  const pageRows = filtered.slice(page * perPage, page * perPage + perPage);
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));

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
            {d && !d.connection.ok && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Freshdesk not connected</AlertTitle>
                <AlertDescription>{d.connection.message}</AlertDescription>
              </Alert>
            )}
            {d && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Stat label="Total tickets" value={d.total} />
                <Stat label="Open" value={d.counts.open} />
                <Stat label="Pending" value={d.counts.pending} />
                <Stat label="Resolved" value={d.counts.resolved} />
                <Stat label="Closed" value={d.counts.closed} />
                <Stat label="Overdue" value={d.counts.overdue} tone={d.counts.overdue > 0 ? "warn" : undefined} />
              </div>
            )}
          </CardContent>
        </Card>

        {d && d.total > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Tickets by status">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={d.by_status} dataKey="value" nameKey="name" outerRadius={90} label>
                    {d.by_status.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Tickets by priority">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={d.by_priority}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Top agents by ticket volume">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={d.by_agent} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Tickets created per month">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={d.by_month}>
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
            <CardTitle>All tickets</CardTitle>
            <CardDescription>{filtered.length.toLocaleString()} matching tickets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <Input
                placeholder="Search subject, requester, company, ID"
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
              />
              <FilterSelect label="Status" value={status} onChange={(v) => { setStatus(v); setPage(0); }} options={(d?.by_status ?? []).map((s) => s.name)} />
              <FilterSelect label="Priority" value={priority} onChange={(v) => { setPriority(v); setPage(0); }} options={(d?.by_priority ?? []).map((s) => s.name)} />
              <FilterSelect label="Agent" value={agent} onChange={(v) => { setAgent(v); setPage(0); }} options={(d?.by_agent ?? []).map((s) => s.name)} />
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
                        {d?.total ? "No tickets match these filters." : canSync ? "No tickets yet — use “Sync now” to pull them from Freshdesk." : "No tickets synced yet."}
                      </TableCell>
                    </TableRow>
                  )}
                  {pageRows.map((t) => (
                    <TableRow key={t.id}>
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
                        <Button variant="ghost" size="sm" onClick={() => setOpen(t)}>
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

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Ticket #{open?.id}</SheetTitle>
            <SheetDescription>{open?.subject ?? ""}</SheetDescription>
          </SheetHeader>
          {open && (
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status" value={open.status} />
                <Field label="Priority" value={open.priority} />
                <Field label="Type" value={open.type} />
                <Field label="Source" value={open.source} />
                <Field label="Requester" value={open.requester_name ?? open.requester_email} />
                <Field label="Email" value={open.requester_email} />
                <Field label="Company" value={open.company_name} />
                <Field label="Agent" value={open.agent_name ?? "Unassigned"} />
                <Field label="Group" value={open.group_name} />
                <Field label="Escalated" value={open.is_escalated ? "Yes" : "No"} />
                <Field label="Created" value={open.ticket_created_at ? format(new Date(open.ticket_created_at), "dd MMM yyyy HH:mm") : null} />
                <Field label="Due by" value={open.due_by ? format(new Date(open.due_by), "dd MMM yyyy HH:mm") : null} />
              </div>
              {open.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {open.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
                </div>
              )}
              {open.description_text && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Description</p>
                  <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{open.description_text}</p>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${tone === "warn" ? "text-destructive" : ""}`}>{value.toLocaleString()}</p>
    </div>
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
