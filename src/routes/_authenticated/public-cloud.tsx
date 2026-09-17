import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { validateTxSearch } from "@/lib/tx-search";

export const Route = createFileRoute("/_authenticated/public-cloud")({
  validateSearch: validateTxSearch,
  component: PublicCloudPage,
});

function PublicCloudPage() {
  const search = Route.useSearch();
  return (
    <AppShell title="Public Cloud Repository">
      <TransactionsTable repoFilter="public_cloud" initialFilters={search} />
    </AppShell>
  );
}
