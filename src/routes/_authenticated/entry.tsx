import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MasterAdrForm } from "@/components/master-adr-form";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/entry")({
  component: EntryPage,
});

function EntryPage() {
  const { canEditTransactions } = useAuth();
  return (
    <AppShell title="Master ADR Entry">
      {canEditTransactions ? (
        <MasterAdrForm />
      ) : (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Your role does not have permission to create transactions. Contact an administrator.
        </CardContent></Card>
      )}
    </AppShell>
  );
}