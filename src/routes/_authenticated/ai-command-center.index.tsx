import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AiCommandCenterSummary } from "@/components/summaries/ai-command-center-summary";

export const Route = createFileRoute("/_authenticated/ai-command-center/")({
  component: AiCommandCenterSummaryPage,
});

function AiCommandCenterSummaryPage() {
  return (
    <AppShell title="AI Command Center">
      <AiCommandCenterSummary />
    </AppShell>
  );
}
