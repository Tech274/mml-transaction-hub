import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";

export const Route = createFileRoute("/_authenticated/private-cloud")({
  component: () => (
    <AppShell title="Private Cloud Repository">
      <TransactionsTable repoFilter="private_cloud" showProviderFilter={false} />
    </AppShell>
  ),
});