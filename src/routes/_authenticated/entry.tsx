import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { MasterAdrForm } from "@/components/master-adr-form";
import { BulkImportHistory } from "@/components/bulk-import-history";
import { BulkImportAuditLog } from "@/components/bulk-import-audit-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { requireRouteRoles } from "@/lib/route-guard";
import { usePermissions } from "@/lib/permissions";
import { NoAccessState } from "@/components/page-states";
import { StrictImport } from "@/components/strict-import";

export const Route = createFileRoute("/_authenticated/entry")({
  head: () => pageHead("/entry"),
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
    <AppShell {...pageShell("/entry")}>
      {allowed ? (
        <Tabs defaultValue="single" className="space-y-4">
          {/* Sentence-case tabs (plan P04, #33); the row scrolls sideways on a phone. */}
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="single">Single entry</TabsTrigger>
              {canBulk && <TabsTrigger value="bulk">Bulk import</TabsTrigger>}
              {canHistory && <TabsTrigger value="history">Import history</TabsTrigger>}
              {canHistory && <TabsTrigger value="audit">Import audit log</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="single">
            <MasterAdrForm />
          </TabsContent>
          {canBulk && (
            <TabsContent value="bulk">
              <StrictImport />
            </TabsContent>
          )}
          {canHistory && (
            <TabsContent value="history">
              <BulkImportHistory />
            </TabsContent>
          )}
          {canHistory && (
            <TabsContent value="audit">
              <BulkImportAuditLog />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <NoAccessState>
          Your role does not have permission to create transactions. Contact an administrator.
        </NoAccessState>
      )}
    </AppShell>
  );
}
