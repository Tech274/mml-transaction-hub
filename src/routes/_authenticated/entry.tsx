import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MasterAdrForm } from "@/components/master-adr-form";
import { BulkImportHistory } from "@/components/bulk-import-history";
import { BulkImportAuditLog } from "@/components/bulk-import-audit-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { requireRouteRoles } from "@/lib/route-guard";
import { usePermissions } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { StrictImport } from "@/components/strict-import";

export const Route = createFileRoute("/_authenticated/entry")({
  beforeLoad: requireRouteRoles("/entry"),
  component: EntryPage,
});

function EntryPage() {
  const { canEditTransactions, hasAnyRole } = useAuth();
  const { can } = usePermissions();
  const allowed = canEditTransactions && can("feature_master_adr_entry");
  // Bulk import + history are limited to Ops/Manager/Admin.
  const canBulk = hasAnyRole(["admin", "ops_lead", "ops_user"]);
  const canHistory = hasAnyRole(["admin", "ops_lead", "leadership"]);
  return (
    <AppShell title="Master ADR Entry">
      {allowed ? (
        <Tabs defaultValue="single" className="space-y-4">
          <TabsList>
            <TabsTrigger value="single">Single Entry</TabsTrigger>
            {canBulk && <TabsTrigger value="bulk">Bulk Import</TabsTrigger>}
            {canHistory && <TabsTrigger value="history">Import History</TabsTrigger>}
            {canHistory && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
          </TabsList>
          <TabsContent value="single"><MasterAdrForm /></TabsContent>
          {canBulk && <TabsContent value="bulk"><StrictImport /></TabsContent>}
          {canHistory && <TabsContent value="history"><BulkImportHistory /></TabsContent>}
          {canHistory && <TabsContent value="audit"><BulkImportAuditLog /></TabsContent>}
        </Tabs>
      ) : (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Your role does not have permission to create transactions. Contact an administrator.
        </CardContent></Card>
      )}
    </AppShell>
  );
}
