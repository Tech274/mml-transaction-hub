import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletenessTabs } from "@/components/summaries/completeness-tabs";
import { CompletenessCard } from "@/components/summaries/completeness-card";
import { completenessTabCounts } from "@/lib/completeness-tabs";
import { splitByCompleteness } from "@/lib/transaction-completeness";

// Synthetic rows only.
const base = {
  potential_id: "SYN-1",
  month: 9,
  year: 2026,
  customer_name: "Synthetic Customer",
  lab_name: "Synthetic Lab",
  cloud_provider: "SAP",
  input_cost: 10,
  selling_cost: 20,
  total_users: 1,
};
const rows = [
  base,
  { ...base, potential_id: "SYN-2", input_cost: null },
  { ...base, lab_name: " " },
];

describe("CompletenessTabs (SSR render)", () => {
  it("renders All · Complete · Incomplete with the same counts as the card", () => {
    const counts = completenessTabCounts(rows);
    const split = splitByCompleteness(rows);
    const tabs = renderToStaticMarkup(
      createElement(CompletenessTabs, { value: "all", onChange: () => {}, counts: counts }),
    );
    expect(tabs).toContain("All (3)");
    expect(tabs).toContain(`Complete (${split.complete.count})`);
    expect(tabs).toContain(`Incomplete (${split.incomplete.count})`);
    expect(tabs).not.toContain("Showing");
    const card = renderToStaticMarkup(
      createElement(CompletenessCard, {
        complete: split.complete,
        incomplete: split.incomplete,
        onViewIncomplete: () => {},
        period: { kind: "all-time" },
      }),
    );
    expect(card).toContain("View incomplete");
    expect(card).toContain("All time");
  });

  it("shows the filter summary on a filtered tab", () => {
    const html = renderToStaticMarkup(
      createElement(CompletenessTabs, {
        value: "incomplete",
        onChange: () => {},
        counts: completenessTabCounts(rows),
      }),
    );
    expect(html).toContain("Showing 2 incomplete rows");
  });
});
