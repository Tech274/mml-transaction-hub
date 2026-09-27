import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePermissions } from "@/lib/permissions";
import { ReportsView } from "@/components/reports-view";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const { can, loading } = usePermissions();
  if (loading) return <AppShell title="Reports"><div className="text-muted-foreground text-sm">Loading…</div></AppShell>;
  if (!can("feature_reports_access")) {
    return (
      <AppShell title="Reports">
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Your role does not have permission to view Reports. Contact an administrator.
        </CardContent></Card>
      </AppShell>
    );
  }
  return (
    <AppShell title="Reports">
      <ReportsView />
    </AppShell>
  );
}
