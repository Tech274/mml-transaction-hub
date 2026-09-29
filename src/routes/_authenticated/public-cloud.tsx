import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { TransactionsTable } from "@/components/transactions-table";
import { PublicCloudExampleView } from "@/components/public-cloud-example-view";
import { PublicCloudSummary } from "@/components/summaries/public-cloud-summary";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { validateTxSearch } from "@/lib/tx-search";
import {
  getScrum44UiReviewEnvForClient,
  isScrum44UiReviewEnabled,
} from "@/lib/scrum44-ui-review-flag";

export const Route = createFileRoute("/_authenticated/public-cloud")({
  validateSearch: validateTxSearch,
  component: PublicCloudPage,
});

function PublicCloudPage() {
  const search = Route.useSearch();
  const uiRefreshEnabled = isScrum44UiReviewEnabled(getScrum44UiReviewEnvForClient());
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());

  return (
    <AppShell title={uiRefreshEnabled ? "Public Cloud Transactions" : "Public Cloud Repository"}>
      {uiRefreshEnabled ? (
        <PublicCloudSummary />
      ) : isExampleCaptureMode ? (
        <PublicCloudExampleView />
      ) : (
        <TransactionsTable
          repoFilter="public_cloud"
          initialFilters={search}
          pageSize={uiRefreshEnabled ? 10 : 25}
          compactFilters={uiRefreshEnabled}
          showPublicCloudInsights={uiRefreshEnabled}
        />
      )}
    </AppShell>
  );
}
