import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { usePermissions } from "@/lib/permissions";

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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Finance & Operations Reports
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>This module is scheduled for Phase 4: cloud cost, customer profitability, margin analysis, and revenue forecasting.</p>
          <p>Until then, use the All Transactions, Public Cloud, and Private Cloud views — each supports Excel export with active filters.</p>
        </CardContent>
      </Card>
    </AppShell>
  );
}