import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { AllTransactionsExampleView } from "@/components/all-transactions-example-view";
import { validateTxSearch } from "@/lib/tx-search";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/transactions")({
  validateSearch: validateTxSearch,
  component: TransactionsPage,
});

function TransactionsPage() {
  const search = Route.useSearch();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  return (
    <AppShell title="All Transactions">
      {isExampleCaptureMode ? (
        <AllTransactionsExampleView />
      ) : (
        <TransactionsTable repoFilter="all" initialFilters={search} />
      )}
    </AppShell>
  );
}
