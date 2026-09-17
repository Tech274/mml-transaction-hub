import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { validateTxSearch } from "@/lib/tx-search";

export const Route = createFileRoute("/_authenticated/transactions")({
  validateSearch: validateTxSearch,
  component: TransactionsPage,
});

function TransactionsPage() {
  const search = Route.useSearch();
  return (
    <AppShell title="All Transactions">
      <TransactionsTable repoFilter="all" initialFilters={search} />
    </AppShell>
  );
}
