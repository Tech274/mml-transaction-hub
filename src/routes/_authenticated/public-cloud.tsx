import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";

export const Route = createFileRoute("/_authenticated/public-cloud")({
  component: () => (
    <AppShell title="Public Cloud Repository">
      <TransactionsTable repoFilter="public_cloud" />
    </AppShell>
  ),
});