import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { requireRouteRoles } from "@/lib/route-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { getUsage, setKillSwitch, updateCostSettings } from "@/lib/ai/agent.functions";

export const Route = createFileRoute("/_authenticated/ai-command-center/usage")({
  beforeLoad: requireRouteRoles("/ai-command-center/usage"),
  component: UsagePage,
});

function UsagePage() {
  const qc = useQueryClient();
  const load = useServerFn(getUsage);
  const kill = useServerFn(setKillSwitch);
  const caps = useServerFn(updateCostSettings);
  const q = useQuery({ queryKey: ["ai-agents", "usage"], queryFn: () => load() });
  const data = q.data;
  const [monthly, setMonthly] = useState("");
  const [perRun, setPerRun] = useState("");
  const [perAgent, setPerAgent] = useState("");

  const killMut = useMutation({
    mutationFn: (enabled: boolean) => kill({ data: { enabled } }),
    onSuccess: () => {
      toast.success("Kill switch updated");
      qc.invalidateQueries({ queryKey: ["ai-agents", "usage"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update the switch"),
  });
  const capMut = useMutation({
    mutationFn: () => caps({
      data: {
        monthlyCapUsd: Number(monthly || data?.settings.monthly_cap_usd || 10),
        perRunCapUsd: Number(perRun || data?.settings.per_run_cap_usd || 0.1),
        perAgentMonthCapUsd: Number(perAgent || data?.settings.per_agent_month_cap_usd || 5),
      },
    }),
    onSuccess: () => {
      toast.success("Caps saved");
      qc.invalidateQueries({ queryKey: ["ai-agents", "usage"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save caps"),
  });

  const cap = data?.settings.monthly_cap_usd ?? 10;
  const spent = data?.spent_usd ?? 0;

  return (
    <AppShell title="AI usage">
      <div className="space-y-4 max-w-4xl" data-testid="usage-page">
        {data && !data.settings.agents_enabled && (
          <Alert variant="destructive">
            <AlertTitle>Agents are off</AlertTitle>
            <AlertDescription>The kill switch is off. New runs stop before the next model call.</AlertDescription>
          </Alert>
        )}
        {data && spent >= cap && (
          <Alert>
            <AlertTitle>Monthly cap reached</AlertTitle>
            <AlertDescription>Spend this month is at the overall cap. Raise the cap or wait until next month.</AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">This month</CardTitle>
            <CardDescription>Estimated from tokens and the price list. Keys stay on the server.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold" data-testid="usage-spent">${spent.toFixed(4)} <span className="text-sm font-normal text-muted-foreground">of ${cap.toFixed(2)}</span></p>
            <p className="text-xs text-muted-foreground">Tokens in {data?.tokens_in ?? 0} · out {data?.tokens_out ?? 0}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {data && Object.entries(data.providers).map(([name, on]) => (
                <Badge key={name} variant={on ? "default" : "outline"}>{name}: {on ? "configured" : "not configured"}</Badge>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Switch
                data-testid="kill-switch"
                checked={data?.settings.agents_enabled ?? true}
                onCheckedChange={(checked) => killMut.mutate(checked)}
              />
              <Label>Agents enabled</Label>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Caps</CardTitle>
            <CardDescription>The overall monthly default is $10. Per-run default is $0.10.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div><Label>Monthly cap (USD)</Label><Input value={monthly} placeholder={String(data?.settings.monthly_cap_usd ?? 10)} onChange={(event) => setMonthly(event.target.value)} /></div>
            <div><Label>Per-run cap (USD)</Label><Input value={perRun} placeholder={String(data?.settings.per_run_cap_usd ?? 0.1)} onChange={(event) => setPerRun(event.target.value)} /></div>
            <div><Label>Per-agent month (USD)</Label><Input value={perAgent} placeholder={String(data?.settings.per_agent_month_cap_usd ?? 5)} onChange={(event) => setPerAgent(event.target.value)} /></div>
            <Button className="sm:col-span-3 w-fit" onClick={() => capMut.mutate()} disabled={capMut.isPending}>Save caps</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">By agent</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(data?.agents ?? []).map((agent) => (
              <div key={agent.id} className="flex justify-between gap-2 border-b py-1">
                <span>{agent.name} · {agent.status}</span>
                <span>{agent.runs} runs · ${agent.cost.toFixed(4)} · {agent.blocked} blocked</span>
              </div>
            ))}
            {(data?.agents ?? []).length === 0 && <p className="text-muted-foreground">No runs this month.</p>}
          </CardContent>
        </Card>
        {(data?.blocked.length ?? 0) > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Blocked by a cap</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs">
              {data?.blocked.map((row, index) => <p key={index}>{row.agent}: {row.error}</p>)}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
