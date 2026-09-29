import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AgentsSummary } from "@/components/summaries/agents-summary";
import { requireRouteRoles } from "@/lib/route-guard";

export const Route = createFileRoute("/_authenticated/ai-command-center/agents")({
  beforeLoad: requireRouteRoles("/ai-command-center/agents"),
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <AppShell title="Agents">
      <AgentsSummary />
    </AppShell>
  );
}
