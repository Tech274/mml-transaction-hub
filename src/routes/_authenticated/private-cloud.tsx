import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { validateTxSearch } from "@/lib/tx-search";

export const Route = createFileRoute("/_authenticated/private-cloud")({
  validateSearch: validateTxSearch,
  component: PrivateCloudPage,
});

function PrivateCloudPage() {
  const search = Route.useSearch();
  return (
    <AppShell title="Private Cloud Repository">
      <TransactionsTable repoFilter="private_cloud" showProviderFilter={false} initialFilters={search} />
    </AppShell>
  );
}
