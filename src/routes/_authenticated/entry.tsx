import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MasterAdrForm } from "@/components/master-adr-form";
import { BulkImport } from "@/components/bulk-import";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/entry")({
  component: EntryPage,
});

function EntryPage() {
  const { canEditTransactions } = useAuth();
  const { can } = usePermissions();
  const allowed = canEditTransactions && can("feature_master_adr_entry");
  return (
    <AppShell title="Master ADR Entry">
      {allowed ? (
        <Tabs defaultValue="single" className="space-y-4">
          <TabsList>
            <TabsTrigger value="single">Single Entry</TabsTrigger>
            <TabsTrigger value="bulk">Bulk Import</TabsTrigger>
          </TabsList>
          <TabsContent value="single"><MasterAdrForm /></TabsContent>
          <TabsContent value="bulk"><BulkImport /></TabsContent>
        </Tabs>
      ) : (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Your role does not have permission to create transactions. Contact an administrator.
        </CardContent></Card>
      )}
    </AppShell>
  );
}