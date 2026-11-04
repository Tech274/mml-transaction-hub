import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { AiCommandCenterSummary } from "@/components/summaries/ai-command-center-summary";

export const Route = createFileRoute("/_authenticated/ai-command-center/")({
  head: () => pageHead("/ai-command-center"),
  component: AiCommandCenterSummaryPage,
});

// SCRUM-128 (C6): the page sentence is the AppShell description (was an in-page h2 block).
function AiCommandCenterSummaryPage() {
  return (
    <AppShell
      {...pageShell("/ai-command-center")}
      description="Review queue, automation health and governance checkpoints."
    >
      <AiCommandCenterSummary />
    </AppShell>
  );
}
