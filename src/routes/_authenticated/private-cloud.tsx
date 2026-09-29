import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { PrivateCloudExampleView } from "@/components/private-cloud-example-view";
import { PrivateCloudSummary } from "@/components/summaries/private-cloud-summary";
import { validateTxSearch } from "@/lib/tx-search";
import {
  getScrum44UiReviewEnvForClient,
  isScrum44UiReviewEnabled,
} from "@/lib/scrum44-ui-review-flag";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/private-cloud")({
  validateSearch: validateTxSearch,
  component: PrivateCloudPage,
});

function PrivateCloudPage() {
  const search = Route.useSearch();
  const uiRefreshEnabled = isScrum44UiReviewEnabled(getScrum44UiReviewEnvForClient());
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());

  return (
    <AppShell title={uiRefreshEnabled ? "Private Cloud Batches" : "Private Cloud Repository"}>
      {uiRefreshEnabled ? (
        <PrivateCloudSummary />
      ) : isExampleCaptureMode ? (
        <PrivateCloudExampleView />
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
