import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { TransactionsTable } from "@/components/transactions-table";
import { AllTransactionsExampleView } from "@/components/all-transactions-example-view";
import { validateTxSearch } from "@/lib/tx-search";
import { completenessTabSearch, parseCompletenessTab } from "@/lib/completeness-tabs";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => pageHead("/transactions"),
  validateSearch: validateTxSearch,
  component: TransactionsPage,
});

function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  return (
    <AppShell {...pageShell("/transactions")}>
      {isExampleCaptureMode ? (
        <AllTransactionsExampleView />
      ) : (
        <TransactionsTable
          repoFilter="all"
          initialFilters={search}
          completeness={parseCompletenessTab(search.completeness)}
          onCompletenessChange={(c) =>
            void navigate({
              search: (prev) => ({ ...prev, completeness: completenessTabSearch(c) }),
              replace: true,
            })
          }
        />
      )}
    </AppShell>
  );
}
