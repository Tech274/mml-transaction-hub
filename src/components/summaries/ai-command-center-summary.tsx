// SCRUM-128 C6 (plan P18): the AI Command Center summary on the shared standard. Data shaping
// lives in ai-command-center-data.ts (moved verbatim; value pins in
// __tests__/cloud-ai-summaries-data.test.ts). The page description is the AppShell description.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { formatKpiPeriod, kpiPeriodFor } from "@/lib/kpi-period";
import { AGENTS, type AgentKey } from "@/lib/ai-command-center.functions";
import {
  CHART_AXIS_TICK,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_SERIES,
  CHART_TOOLTIP,
  PIE_SLICE_STROKE,
  chartSeriesBg,
  chartSeriesColor,
} from "@/lib/chart-standard";
import { ErrorState, LoadingState } from "@/components/page-states";
import { ChartCard, ChartLegendRow } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import {
  EXAMPLE_AUDIT,
  EXAMPLE_INBOX,
  EXAMPLE_RUNS,
  buildAiccSummary,
  formatItemType,
  type AuditRow,
  type InboxRow,
  type RunRow,
} from "@/components/summaries/ai-command-center-data";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

const AGENT_KEYS: readonly AgentKey[] = ["generalist", "support", "cost_adr"];

function toAgentKey(value: string): AgentKey | undefined {
  return AGENT_KEYS.includes(value as AgentKey) ? (value as AgentKey) : undefined;
}

function formatAgentLabel(agentKey: string): string {
  return AGENTS.find((agent) => agent.key === agentKey)?.name ?? agentKey;
}

export function AiCommandCenterSummary() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["ai-cc-summary-v1"],
    queryFn: async () => {
      const [inbox, runs, audit] = isExampleCaptureMode
        ? [EXAMPLE_INBOX, EXAMPLE_RUNS, EXAMPLE_AUDIT]
        : await Promise.all([
            supabase
              .from("ai_cc_inbox")
              .select("id,agent_key,item_type,title,summary,status,created_at")
              .order("created_at", { ascending: false })
              .limit(300)
              .then((res) => (res.data ?? []) as InboxRow[]),
            supabase
              .from("ai_cc_runs")
              .select("id,agent_key,status,created_at,finished_at")
              .order("created_at", { ascending: false })
              .limit(300)
              .then((res) => (res.data ?? []) as RunRow[]),
            supabase
              .from("ai_cc_audit")
              .select("id,action,actor_email,created_at")
              .order("created_at", { ascending: false })
              .limit(400)
              .then((res) => (res.data ?? []) as AuditRow[]),
          ]);
      return buildAiccSummary(inbox, runs, audit);
    },
  });

  if (isLoading) return <LoadingState thing="AI Command Center summary" />;
  if (isError || !data) {
    return (
      <ErrorState thing="AI Command Center summary" error={error} onRetry={() => void refetch()} />
    );
  }
  const inboxPeriod = kpiPeriodFor("aicc.inbox");
  const runsPeriod = kpiPeriodFor("aicc.runs");
  const hasReviewOutcomes = data.reviewOutcomes.some((row) => row.value > 0);
  const reviewTotal = data.reviewOutcomes.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="space-y-4">
      <KpiGrid>
        <SummaryKpi
          period={inboxPeriod}
          label="Review queue"
          value={fmtNumber(data.pending.length)}
        />
        <SummaryKpi period={runsPeriod} label="Alerts" value={fmtNumber(data.alerts.length)} />
        <SummaryKpi
          period={kpiPeriodFor("aicc.runsToday")}
          label="AI work volume"
          value={fmtNumber(data.runsToday)}
        />
        <SummaryKpi
          period={inboxPeriod}
          label="Review outcomes"
          value={fmtNumber(data.confirmed + data.rejected)}
        />
        <SummaryKpi
          period={runsPeriod}
          label="Automation status"
          value={data.automationHealthy ? "Healthy" : "Attention"}
        />
        <SummaryKpi
          period={runsPeriod}
          label="Live AI work"
          value={fmtNumber(data.liveWork.length)}
        />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Review queue"
          description={`Pending items · ${formatKpiPeriod(inboxPeriod)}`}
          action={
            <Link
              to="/ai-command-center/inbox"
              search={{ agent: undefined }}
              className="text-xs text-primary hover:underline"
            >
              View all →
            </Link>
          }
        >
          {data.pending.length > 0 ? (
            <ul className="space-y-2">
              {data.pending.slice(0, 8).map((item) => (
                <li key={item.id}>
                  <Link
                    to="/ai-command-center/inbox"
                    search={{ agent: toAgentKey(item.agent_key) }}
                    className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-sm font-medium" title={item.title}>
                        {item.title}
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {formatAgentLabel(item.agent_key)}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {item.summary ?? formatItemType(item.item_type)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <NoDataYet compact />
          )}
        </ChartCard>
        <ChartCard title="Alerts" description={`Failed runs · ${formatKpiPeriod(runsPeriod)}`}>
          {data.alerts.length > 0 ? (
            <ul className="space-y-2">
              {data.alerts.map((run) => (
                <li
                  key={run.id}
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
                >
                  <div className="truncate text-sm font-medium">{run.id}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatAgentLabel(run.agent_key)} · Failed at{" "}
                    {new Date(run.created_at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <NoDataYet compact message="No active alerts." />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="AI work volume by type" description={formatKpiPeriod(inboxPeriod)}>
          {data.workByType.length > 0 ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={data.workByType}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" tick={CHART_AXIS_TICK} />
                <YAxis tick={CHART_AXIS_TICK} allowDecimals={false} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="value" name="Items" fill={CHART_SERIES[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
        <ChartCard title="Review outcomes" description={formatKpiPeriod(inboxPeriod)}>
          {hasReviewOutcomes ? (
            <div className="space-y-3">
              <ChartLegendRow
                items={data.reviewOutcomes.map((slice, idx) => ({
                  label: slice.name,
                  value: fmtNumber(slice.value),
                  dotClass: chartSeriesBg(idx),
                }))}
              />
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <PieChart>
                  <Pie
                    data={data.reviewOutcomes}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    innerRadius={58}
                    {...PIE_SLICE_STROKE}
                  >
                    {data.reviewOutcomes.map((slice, idx) => (
                      <Cell key={slice.name} fill={chartSeriesColor(idx)} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP} />
                  <text
                    x="50%"
                    y="50%"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-foreground text-sm font-semibold"
                  >
                    {fmtNumber(reviewTotal)}
                  </text>
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <NoDataYet />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Automation status"
          description="Audit log · latest 400 events"
          action={
            <Link to="/ai-command-center/audit" className="text-xs text-primary hover:underline">
              View all →
            </Link>
          }
        >
          <ul className="space-y-2 text-sm">
            <li className="rounded-md border border-border px-3 py-2">
              Run events logged:{" "}
              <strong className="tabular-nums">{fmtNumber(data.auditRuns)}</strong>
            </li>
            <li className="rounded-md border border-border px-3 py-2">
              Review decisions logged:{" "}
              <strong className="tabular-nums">{fmtNumber(data.auditDecisions)}</strong>
            </li>
            <li className="rounded-md border border-border px-3 py-2">
              Status:{" "}
              <Badge variant={data.automationHealthy ? "success" : "warning"}>
                {data.automationHealthy ? "Healthy" : "Attention"}
              </Badge>
            </li>
          </ul>
        </ChartCard>
        <ChartCard
          title="Live AI work"
          description={`Running now · ${formatKpiPeriod(runsPeriod)}`}
        >
          {data.liveWork.length > 0 ? (
            <ul className="space-y-2">
              {data.liveWork.map((run) => (
                <li key={run.id} className="rounded-md border border-border px-3 py-2">
                  <div className="truncate text-sm font-medium">
                    {formatAgentLabel(run.agent_key)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Started {new Date(run.created_at).toLocaleString()} · Run {run.id}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <NoDataYet compact message="No agents are running right now." />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Governance" description="Role rollout and access">
        <ul className="space-y-2 text-xs">
          <li className="rounded-md border border-border px-3 py-2">
            Live roles: <strong>{data.governance.liveRoles}</strong>
          </li>
          <li className="rounded-md border border-border px-3 py-2">
            Parked roles: <strong>{data.governance.parkedRoles}</strong>
          </li>
          <li className="rounded-md border border-border px-3 py-2">
            Access note: <strong>{data.governance.leadershipAccess}</strong>
          </li>
        </ul>
      </ChartCard>
    </div>
  );
}
