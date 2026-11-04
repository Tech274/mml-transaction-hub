import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/lib/auth-context";
import { pageHead, pageShell } from "@/lib/nav";
import { DashboardSuperAdminSummary } from "@/components/summaries/dashboard-super-admin-summary";
import { dashboardViewer } from "@/components/summaries/dashboard-data";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => pageHead("/dashboard"),
  component: DashboardPage,
});

// SCRUM-128 (C2): the SCRUM-44 flag is retired. The Dashboard always renders the summary that
// production showed with the flag on; the legacy flag-off view was deleted.
// SCRUM-128 (C5): "Viewing as {name} · {role}" is the AppShell description (was an in-page h2 block).
function DashboardPage() {
  const { roles, user } = useAuth();
  const { viewerName, viewerRole } = dashboardViewer(roles, user);
  return (
    <AppShell {...pageShell("/dashboard")} description={`Viewing as ${viewerName} · ${viewerRole}`}>
      <DashboardSuperAdminSummary />
    </AppShell>
  );
}
