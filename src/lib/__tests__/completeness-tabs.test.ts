import { describe, expect, it } from "vitest";
import {
  completenessFilterSummary,
  completenessTabCounts,
  noteCountForTab,
  completenessTabSearch,
  filterByCompletenessTab,
  parseCompletenessTab,
} from "@/lib/completeness-tabs";
import { splitByCompleteness } from "@/lib/transaction-completeness";
import { validateTxSearch } from "@/lib/tx-search";

// Synthetic rows only.
const base = {
  potential_id: "SYN-1",
  month: 9,
  year: 2026,
  customer_name: "Synthetic Customer",
  lab_name: "Synthetic Lab",
  cloud_provider: "Oracle",
  input_cost: 10,
  selling_cost: 20,
  total_users: 2,
};
const rows = [
  base,
  { ...base, potential_id: "SYN-2", selling_cost: 0 }, // 0 placeholder -> incomplete
  { ...base, potential_id: "SYN-3", cloud_provider: "" }, // required blank -> incomplete
  { ...base, potential_id: "SYN-4", cloud_provider: "SAP" },
];

describe("SCRUM-131 completeness tabs", () => {
  it("counts match the Completeness card (same rule)", () => {
    const counts = completenessTabCounts(rows);
    const split = splitByCompleteness(rows);
    expect(counts).toEqual({ all: 4, complete: 2, incomplete: 2 });
    expect(counts.complete).toBe(split.complete.count);
    expect(counts.incomplete).toBe(split.incomplete.count);
  });

  it("filters rows by tab", () => {
    expect(filterByCompletenessTab(rows, "all")).toHaveLength(4);
    expect(filterByCompletenessTab(rows, "complete").map((r) => r.potential_id)).toEqual([
      "SYN-1",
      "SYN-4",
    ]);
    expect(filterByCompletenessTab(rows, "incomplete").map((r) => r.potential_id)).toEqual([
      "SYN-2",
      "SYN-3",
    ]);
  });

  it("filter summary and the per-tile note follow the tab", () => {
    expect(completenessFilterSummary("all", 4)).toBeNull();
    expect(completenessFilterSummary("incomplete", 12)).toBe("Showing 12 incomplete rows");
    expect(completenessFilterSummary("complete", 1)).toBe("Showing 1 complete row");
    expect(noteCountForTab("all", 3)).toBe(3);
    expect(noteCountForTab("incomplete", 3)).toBe(0);
    expect(noteCountForTab("complete", 3)).toBe(0);
  });

  it("filtered summaries add up to the All totals (T22)", () => {
    const sum = (rs: typeof rows) => rs.reduce((t, r) => t + r.selling_cost, 0);
    const all = filterByCompletenessTab(rows, "all");
    const c = filterByCompletenessTab(rows, "complete");
    const i = filterByCompletenessTab(rows, "incomplete");
    expect(c.length + i.length).toBe(all.length);
    expect(sum(c) + sum(i)).toBe(sum(all));
  });

  it("round-trips through the URL search param (default All, omitted)", () => {
    expect(parseCompletenessTab(undefined)).toBe("all");
    expect(parseCompletenessTab("bogus")).toBe("all");
    expect(parseCompletenessTab("incomplete")).toBe("incomplete");
    expect(completenessTabSearch("all")).toBeUndefined();
    expect(completenessTabSearch("complete")).toBe("complete");
    expect(validateTxSearch({ completeness: "incomplete" }).completeness).toBe("incomplete");
    expect(validateTxSearch({ completeness: "nope" }).completeness).toBeUndefined();
    expect(validateTxSearch({}).completeness).toBeUndefined();
  });
});
