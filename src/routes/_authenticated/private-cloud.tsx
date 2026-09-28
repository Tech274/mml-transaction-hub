import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { PrivateCloudBatchesView } from "@/components/private-cloud-batches-view";
import { validateTxSearch } from "@/lib/tx-search";
import {
  getScrum44UiReviewEnvForClient,
  isScrum44UiReviewEnabled,
} from "@/lib/scrum44-ui-review-flag";

export const Route = createFileRoute("/_authenticated/private-cloud")({
  validateSearch: validateTxSearch,
  component: PrivateCloudPage,
});

function PrivateCloudPage() {
  const search = Route.useSearch();
  const uiRefreshEnabled = isScrum44UiReviewEnabled(getScrum44UiReviewEnvForClient());

  return (
    <AppShell title={uiRefreshEnabled ? "Private Cloud Batches" : "Private Cloud Repository"}>
      {uiRefreshEnabled ? (
        <PrivateCloudBatchesView />
      ) : (
        <TransactionsTable
          repoFilter="private_cloud"
          showProviderFilter={false}
          initialFilters={search}
        />
      )}
    </AppShell>
  );
}
