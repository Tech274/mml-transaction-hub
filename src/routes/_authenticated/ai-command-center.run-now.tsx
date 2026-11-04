import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Play, Bot } from "lucide-react";
import { TableStateRow } from "@/components/data-table-parts";
import { cn } from "@/lib/utils";
import {
  runAgent,
  listLabRequests,
  AGENTS,
  type AgentKey,
  type LabRequest,
} from "@/lib/ai-command-center.functions";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { requireRouteRoles } from "@/lib/route-guard";

const AGENT_KEYS: AgentKey[] = ["generalist", "support", "cost_adr"];

export const Route = createFileRoute("/_authenticated/ai-command-center/run-now")({
  head: () => pageHead("/ai-command-center/run-now"),
  beforeLoad: requireRouteRoles("/ai-command-center/run-now"),
  validateSearch: (search: Record<string, unknown>) => ({
    agent: AGENT_KEYS.includes(search.agent as AgentKey)
      ? (search.agent as AgentKey)
      : ("generalist" as AgentKey),
  }),
  component: RunNowPage,
});

const HINT_PLACEHOLDER: Record<AgentKey, string> = {
  generalist: "e.g. Kogito BPMN Automation Lab for Cognizant, 45 learners",
  support: "Optional: ticket number or words from the subject",
  cost_adr: "Not used: the agent reads the latest CONFIRMED lab request",
};

function RunNowPage() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [agent, setAgent] = useState<AgentKey>(search.agent);
  const [hint, setHint] = useState("");
  const runFn = useServerFn(runAgent);
  const labsFn = useServerFn(listLabRequests);

  const labs = useQuery({
    queryKey: ["ai-cc", "lab-requests"],
    queryFn: () => labsFn() as Promise<LabRequest[]>,
    enabled: !isExampleCaptureMode,
  });
  const labsData = isExampleCaptureMode ? EXAMPLE_LAB_REQUESTS : (labs.data ?? []);

  const run = useMutation({
    mutationFn: () => runFn({ data: { agent_key: agent, job_hint: hint.trim() || undefined } }),
    onSuccess: (r) => {
      toast.success(`Run complete — ${r.items} proposal(s) waiting in the Inbox`);
      qc.invalidateQueries({ queryKey: ["ai-cc"] });
      navigate({ to: "/ai-command-center/inbox", search: { agent } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Run failed"),
  });

  return (
    <AppShell {...pageShell("/ai-command-center/run-now")}>
      {/* #31: full content width like its siblings (was max-w-4xl). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="size-4 shrink-0 text-primary" aria-hidden /> Kick off an agent
          </CardTitle>
          <CardDescription>
            The agent reads live data and drops its proposals into the Inbox as pending. Nothing is
            sent, closed or saved until you confirm there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {AGENTS.map((a) => (
              <button
                key={a.key}
                type="button"
                aria-pressed={agent === a.key}
                onClick={() => setAgent(a.key)}
                className={cn(
                  "min-w-0 rounded-md border border-border p-3 text-left transition-colors",
                  agent === a.key ? "border-primary bg-primary/5" : "hover:bg-accent",
                )}
              >
                <div className="text-sm font-medium">{a.name}</div>
                <p className="mt-1 text-xs text-muted-foreground">{a.blurb}</p>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="run-now-hint">
              Job hint (optional)
            </Label>
            <Input
              id="run-now-hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder={HINT_PLACEHOLDER[agent]}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline">
              <Link to="/ai-command-center/inbox" search={{ agent }}>
                Go to Inbox
              </Link>
            </Button>
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Play className="mr-1 size-4" />
              )}
              Run
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">Lab requests</CardTitle>
          <CardDescription>
            The Cost / ADR agent triggers on requests with status CONFIRMED. If none exist, it stops
            and creates nothing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labs.isLoading ? (
                <TableStateRow colSpan={5}>Loading lab requests…</TableStateRow>
              ) : labs.isError ? (
                <TableStateRow colSpan={5} onRetry={() => labs.refetch()}>
                  Could not load lab requests.
                </TableStateRow>
              ) : (
                labsData.length === 0 && (
                  <TableStateRow colSpan={5}>
                    No lab requests yet. The Cost / ADR agent has nothing to work on until a request
                    is CONFIRMED.
                  </TableStateRow>
                )
              )}
              {labsData.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.request_code}</TableCell>
                  <TableCell>{r.customer_name}</TableCell>
                  <TableCell>{r.lab_name}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "CONFIRMED" ? "success" : "outline"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {String((r.requisition as { total_users?: number }).total_users ?? "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

const EXAMPLE_LAB_REQUESTS: LabRequest[] = [
  {
    id: "req-001",
    request_code: "LR-2026-091",
    customer_name: "Cognizant",
    lab_name: "Kogito BPMN Automation",
    status: "CONFIRMED",
    requisition: { total_users: 45, delivery_mode: "virtual", duration_weeks: 3 },
    confirmed_at: "2026-09-28T14:30:00Z",
    created_at: "2026-09-27T07:20:00Z",
  },
  {
    id: "req-002",
    request_code: "LR-2026-092",
    customer_name: "Infosys",
    lab_name: "Cloud Security Essentials",
    status: "DRAFT",
    requisition: { total_users: 30, delivery_mode: "virtual", duration_weeks: 2 },
    confirmed_at: null,
    created_at: "2026-09-28T09:40:00Z",
  },
  {
    id: "req-003",
    request_code: "LR-2026-093",
    customer_name: "TCS",
    lab_name: "AKS Platform Engineering",
    status: "CONFIRMED",
    requisition: { total_users: 38, delivery_mode: "hybrid", duration_weeks: 4 },
    confirmed_at: "2026-09-29T03:10:00Z",
    created_at: "2026-09-28T22:05:00Z",
  },
];
