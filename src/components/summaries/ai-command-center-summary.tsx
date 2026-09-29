import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
  Cell,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { fmtNumber } from "@/lib/format";
import { LIVE_ROLES, PARKED_ROLES } from "@/lib/role-rollout";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

type InboxRow = {
  id: string;
  agent_key: string;
  item_type: string;
  title: string;
  summary: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};

type RunRow = {
  id: string;
  agent_key: string;
  status: string;
  created_at: string;
  finished_at: string | null;
};

type AuditRow = {
  id: string;
  action: "run" | "propose" | "confirm" | "reject";
  actor_email: string | null;
  created_at: string;
};

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

const EXAMPLE_INBOX: InboxRow[] = [
  { id: "inb-1", agent_key: "support", item_type: "ticket_proposal", title: "Ticket #5142 proposed update", summary: "Priority + assignee + note draft.", status: "pending", created_at: "2026-09-29T05:31:14Z" },
  { id: "inb-2", agent_key: "generalist", item_type: "solution_guide", title: "Lab solution guide draft", summary: "Cohort proposal for Cognizant.", status: "pending", created_at: "2026-09-29T05:22:14Z" },
  { id: "inb-3", agent_key: "cost_adr", item_type: "adr_field_map", title: "ADR field map proposal", summary: "Mapped CONFIRMED request LR-2026-093.", status: "confirmed", created_at: "2026-09-29T04:52:14Z" },
  { id: "inb-4", agent_key: "support", item_type: "email_draft", title: "Reply draft for ticket #5139", summary: "Customer clarification request.", status: "rejected", created_at: "2026-09-29T04:22:14Z" },
];

const EXAMPLE_RUNS: RunRow[] = [
  { id: "run-901", agent_key: "support", status: "running", created_at: "2026-09-29T05:31:00Z", finished_at: null },
  { id: "run-902", agent_key: "generalist", status: "done", created_at: "2026-09-29T05:21:00Z", finished_at: "2026-09-29T05:21:35Z" },
  { id: "run-903", agent_key: "cost_adr", status: "done", created_at: "2026-09-29T04:55:00Z", finished_at: "2026-09-29T04:55:17Z" },
  { id: "run-904", agent_key: "support", status: "error", created_at: "2026-09-29T04:11:00Z", finished_at: "2026-09-29T04:11:20Z" },
];

const EXAMPLE_AUDIT: AuditRow[] = [
  { id: "au-1", action: "run", actor_email: "admin.demo@mml.local", created_at: "2026-09-29T05:31:00Z" },
  { id: "au-2", action: "propose", actor_email: "opslead.demo@mml.local", created_at: "2026-09-29T05:31:14Z" },
  { id: "au-3", action: "confirm", actor_email: "admin.demo@mml.local", created_at: "2026-09-29T05:33:40Z" },
  { id: "au-4", action: "reject", actor_email: "admin.demo@mml.local", created_at: "2026-09-29T04:33:40Z" },
];

export function AiCommandCenterSummary() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const { data, isLoading, isError, error } = useQuery({
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

      const pending = inbox.filter((row) => row.status === "pending");
      const confirmed = inbox.filter((row) => row.status === "confirmed").length;
      const rejected = inbox.filter((row) => row.status === "rejected").length;
      const reviewOutcomes = [
        { name: "Confirmed", value: confirmed },
        { name: "Rejected", value: rejected },
        { name: "Pending", value: pending.length },
      ];

      const byTypeMap = new Map<string, number>();
      for (const row of inbox) {
        byTypeMap.set(row.item_type, (byTypeMap.get(row.item_type) ?? 0) + 1);
      }
      const workByType = [...byTypeMap.entries()].map(([name, value]) => ({ name, value }));

      const runsToday = runs.filter((row) => row.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
      const liveWork = runs.filter((row) => row.status === "running").slice(0, 8);
      const alerts = runs.filter((row) => row.status === "error").slice(0, 5);
      const automationHealthy = alerts.length === 0;
      const governance = {
        liveRoles: LIVE_ROLES.join(", "),
        parkedRoles: PARKED_ROLES.join(", "),
        leadershipAccess: "Leadership blocked from AI Command Center routes and nav.",
      };

      const auditRuns = audit.filter((row) => row.action === "run").length;
      const auditDecisions = audit.filter((row) => row.action === "confirm" || row.action === "reject").length;

      return {
        pending,
        confirmed,
        rejected,
        runsToday,
        automationHealthy,
        liveWork,
        alerts,
        workByType,
        reviewOutcomes,
        governance,
        auditRuns,
        auditDecisions,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading AI Command Center summary…</CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load AI Command Center summary</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : "Unknown error"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SummaryKpi label="Review queue" value={fmtNumber(data.pending.length)} />
        <SummaryKpi label="Alerts" value={fmtNumber(data.alerts.length)} />
        <SummaryKpi label="AI work volume (today)" value={fmtNumber(data.runsToday)} />
        <SummaryKpi label="Review outcomes" value={fmtNumber(data.confirmed + data.rejected)} />
        <SummaryKpi label="Automation status" value={data.automationHealthy ? "Healthy" : "Attention"} />
        <SummaryKpi label="Live AI work" value={fmtNumber(data.liveWork.length)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Review queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.pending.slice(0, 8).map((item) => (
              <Link
                key={item.id}
                to="/ai-command-center/inbox"
                className="block rounded-md border border-border px-3 py-2 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{item.title}</div>
                  <Badge variant="outline">{item.agent_key}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{item.summary ?? item.item_type}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.length === 0 && (
              <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                No active alerts.
              </div>
            )}
            {data.alerts.map((run) => (
              <div key={run.id} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                <div className="text-sm font-medium">{run.id}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {run.agent_key} · Failed at {new Date(run.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="AI work volume by type">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.workByType}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name="Items" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Review outcomes">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.reviewOutcomes} dataKey="value" nameKey="name" outerRadius={85} label>
                {data.reviewOutcomes.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Automation status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-md border border-border px-3 py-2">
              Run events logged: <strong>{fmtNumber(data.auditRuns)}</strong>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              Review decisions logged: <strong>{fmtNumber(data.auditDecisions)}</strong>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              Status:{" "}
              <Badge variant={data.automationHealthy ? "default" : "secondary"}>
                {data.automationHealthy ? "Healthy" : "Attention"}
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Live AI work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.liveWork.length === 0 && (
              <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                No agents are running right now.
              </div>
            )}
            {data.liveWork.map((run) => (
              <div key={run.id} className="rounded-md border border-border px-3 py-2">
                <div className="text-sm font-medium">{run.id}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {run.agent_key} · Started {new Date(run.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Governance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Live roles: {data.governance.liveRoles}</Badge>
          <Badge variant="secondary">Parked roles: {data.governance.parkedRoles}</Badge>
          <Badge variant="destructive">{data.governance.leadershipAccess}</Badge>
        </CardContent>
      </Card>
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
