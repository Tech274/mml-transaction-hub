import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertTriangle, Bot, Inbox, Play, CheckCircle2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { listAgents, type AgentSummary } from "@/lib/ai-command-center.functions";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/ai-command-center/agents")({
  component: AgentsPage,
});

function StatusBadge({ status }: { status: AgentSummary["status"] }) {
  if (status === "running")
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> running
      </Badge>
    );
  if (status === "needs confirm")
    return (
      <Badge variant="destructive" className="gap-1">
        <Inbox className="h-3 w-3" /> needs confirm
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <CheckCircle2 className="h-3 w-3" /> idle
    </Badge>
  );
}

function AgentsPage() {
  const fn = useServerFn(listAgents);
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["admin"]);
  const q = useQuery({ queryKey: ["ai-cc", "agents"], queryFn: () => fn() as Promise<AgentSummary[]>, refetchInterval: 15000 });

  return (
    <AppShell title="AI Command Center — Agents">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground max-w-3xl">
            Agents read data you are allowed to see and leave drafts in the Inbox. Nothing is sent or written automatically.
          </p>
          {isAdmin && (
            <Button asChild size="sm">
              <Link to="/ai-command-center/agents/$agentId" params={{ agentId: "new" }}>New agent</Link>
            </Button>
          )}
        </div>

        {q.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading agents…
          </div>
        )}
        {q.isError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Could not load agents</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{q.error instanceof Error ? q.error.message : "Unknown error"}</p>
              <Button size="sm" variant="outline" onClick={() => q.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(q.data ?? []).map((a) => (
            <Card key={a.key} className="flex flex-col" data-testid={`agent-card-${a.key}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Bot className="h-4 w-4 text-primary" /> {a.name}
                  </CardTitle>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={a.status} />
                    {a.config_status && a.config_status !== "legacy" && (
                      <Badge variant={a.config_status === "active" ? "default" : "outline"}>{a.config_status}</Badge>
                    )}
                  </div>
                </div>
                <CardDescription>{a.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3">
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                  {a.capabilities.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <div className="text-xs text-muted-foreground">
                  {a.pending > 0 ? `${a.pending} item(s) awaiting review · ` : "Nothing awaiting review · "}
                  {a.last_run_at ? `last run ${formatDistanceToNow(new Date(a.last_run_at))} ago` : "never run"}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  {a.config_status === "paused" || a.config_status === "draft" || a.config_status === "archived" ? (
                    <Button size="sm" disabled>Run now</Button>
                  ) : (
                    <Button asChild size="sm">
                      <Link to="/ai-command-center/run-now" search={{ agent: a.key }}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Run now
                      </Link>
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link to="/ai-command-center/inbox" search={{ agent: a.key }}>
                      <Inbox className="h-3.5 w-3.5 mr-1" /> Inbox
                    </Link>
                  </Button>
                  {isAdmin && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/ai-command-center/agents/$agentId" params={{ agentId: a.key }} data-testid={`open-builder-${a.key}`}>Edit</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
