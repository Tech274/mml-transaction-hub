// SCRUM-128 plan §4 (C4): the shared components render the standard markup. Rendered to static
// HTML in the node test environment (no DOM needed); pages adopt them from C5 on.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChartCard, ChartLegendRow } from "@/components/summaries/chart-card";
import { NoDataYet } from "@/components/summaries/no-data-yet";
import { KpiGrid, SummaryKpi, KPI_GRID_CLASS } from "@/components/summaries/summary-kpi";
import { ErrorState, LoadingState } from "@/components/page-states";
import { SortableHead, TablePagination, TableStateRow } from "@/components/data-table-parts";
import { FilterBar, FilterSearch, FilterSelect, FilterSummary } from "@/components/filter-bar";
import { HealerFixBadge, IncompleteBadge } from "@/components/status-badges";
import { Badge, badgeVariants } from "@/components/ui/badge";
import type { KpiPeriod } from "@/lib/kpi-period";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const sep: KpiPeriod = {
  kind: "month",
  month: { year: 2026, month: 9 },
  basis: "latest-with-data",
};
const aug: KpiPeriod = { kind: "month", month: { year: 2026, month: 8 }, basis: "calendar" };

describe("SummaryKpi (§4.2)", () => {
  it("renders label, value, note, delta, period, subline in that order", () => {
    const out = html(
      h(SummaryKpi, {
        label: "Private cloud",
        value: "23",
        period: sep,
        note: "12 incomplete · ₹1.2L",
        noteTitle: "Includes 12 incomplete rows · ₹1,20,000",
        delta: {
          value: -17,
          unit: "count",
          noun: { one: "line", other: "lines" },
          comparedWith: aug,
          goodWhen: "neither",
        },
        subline: "MakeMyLabs Private Cloud",
      }),
    );
    const order = [
      'title="Private cloud"',
      'title="23"',
      'data-testid="kpi-incomplete-note"',
      'data-testid="kpi-delta"',
      'data-testid="kpi-period"',
      'title="MakeMyLabs Private Cloud"',
    ].map((s) => out.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("Latest month with data: Sep 2026");
    expect(out).toContain('title="Includes 12 incomplete rows · ₹1,20,000"');
  });

  it("delta: U+2212 text, an aria-hidden arrow, an sr-only sentence and a tone colour", () => {
    const out = html(
      h(SummaryKpi, {
        label: "Total input cost",
        value: "₹7,43,100",
        period: sep,
        delta: { value: 12.5, unit: "percent", comparedWith: aug, goodWhen: "down" },
      }),
    );
    expect(out).toContain("+12.5% vs Aug 2026");
    expect(out).toContain('<span class="sr-only">Up 12.5% compared with Aug 2026</span>');
    expect(out).toContain("text-destructive"); // a rise in cost is bad
    const down = html(
      h(SummaryKpi, {
        label: "Lines",
        value: "6",
        period: sep,
        delta: { value: -17, unit: "count", comparedWith: aug, goodWhen: "up" },
      }),
    );
    expect(down).toContain("\u221217 vs Aug 2026");
    expect(down).toContain("lucide-arrow-down");
  });

  it("the period line is always rendered; no delta line without a delta", () => {
    const out = html(
      h(SummaryKpi, { label: "Users", value: "1,204", period: { kind: "all-time" } }),
    );
    expect(out).toContain('data-testid="kpi-period"');
    expect(out).toContain("All time");
    expect(out).not.toContain("kpi-delta");
    expect(out).not.toContain("kpi-incomplete-note");
  });

  it("sublineTone colours the subline only; inset variant; value is text-xl tabular-nums", () => {
    const out = html(
      h(SummaryKpi, {
        label: "Status",
        value: "3",
        period: { kind: "now" },
        subline: "Needs action",
        sublineTone: "negative",
        variant: "inset",
      }),
    );
    expect(out).toMatch(/class="mt-1 truncate text-xs text-destructive" title="Needs action"/);
    expect(out).toContain("rounded-md border border-border px-3 py-2");
    expect(out).toContain("text-xl font-semibold tabular-nums");
    expect(out).not.toMatch(/text-(2xl|lg|\[)/);
  });

  it("KpiGrid renders the 1 / 2 / 4 grid", () => {
    expect(html(h(KpiGrid, { children: "x" }))).toBe(`<div class="${KPI_GRID_CLASS}">x</div>`);
    expect(html(h(KpiGrid, { inset: true, children: "x" }))).toContain("grid gap-2 grid-cols-2");
  });
});

describe("Badges (§4.8)", () => {
  it("adds success / warning / info and whitespace-nowrap to every badge", () => {
    expect(badgeVariants({ variant: "success" })).toContain("bg-success/10 text-success");
    expect(badgeVariants({ variant: "warning" })).toContain("bg-warning/10 text-warning");
    expect(badgeVariants({ variant: "info" })).toContain("bg-accent text-accent-foreground");
    for (const v of ["default", "secondary", "destructive", "outline", "success"] as const) {
      expect(badgeVariants({ variant: v })).toContain("whitespace-nowrap");
      expect(badgeVariants({ variant: v })).toContain("rounded-md");
    }
    expect(html(h(Badge, { variant: "info" }, "Example data"))).toContain("bg-accent");
  });

  it("IncompleteBadge is the amber warning badge, with the row's reasons on hover", () => {
    const out = html(h(IncompleteBadge, { reasons: ["price_missing_or_zero"] }));
    expect(out).toContain('data-testid="incomplete-badge"');
    expect(out).toContain("bg-warning/10 text-warning");
    expect(out).not.toContain("destructive");
    expect(out).toContain('title="Incomplete: a price is missing or 0"');
    expect(html(h(IncompleteBadge, {}))).toContain(
      'title="Incomplete: a price is missing or 0, or a required field is blank"',
    );
    expect(
      html(h(IncompleteBadge, { reasons: ["price_missing_or_zero", "required_blank"] })),
    ).toContain('title="Incomplete: a price is missing or 0, and a required field is blank"');
  });

  it("HealerFixBadge is the info badge with a Wand icon; (blank) for an empty original", () => {
    const out = html(
      h(HealerFixBadge, { from: " ", to: "0", rule: "Blank price, rule price.blank_to_zero" }),
    );
    expect(out).toContain('data-testid="healer-fix-badge"');
    expect(out).toContain("bg-accent text-accent-foreground");
    expect(out).toContain("(blank) → 0");
    expect(out).toContain('title="(blank) → 0 (Blank price, rule price.blank_to_zero)"');
    expect(out).toContain("lucide-wand");
    expect(out).not.toMatch(/warning|destructive/);
  });
});

describe("ChartCard and NoDataYet (§4.3, §4.4)", () => {
  it("ChartCard: Card, text-sm title, optional description and wrapping action", () => {
    const out = html(
      h(ChartCard, {
        title: "Revenue by month",
        description: "FY to date",
        action: h("a", null, "View all →"),
        children: "chart",
      }),
    );
    expect(out).toContain("text-sm");
    expect(out).toContain("Revenue by month");
    expect(out).toContain("FY to date");
    expect(out).toContain("sm:flex-row sm:items-start sm:justify-between");
    expect(out).toContain("shrink-0 flex-wrap gap-2");
    expect(html(h(ChartCard, { title: "T", children: "c" }))).not.toContain("sm:flex-row");
  });

  it("legend row uses literal series classes, no inline style", () => {
    const out = html(
      h(ChartLegendRow, {
        items: [
          { label: "Revenue", value: "₹7.4L", dotClass: "bg-chart-2" },
          { label: "Input cost", dotClass: "bg-chart-4" },
        ],
      }),
    );
    expect(out).toContain("bg-chart-2");
    expect(out).toContain("₹7.4L");
    expect(out).not.toContain("style=");
  });

  it("NoDataYet is chart height by default and min-h-24 when compact", () => {
    expect(html(h(NoDataYet, {}))).toContain("min-h-[260px]");
    expect(html(h(NoDataYet, {}))).toContain("No data yet");
    expect(html(h(NoDataYet, { compact: true, message: "No alerts" }))).toContain("min-h-24");
  });
});

describe("Page states (§4.9)", () => {
  it("LoadingState: standalone Card or inside a card", () => {
    expect(html(h(LoadingState, { thing: "tickets" }))).toContain("Loading tickets…");
    expect(html(h(LoadingState, { thing: "tickets", inCard: true }))).toContain(
      "py-8 text-center text-sm text-muted-foreground",
    );
  });

  it("ErrorState: destructive alert, 'Could not load {thing}', message, optional Retry", () => {
    const out = html(
      h(ErrorState, { thing: "dashboard", error: new Error("timeout"), onRetry: () => {} }),
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain("Could not load dashboard");
    expect(out).toContain("timeout");
    expect(out).toContain("Retry");
    expect(html(h(ErrorState, { thing: "x" }))).not.toContain("Retry");
    expect(html(h(ErrorState, { thing: "x" }))).toContain("Unknown error");
    expect(html(h(ErrorState, { thing: "x", error: "boom" }))).toContain("boom");
  });
});

describe("Table parts (§4.5)", () => {
  const inTable = (el: ReactElement) => html(h("table", null, h("tbody", null, el)));

  it("TableStateRow spans the columns with the standard text", () => {
    const out = inTable(
      h(TableStateRow, { colSpan: 7, children: "No tickets match these filters." }),
    );
    expect(out).toContain('colSpan="7"');
    expect(out).toContain("py-8 text-center text-sm text-muted-foreground");
    expect(out).toContain("No tickets match these filters.");
  });

  it("TablePagination: Page X of Y with disabled ends; hidden for one page", () => {
    const out = html(h(TablePagination, { page: 1, pageCount: 3, onPageChange: () => {} }));
    expect(out).toContain("Page 1 of 3");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Previous<\/button>/);
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Next<\/button>/);
    expect(html(h(TablePagination, { page: 1, pageCount: 1, onPageChange: () => {} }))).toBe("");
  });

  it("SortableHead sets aria-sort and uses a button", () => {
    const head = (active: boolean) =>
      html(
        h(
          "table",
          null,
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              h(SortableHead, { label: "Revenue", active, direction: "desc", onSort: () => {} }),
            ),
          ),
        ),
      );
    expect(head(true)).toContain('aria-sort="descending"');
    expect(head(true)).toContain("lucide-arrow-down");
    expect(head(false)).toContain('aria-sort="none"');
    expect(head(true)).toContain('<button type="button"');
  });
});

describe("Filter bar (§4.6)", () => {
  it("stacks below md and wraps from md; search has an accessible name", () => {
    const out = html(
      h(FilterBar, {
        summary: h(FilterSummary, { items: [{ label: "Showing", value: "1,234" }] }),
        children: h(FilterSearch, {
          value: "",
          onChange: () => {},
          placeholder: "Search customers…",
        }),
      }),
    );
    expect(out).toContain("flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center");
    expect(out).toContain('aria-label="Search"');
    expect(out).toContain("pl-9");
    expect(out).toContain("border-t border-border pt-3");
    expect(out).toContain("tabular-nums text-foreground");
  });

  it("FilterSelect: sr-only Label tied to the trigger, muted prefix, width sizes", () => {
    const out = html(
      h(FilterSelect, {
        id: "year",
        label: "Year",
        value: "all",
        onValueChange: () => {},
        allLabel: "All years",
        options: [{ value: "2026", label: "2026" }],
        width: "md",
      }),
    );
    expect(out).toMatch(
      /<label[^>]*class="[^"]*sr-only[^"]*"[^>]*for="year"[^>]*>Year<\/label>|<label[^>]*for="year"[^>]*class="[^"]*sr-only/,
    );
    expect(out).toContain('id="year"');
    expect(out).toContain('role="combobox"');
    expect(out).toContain("Year:");
    expect(out).toContain("md:w-64");
  });
});

describe("Dialog primitive (N13)", () => {
  it("long dialogs scroll inside the viewport", () => {
    const src = readFileSync(path.resolve(__dirname, "../ui/dialog.tsx"), "utf8");
    expect(src).toContain("max-h-[calc(100svh-2rem)]");
    expect(src).toMatch(/DialogPrimitive\.Content[\s\S]*overflow-y-auto/);
  });
});
