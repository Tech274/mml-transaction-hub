import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { PublicCloudSummary } from "@/components/summaries/public-cloud-summary";
import { validateTxSearch } from "@/lib/tx-search";
import { completenessTabSearch, parseCompletenessTab } from "@/lib/completeness-tabs";

export const Route = createFileRoute("/_authenticated/public-cloud")({
  head: () => pageHead("/public-cloud"),
  validateSearch: validateTxSearch,
  component: PublicCloudPage,
});

// SCRUM-128 (C2): the SCRUM-44 flag is retired; the summary view is the only view.
// SCRUM-128 (C6): the page sentence is the AppShell description (was an in-page paragraph).
function PublicCloudPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <AppShell
      {...pageShell("/public-cloud")}
      description="Public cloud transactions, credits and customer mix."
    >
      <PublicCloudSummary
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
