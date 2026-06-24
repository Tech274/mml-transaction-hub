import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";

export const Route = createFileRoute("/_authenticated/transactions")({
  component: () => (
    <AppShell title="All Transactions">
      <TransactionsTable repoFilter="all" />
    </AppShell>
  ),
});