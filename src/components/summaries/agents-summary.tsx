// SCRUM-128 C6 (plan P19): the Agents page on the shared standard. Data shaping lives in
// agents-data.ts (moved verbatim; value pins in __tests__/cloud-ai-summaries-data.test.ts).
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bot, Inbox, Play } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { formatKpiPeriod, kpiPeriodFor } from "@/lib/kpi-period";
import { AGENTS, listAgents } from "@/lib/ai-command-center.functions";
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_SERIES,
  CHART_SERIES_BG,
  CHART_TOOLTIP,
} from "@/lib/chart-standard";
import { ErrorState, LoadingState } from "@/components/page-states";
import { ChartCard, ChartLegendRow } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import {
  EXAMPLE_AGENTS,
  EXAMPLE_INBOX,
  EXAMPLE_RUNS,
  buildAgentsSummary,
  formatRunStatus,
  type InboxRow,
  type RunRow,
} from "@/components/summaries/agents-data";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

/** Run status badge (plan §4.8): done = success, error = destructive, running = warning. */
function runStatusVariant(status: string): BadgeProps["variant"] {
  if (status === "done") return "success";
  if (status === "error") return "destructive";
  if (status === "running") return "warning";
  return "secondary";
}

export function AgentsSummary() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const listAgentsFn = useServerFn(listAgents);
  const { data, isLoading, isError, error, refetch } = useQuery({
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
      return buildAgentsSummary(agents, runsRows, inboxRows);
    },
  });

  if (isLoading) return <LoadingState thing="agents summary" />;
  if (isError || !data) {
    return <ErrorState thing="agents summary" error={error} onRetry={() => void refetch()} />;
  }
  const inboxPeriod = kpiPeriodFor("agents.inbox");
  const runsPeriod = kpiPeriodFor("agents.runs");
  const hasWorkloadData = data.byAgent.some((row) => row.proposals > 0 || row.pending > 0);

  return (
    <div className="space-y-4">
      <KpiGrid>
        <SummaryKpi
          period={kpiPeriodFor("agents.registry")}
          label="Agents"
          value={fmtNumber(data.totalAgents)}
        />
        <SummaryKpi period={runsPeriod} label="Runs" value={fmtNumber(data.totalRuns)} />
        <SummaryKpi period={inboxPeriod} label="Proposals" value={fmtNumber(data.totalProposals)} />
        <SummaryKpi period={inboxPeriod} label="Awaiting review" value={fmtNumber(data.pending)} />
        <SummaryKpi
          period={inboxPeriod}
          label="Confirmation rate"
          value={`${data.confirmationRate.toFixed(1)}%`}
        />
        <SummaryKpi
          period={inboxPeriod}
          label="Time to decision"
          value={`${data.avgDecisionHours.toFixed(1)} h`}
        />
      </KpiGrid>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.agents.map((agent) => (
          <Card key={agent.key} className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
                <Bot className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{agent.name}</span>
              </CardTitle>
              <CardDescription>{agent.blurb}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/ai-command-center/run-now" search={{ agent: agent.key }}>
                  <Play className="mr-1 size-3.5" aria-hidden /> Run now
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/ai-command-center/inbox" search={{ agent: agent.key }}>
                  <Inbox className="mr-1 size-3.5" aria-hidden /> Inbox
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Workload by agent" description={formatKpiPeriod(inboxPeriod)}>
          {hasWorkloadData ? (
            <div className="space-y-3">
              <ChartLegendRow
                items={[
                  { label: "Awaiting review", dotClass: CHART_SERIES_BG[0] },
                  { label: "Proposals", dotClass: CHART_SERIES_BG[1] },
                ]}
              />
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={data.byAgent}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="name" tick={CHART_AXIS_TICK} />
                  <YAxis tick={CHART_AXIS_TICK} allowDecimals={false} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Bar
                    dataKey="pending"
                    name="Awaiting review"
                    fill={CHART_SERIES[0]}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="proposals"
                    name="Proposals"
                    fill={CHART_SERIES[1]}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
        <ChartCard
          title="Runs per day by agent"
          description={`Last 7 days with runs · ${formatKpiPeriod(runsPeriod)}`}
        >
          {data.runsPerDay.length > 0 ? (
            <div className="space-y-3">
              <ChartLegendRow
                items={[
                  { label: "Generalist", dotClass: CHART_SERIES_BG[0] },
                  { label: "Support desk", dotClass: CHART_SERIES_BG[1] },
                  { label: "Cost / ADR", dotClass: CHART_SERIES_BG[2] },
                ]}
              />
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={data.runsPerDay}>
                  <CartesianGrid {...CHART_GRID} />
                  <XAxis dataKey="day" tick={CHART_AXIS_TICK} />
                  <YAxis tick={CHART_AXIS_TICK} allowDecimals={false} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Bar
                    dataKey="generalist"
                    name="Generalist"
                    fill={CHART_SERIES[0]}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="support"
                    name="Support desk"
                    fill={CHART_SERIES[1]}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="cost_adr"
                    name="Cost / ADR"
                    fill={CHART_SERIES[2]}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Proposal outcomes by agent" description={formatKpiPeriod(inboxPeriod)}>
          <ul className="space-y-2">
            {data.byAgent.map((agent) => (
              <li key={agent.key} className="rounded-md border border-border p-3">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium" title={agent.name}>
                    {agent.name}
                  </div>
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {fmtNumber(agent.proposals)} proposals
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  Confirmed {fmtNumber(agent.confirmed)} · Rejected {fmtNumber(agent.rejected)} ·
                  Pending {fmtNumber(agent.pending)}
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard
          title="Confirmation rate and time to decision"
          description={formatKpiPeriod(inboxPeriod)}
        >
          <ul className="space-y-2">
            {data.byAgent.map((agent) => (
              <li key={agent.key} className="rounded-md border border-border p-3">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium" title={agent.name}>
                    {agent.name}
                  </div>
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {agent.confirmationRate.toFixed(1)}%
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  Avg decision time: {agent.avgDecisionHours.toFixed(1)} h
                </div>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      <ChartCard
        title="Recent agent runs"
        description="Latest 10 runs"
        action={
          <Link
            to="/ai-command-center/audit"
            search={{ agent: undefined }}
            className="text-xs text-primary hover:underline"
          >
            View all →
          </Link>
        }
      >
        {data.recentRuns.length > 0 ? (
          <ul className="space-y-2">
            {data.recentRuns.map((run) => (
              <li key={run.id}>
                <Link
                  to="/ai-command-center/audit"
                  search={{ agent: run.agent_key as "generalist" | "support" | "cost_adr" }}
                  className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium">
                      {AGENTS.find((agent) => agent.key === run.agent_key)?.name ?? run.agent_key}
                    </div>
                    <Badge variant={runStatusVariant(run.status)} className="shrink-0">
                      {formatRunStatus(run.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(run.created_at).toLocaleString()} · Run {run.id}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <NoDataYet compact />
        )}
      </ChartCard>
    </div>
  );
}
