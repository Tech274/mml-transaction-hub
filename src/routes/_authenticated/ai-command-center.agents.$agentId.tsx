import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { requireRouteRoles } from "@/lib/route-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { getAgentAdmin, saveAgent, setAgentLifecycle, testRunAgent } from "@/lib/ai/agent.functions";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER, modelsFor, PROVIDER_LABEL, PROVIDER_ORDER, providerTier, type ModelProviderId } from "@/lib/ai/model-catalog";

export const Route = createFileRoute("/_authenticated/ai-command-center/agents/$agentId")({
  beforeLoad: requireRouteRoles("/ai-command-center/builder"),
  component: BuilderPage,
});

const ROLES = ["admin", "ops_lead", "ops_user", "leadership", "finance"] as const;

type AdminPayload = Awaited<ReturnType<typeof getAgentAdmin>>;

function BuilderPage() {
  const { agentId } = Route.useParams();
  const qc = useQueryClient();
  const load = useServerFn(getAgentAdmin);
  const save = useServerFn(saveAgent);
  const life = useServerFn(setAgentLifecycle);
  const test = useServerFn(testRunAgent);
  const q = useQuery({ queryKey: ["ai-agents", "admin"], queryFn: () => load() });
  const data = q.data as AdminPayload | undefined;
  const agent = useMemo(() => {
    if (!data || agentId === "new") return null;
    return (data.agents as { id: string; key: string; name: string; status: string; engine: string; current_version_id: string | null }[])
      .find((row) => row.id === agentId || row.key === agentId) ?? null;
  }, [data, agentId]);
  const versions = useMemo(() => {
    if (!data || !agent) return [];
    return (data.versions as { id: string; agent_id: string; version: number; purpose: string; instructions: string; model_provider: string; model_id: string; temperature: number; max_output_tokens: number; premium_approved: boolean; run_roles: string[]; view_roles: string[]; approve_roles: string[]; output_types: string[]; limits: { per_run_usd?: number; per_day_runs?: number; per_month_usd?: number }; change_note: string | null; created_at: string }[])
      .filter((row) => row.agent_id === agent.id)
      .sort((a, b) => b.version - a.version);
  }, [data, agent]);
  const latest = versions[0];
  const toolKeysFor = (versionId: string) =>
    ((data?.version_tools ?? []) as { version_id: string; tool_key: string }[]).filter((row) => row.version_id === versionId).map((row) => row.tool_key);

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [purpose, setPurpose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [provider, setProvider] = useState<ModelProviderId>(DEFAULT_PROVIDER);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [tools, setTools] = useState<string[]>([]);
  const [runRoles, setRunRoles] = useState<string[]>(["admin", "ops_lead"]);
  const [viewRoles, setViewRoles] = useState<string[]>(["admin", "leadership", "finance"]);
  const [perRun, setPerRun] = useState("0.10");
  const [perMonth, setPerMonth] = useState("5");
  const [sample, setSample] = useState("Ticket 9001001 cannot access the lab portal");
  const [trace, setTrace] = useState<string>("");

  useEffect(() => {
    if (!latest || !agent) return;
    setName(agent.name);
    setKey(agent.key);
    setPurpose(latest.purpose ?? "");
    setInstructions(latest.instructions ?? "");
    const savedProvider = latest.model_provider === "none" ? DEFAULT_PROVIDER : latest.model_provider;
    setProvider((PROVIDER_ORDER as readonly string[]).includes(savedProvider) ? (savedProvider as ModelProviderId) : DEFAULT_PROVIDER);
    setModelId(latest.model_id || DEFAULT_MODEL_ID);
    setTools(toolKeysFor(latest.id));
    setRunRoles(latest.run_roles ?? []);
    setViewRoles(latest.view_roles ?? []);
    setPerRun(String(latest.limits?.per_run_usd ?? 0.1));
    setPerMonth(String(latest.limits?.per_month_usd ?? 5));
    if (agent.key === "dashboard_qa") setSample("How many transactions are there this year?");
  }, [latest?.id, agent?.id]);

  const models = (data?.models ?? []).filter((model) => model.provider === provider && (model.configured || model.id === modelId));
  const rules = agent?.engine === "rules";

  const saveMut = useMutation({
    mutationFn: () => save({
      data: {
        agentId: agent?.id,
        key: agent ? undefined : key,
        name,
        purpose,
        instructions,
        modelProvider: provider,
        modelId,
        temperature: 0.2,
        maxOutputTokens: 2000,
        premiumApproved: false,
        toolKeys: tools,
        runRoles: runRoles as ("admin")[],
        viewRoles: viewRoles as ("admin")[],
        approveRoles: ["admin", "ops_lead"],
        outputTypes: tools.some((tool) => tool.startsWith("reports") || tool.startsWith("transactions")) ? ["qa_answer", "report"] : ["triage_note", "email_draft"],
        perRunUsd: Number(perRun),
        perDayRuns: 200,
        perMonthUsd: Number(perMonth),
        changeNote: "Saved from the builder",
      },
    }),
    onSuccess: (result) => {
      toast.success("Saved a new version");
      qc.invalidateQueries({ queryKey: ["ai-agents", "admin"] });
      if (!agent) window.location.assign(`/ai-command-center/agents/${result.key}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  const lifeMut = useMutation({
    mutationFn: (input: { action: "activate" | "pause" | "archive"; versionId?: string }) =>
      life({ data: { agentId: agent!.id, versionId: input.versionId ?? latest?.id, action: input.action } }),
    onSuccess: (result) => {
      toast.success(`Agent is ${result.status}`);
      qc.invalidateQueries({ queryKey: ["ai-agents", "admin"] });
      qc.invalidateQueries({ queryKey: ["ai-cc"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update the agent"),
  });

  const testMut = useMutation({
    mutationFn: () => test({ data: { agentKey: agent?.key ?? key, versionId: latest?.id, sample } }),
    onSuccess: (result) => {
      setTrace(JSON.stringify({ status: result.status, error: result.error, output: result.output, steps: result.steps }, null, 2));
      if (result.status === "done") toast.success("Test run finished. It was not added to the Inbox.");
      else toast.error(result.error ?? "Test run did not finish");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Test run failed"),
  });

  return (
    <AppShell title="Agent builder">
      <div className="space-y-4 max-w-4xl" data-testid="agent-builder">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/ai-command-center/agents">Back to agents</Link></Button>
          {agent && <Badge>{agent.status}</Badge>}
        </div>
        {data?.demo_mock && (
          <Alert>
            <AlertTitle>Local demo</AlertTitle>
            <AlertDescription>No provider key is set. Test runs use the mock adapter and do not call a vendor.</AlertDescription>
          </Alert>
        )}
        {data && (
          <div className="flex flex-wrap gap-2 text-xs" data-testid="provider-flags">
            {PROVIDER_ORDER.map((name) => (
              <Badge key={name} variant={data.providers[name] ? "default" : "outline"}>
                {PROVIDER_LABEL[name]}: {data.providers[name] ? "configured" : "not configured"}
                {providerTier(name) === "secondary" ? " · secondary" : ""}
              </Badge>
            ))}
          </div>
        )}
        <Tabs defaultValue="basics">
          <TabsList>
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="model">Model</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="test">Test run</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="basics" className="space-y-3">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} disabled={rules} />
            {agentId === "new" && (
              <>
                <Label>Key</Label>
                <Input value={key} onChange={(event) => setKey(event.target.value)} placeholder="ticket_triage" />
              </>
            )}
            <Label>Purpose</Label>
            <Textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={rules} />
            <Label>Instructions</Label>
            <Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} className="min-h-40" disabled={rules} />
          </TabsContent>
          <TabsContent value="model" className="space-y-3">
            <Label>Provider</Label>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_ORDER.map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={provider === item ? "default" : "outline"}
                  onClick={() => {
                    setProvider(item);
                    const first = modelsFor(item)[0];
                    if (first) setModelId(first.id);
                  }}
                  disabled={rules}
                >
                  {PROVIDER_LABEL[item]}{providerTier(item) === "secondary" ? " · secondary" : ""}
                </Button>
              ))}
            </div>
            <Label>Model</Label>
            <div className="space-y-2">
              {models.map((model) => (
                <button key={model.id} type="button" className={`w-full text-left rounded border p-2 text-sm ${modelId === model.id ? "border-primary" : ""}`} onClick={() => setModelId(model.id)}>
                  {model.label} · ${model.input_per_mtok_usd} / ${model.output_per_mtok_usd} per million {model.premium ? "· premium" : ""} {model.configured ? "" : "· key not set"}
                </button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="tools" className="space-y-2">
            {(data?.tools ?? []).map((tool) => (
              <label key={tool.key} className="flex items-start gap-2 rounded border p-2 text-sm">
                <Checkbox checked={tools.includes(tool.key)} disabled={rules} onCheckedChange={(checked) => setTools((current) => checked ? [...current, tool.key] : current.filter((item) => item !== tool.key))} />
                <span>
                  <span className="font-medium">{tool.title}</span>
                  <span className="block text-xs text-muted-foreground">{tool.description}</span>
                  <span className="mt-1 flex gap-1">
                    {tool.returns_money && <Badge variant="outline">returns money</Badge>}
                    {tool.reads_untrusted && <Badge variant="outline">untrusted text</Badge>}
                  </span>
                </span>
              </label>
            ))}
          </TabsContent>
          <TabsContent value="access" className="space-y-3">
            <RolePick label="Who can run it" value={runRoles} onChange={setRunRoles} disabled={rules} />
            <RolePick label="Who can see the output" value={viewRoles} onChange={setViewRoles} disabled={rules} />
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label>Per-run cap (USD)</Label><Input value={perRun} onChange={(event) => setPerRun(event.target.value)} /></div>
              <div><Label>Per-agent monthly cap (USD)</Label><Input value={perMonth} onChange={(event) => setPerMonth(event.target.value)} /></div>
            </div>
          </TabsContent>
          <TabsContent value="test" className="space-y-3">
            <Label>Sample input</Label>
            <Textarea data-testid="test-run-input" value={sample} onChange={(event) => setSample(event.target.value)} />
            <Button data-testid="test-run-submit" onClick={() => testMut.mutate()} disabled={!agent || rules || testMut.isPending}>Test run</Button>
            {trace && <pre className="whitespace-pre-wrap text-xs border rounded p-3" data-testid="test-run-output">{trace}</pre>}
          </TabsContent>
          <TabsContent value="history" className="space-y-2">
            {versions.map((version) => (
              <Card key={version.id}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Version {version.version} {agent?.current_version_id === version.id ? "· current" : ""}</CardTitle>
                  <CardDescription>{version.change_note} · {version.model_id}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button size="sm" variant="outline" disabled={rules || lifeMut.isPending} onClick={() => lifeMut.mutate({ action: "activate", versionId: version.id })}>Use this version</Button>
                </CardContent>
              </Card>
            ))}
            {versions.length === 0 && <p className="text-sm text-muted-foreground">No versions yet.</p>}
          </TabsContent>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => saveMut.mutate()} disabled={rules || saveMut.isPending || !name.trim()}>Save version</Button>
          {agent && agent.status !== "active" && <Button variant="default" onClick={() => lifeMut.mutate({ action: "activate" })} disabled={lifeMut.isPending}>Activate</Button>}
          {agent && agent.status === "active" && <Button variant="outline" onClick={() => lifeMut.mutate({ action: "pause" })} disabled={lifeMut.isPending}>Pause</Button>}
        </div>
      </div>
    </AppShell>
  );
}

function RolePick({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 flex flex-wrap gap-3">
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1 text-sm">
            <Checkbox
              checked={value.includes(role)}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(checked ? [...value, role] : value.filter((item) => item !== role))}
            />
            {role}
          </label>
        ))}
      </div>
    </div>
  );
}
