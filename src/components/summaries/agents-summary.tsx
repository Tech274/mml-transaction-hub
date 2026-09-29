import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
} from "recharts";
import { AlertTriangle, Bot, Inbox, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { AGENTS, listAgents, type AgentSummary } from "@/lib/ai-command-center.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

type InboxRow = {
  id: string;
  agent_key: string;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
  decided_at: string | null;
};

type RunRow = {
  id: string;
  agent_key: string;
  status: string;
  created_at: string;
  finished_at: string | null;
};

const EXAMPLE_AGENTS: AgentSummary[] = [
  { key: "generalist", name: "Generalist (Lab Solution Guide)", blurb: "Drafts lab solution guides and response emails.", capabilities: [], status: "needs confirm", pending: 2, last_run_at: "2026-09-29T05:22:00Z", owns_email_draft: true },
  { key: "support", name: "Support desk", blurb: "Reviews open support tickets and drafts next actions.", capabilities: [], status: "running", pending: 3, last_run_at: "2026-09-29T05:31:00Z", owns_email_draft: true },
  { key: "cost_adr", name: "Cost / ADR entry", blurb: "Maps confirmed requests into ADR-ready field suggestions.", capabilities: [], status: "idle", pending: 1, last_run_at: "2026-09-29T04:55:00Z", owns_email_draft: false },
];

const EXAMPLE_RUNS: RunRow[] = [
  { id: "run-901", agent_key: "support", status: "done", created_at: "2026-09-29T05:31:00Z", finished_at: "2026-09-29T05:31:28Z" },
  { id: "run-902", agent_key: "generalist", status: "done", created_at: "2026-09-29T05:21:00Z", finished_at: "2026-09-29T05:21:35Z" },
  { id: "run-903", agent_key: "cost_adr", status: "done", created_at: "2026-09-29T04:55:00Z", finished_at: "2026-09-29T04:55:17Z" },
  { id: "run-904", agent_key: "support", status: "done", created_at: "2026-09-28T12:11:00Z", finished_at: "2026-09-28T12:11:19Z" },
];

const EXAMPLE_INBOX: InboxRow[] = [
  { id: "inb-1", agent_key: "support", status: "pending", created_at: "2026-09-29T05:31:14Z", decided_at: null },
  { id: "inb-2", agent_key: "support", status: "confirmed", created_at: "2026-09-29T05:11:14Z", decided_at: "2026-09-29T05:15:14Z" },
  { id: "inb-3", agent_key: "generalist", status: "confirmed", created_at: "2026-09-29T04:41:14Z", decided_at: "2026-09-29T04:45:14Z" },
  { id: "inb-4", agent_key: "cost_adr", status: "rejected", created_at: "2026-09-29T04:21:14Z", decided_at: "2026-09-29T04:32:14Z" },
  { id: "inb-5", agent_key: "generalist", status: "pending", created_at: "2026-09-29T03:41:14Z", decided_at: null },
  { id: "inb-6", agent_key: "cost_adr", status: "pending", created_at: "2026-09-29T02:51:14Z", decided_at: null },
];

function formatRunStatus(status: string): string {
  const map: Record<string, string> = {
    done: "Completed",
    running: "Running",
    error: "Failed",
    pending: "Pending",
  };
  return map[status] ?? status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AgentsSummary() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const listAgentsFn = useServerFn(listAgents);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["agents-summary-v1"],
    queryFn: async () => {
      const [agents, runsRows, inboxRows] = isExampleCaptureMode
        ? [EXAMPLE_AGENTS, EXAMPLE_RUNS, EXAMPLE_INBOX]
        : await Promise.all([
            listAgentsFn(),
            supabase
              .from("ai_cc_runs")
              .select("id,agent_key,status,created_at,finished_at")
              .order("created_at", { ascending: false })
              .limit(300)
              .then((r) => (r.data ?? []) as RunRow[]),
            supabase
              .from("ai_cc_inbox")
              .select("id,agent_key,status,created_at,decided_at")
              .order("created_at", { ascending: false })
              .limit(500)
              .then((r) => (r.data ?? []) as InboxRow[]),
          ]);

      const runs = runsRows as RunRow[];
      const inbox = inboxRows as InboxRow[];
      const activeAgents = (agents as AgentSummary[]).length;
      const pending = inbox.filter((row) => row.status === "pending").length;
      const confirmed = inbox.filter((row) => row.status === "confirmed").length;
      const rejected = inbox.filter((row) => row.status === "rejected").length;
      const decided = confirmed + rejected;
      const confirmationRate = decided > 0 ? (confirmed / decided) * 100 : 0;

      const decisionDurations: number[] = [];
      for (const row of inbox) {
        if (!row.decided_at) continue;
        decisionDurations.push(new Date(row.decided_at).getTime() - new Date(row.created_at).getTime());
      }
      const avgDecisionHours =
        decisionDurations.length === 0
          ? 0
          : decisionDurations.reduce((sum, value) => sum + value, 0) / decisionDurations.length / (1000 * 60 * 60);

      const byAgent = AGENTS.map((agent) => {
        const agentRuns = runs.filter((row) => row.agent_key === agent.key);
        const agentInbox = inbox.filter((row) => row.agent_key === agent.key);
        const agentConfirmed = agentInbox.filter((row) => row.status === "confirmed").length;
        const agentRejected = agentInbox.filter((row) => row.status === "rejected").length;
        const agentPending = agentInbox.filter((row) => row.status === "pending").length;
        const agentDecided = agentConfirmed + agentRejected;
        const agentDurations = agentInbox
          .filter((row) => row.decided_at)
          .map((row) => new Date(row.decided_at as string).getTime() - new Date(row.created_at).getTime());
        return {
          key: agent.key,
          name: agent.name,
          runs: agentRuns.length,
          proposals: agentInbox.length,
          pending: agentPending,
          confirmed: agentConfirmed,
          rejected: agentRejected,
          confirmationRate: agentDecided > 0 ? Number(((agentConfirmed / agentDecided) * 100).toFixed(1)) : 0,
          avgDecisionHours:
            agentDurations.length > 0
              ? Number((agentDurations.reduce((sum, value) => sum + value, 0) / agentDurations.length / (1000 * 60 * 60)).toFixed(1))
              : 0,
        };
      });

      const runsPerDayMap = new Map<string, Record<string, number>>();
      for (const run of runs.slice(0, 200)) {
        const day = run.created_at.slice(0, 10);
        const bucket = runsPerDayMap.get(day) ?? { generalist: 0, support: 0, cost_adr: 0 };
        if (run.agent_key in bucket) bucket[run.agent_key as keyof typeof bucket] += 1;
        runsPerDayMap.set(day, bucket);
      }
      const runsPerDay = [...runsPerDayMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-7)
        .map(([day, counts]) => ({ day, ...counts }));

      return {
        agents: agents as AgentSummary[],
        byAgent,
        runsPerDay,
        recentRuns: runs.slice(0, 10),
        activeAgents,
        totalAgents: AGENTS.length,
        totalRuns: runs.length,
        totalProposals: inbox.length,
        pending,
        confirmationRate,
        avgDecisionHours,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading agents summary…</CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load Agents summary</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
      </Alert>
    );
  }
  const hasWorkloadData = data.byAgent.some((row) => row.proposals > 0 || row.pending > 0);
  const hasRunsPerDayData = data.runsPerDay.length > 0;
  const hasRecentRuns = data.recentRuns.length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
        <strong>Active agents: {fmtNumber(data.activeAgents)} of {fmtNumber(data.totalAgents)}</strong>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SummaryKpi label="Active agents" value={`${fmtNumber(data.activeAgents)} of ${fmtNumber(data.totalAgents)}`} />
        <SummaryKpi label="Runs" value={fmtNumber(data.totalRuns)} />
        <SummaryKpi label="Proposals" value={fmtNumber(data.totalProposals)} />
        <SummaryKpi label="Awaiting review" value={fmtNumber(data.pending)} />
        <SummaryKpi label="Confirmation rate" value={`${data.confirmationRate.toFixed(1)}%`} />
        <SummaryKpi label="Time to decision" value={`${data.avgDecisionHours.toFixed(1)} h`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {data.agents.map((agent) => (
          <Card key={agent.key} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" /> {agent.name}
              </CardTitle>
              <CardDescription>{agent.blurb}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex gap-2">
              <Button asChild size="sm">
                <Link to="/ai-command-center/run-now" search={{ agent: agent.key }}>
                  <Play className="h-3.5 w-3.5 mr-1" /> Run now
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/ai-command-center/inbox" search={{ agent: agent.key }}>
                  <Inbox className="h-3.5 w-3.5 mr-1" /> Inbox
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Workload by agent">
          {hasWorkloadData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data.byAgent}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="pending" name="Awaiting review" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="proposals" name="Proposals" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
        <ChartCard title="Runs per day by agent">
          {hasRunsPerDayData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={data.runsPerDay}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="generalist" name="Generalist" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="support" name="Support desk" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost_adr" name="Cost / ADR" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Proposal outcomes by agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byAgent.map((agent) => (
              <div key={agent.key} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{agent.name}</div>
                  <Badge variant="outline">{fmtNumber(agent.proposals)} proposals</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Confirmed {fmtNumber(agent.confirmed)} · Rejected {fmtNumber(agent.rejected)} · Pending{" "}
                  {fmtNumber(agent.pending)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Confirmation rate and time to decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.byAgent.map((agent) => (
              <div key={agent.key} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{agent.name}</div>
                  <Badge variant="outline">{agent.confirmationRate.toFixed(1)}%</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Avg decision time: {agent.avgDecisionHours.toFixed(1)} h
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent agent runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {hasRecentRuns ? (
            data.recentRuns.map((run) => (
              <Link
                key={run.id}
                to="/ai-command-center/audit"
                search={{ agent: run.agent_key as "generalist" | "support" | "cost_adr" }}
                className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {AGENTS.find((agent) => agent.key === run.agent_key)?.name ?? run.agent_key}
                  </div>
                  <Badge variant={run.status === "done" ? "default" : run.status === "error" ? "destructive" : "secondary"}>
                    {formatRunStatus(run.status)}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(run.created_at).toLocaleString()} · Run {run.id}
                </div>
              </Link>
            ))
          ) : (
            <NoDataYet compact />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NoDataYet({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`grid w-full place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground ${
        compact ? "min-h-[96px]" : "min-h-[260px]"
      }`}
    >
      No data yet
    </div>
  );
}

function SummaryKpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
