import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { usePermissions } from "@/lib/permissions";
import { ReportsView } from "@/components/reports-view";
import { LoadingState, NoAccessState } from "@/components/page-states";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => pageHead("/reports"),
  component: ReportsPage,
});

function ReportsPage() {
  const { can, loading } = usePermissions();
  if (loading)
    return (
      <AppShell {...pageShell("/reports")}>
        <LoadingState thing="reports" />
      </AppShell>
    );
  if (!can("feature_reports_access")) {
    return (
      <AppShell {...pageShell("/reports")}>
        <NoAccessState>
          Your role does not have permission to view Reports. Contact an administrator.
        </NoAccessState>
      </AppShell>
    );
  }
  return (
    <AppShell {...pageShell("/reports")}>
      <ReportsView />
    </AppShell>
  );
}
