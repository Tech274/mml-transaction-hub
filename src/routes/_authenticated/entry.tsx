import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MasterAdrForm } from "@/components/master-adr-form";
import { BulkImport } from "@/components/bulk-import";
import { BulkImportHistory } from "@/components/bulk-import-history";
import { BulkImportAuditLog } from "@/components/bulk-import-audit-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { requireRouteRoles } from "@/lib/route-guard";
import { usePermissions } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { StrictImport } from "@/components/strict-import";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getStrictImportStatus } from "@/lib/strict-import.functions";

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
  // SCRUM-103: strict importer, only when strict_import_enabled is on (default OFF).
  // When it is on, the legacy bulk importer is limited to admins.
  const strictStatusFn = useServerFn(getStrictImportStatus);
  const { data: strictStatus } = useQuery({
    queryKey: ["strict-import-status"],
    queryFn: () => strictStatusFn(),
    enabled: canBulk,
    staleTime: 5 * 60 * 1000,
  });
  const canStrict = canBulk && strictStatus?.enabled === true && strictStatus.canImport;
  const canLegacyBulk = canBulk && (strictStatus?.enabled !== true || hasAnyRole(["admin"]));
  return (
    <AppShell title="Master ADR Entry">
      {allowed ? (
        <Tabs defaultValue="single" className="space-y-4">
          <TabsList>
            <TabsTrigger value="single">Single Entry</TabsTrigger>
            {canStrict && <TabsTrigger value="strict">Strict Import (preview)</TabsTrigger>}
            {canLegacyBulk && <TabsTrigger value="bulk">Bulk Import</TabsTrigger>}
            {canHistory && <TabsTrigger value="history">Import History</TabsTrigger>}
            {canHistory && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
          </TabsList>
          <TabsContent value="single"><MasterAdrForm /></TabsContent>
          {canStrict && <TabsContent value="strict"><StrictImport /></TabsContent>}
          {canLegacyBulk && <TabsContent value="bulk"><BulkImport /></TabsContent>}
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
