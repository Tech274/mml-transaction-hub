import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { PrivateCloudSummary } from "@/components/summaries/private-cloud-summary";
import { validateTxSearch } from "@/lib/tx-search";
import { completenessTabSearch, parseCompletenessTab } from "@/lib/completeness-tabs";

export const Route = createFileRoute("/_authenticated/private-cloud")({
  head: () => pageHead("/private-cloud"),
  validateSearch: validateTxSearch,
  component: PrivateCloudPage,
});

// SCRUM-128 (C2): the SCRUM-44 flag is retired; the summary view is the only view.
// SCRUM-128 (C6): the page sentence is the AppShell description (was an in-page paragraph).
function PrivateCloudPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <AppShell
      {...pageShell("/private-cloud")}
      description="Private cloud transactions (MakeMyLabs, Oracle and SAP), batches, reconciliation and customer performance."
    >
      <PrivateCloudSummary
        tab={parseCompletenessTab(search.completeness)}
        onTabChange={(tab) =>
          void navigate({
            search: (prev) => ({ ...prev, completeness: completenessTabSearch(tab) }),
            replace: true,
          })
        }
      />
    </AppShell>
  );
}
