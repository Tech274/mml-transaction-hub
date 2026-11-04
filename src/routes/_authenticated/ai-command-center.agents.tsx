import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { AgentsSummary } from "@/components/summaries/agents-summary";
import { requireRouteRoles } from "@/lib/route-guard";

export const Route = createFileRoute("/_authenticated/ai-command-center/agents")({
  head: () => pageHead("/ai-command-center/agents"),
  beforeLoad: requireRouteRoles("/ai-command-center/agents"),
  component: AgentsPage,
});

// SCRUM-128 (C6): the page sentence is the AppShell description (was an in-page h2 block).
function AgentsPage() {
  return (
    <AppShell
      {...pageShell("/ai-command-center/agents")}
      description="Agent workload, review outcomes and recent runs."
    >
      <AgentsSummary />
    </AppShell>
  );
}
