import { describe, expect, it } from "vitest";
import {
  buildFytdComparison,
  buildTimelineFromPoints,
  financialYearWindow,
  resolveFinancialYearEnd,
  includesDashboardPeriod,
  parseDashboardPeriod,
  previousMonth,
} from "@/components/summaries/dashboard-summary-utils";

describe("dashboard summary period helpers", () => {
  it("parses year and month period tokens", () => {
    expect(parseDashboardPeriod("all")).toEqual({ kind: "all" });
    expect(parseDashboardPeriod("year:2026")).toEqual({ kind: "year", year: 2026 });
    expect(parseDashboardPeriod("month:2026-9")).toEqual({ kind: "month", year: 2026, month: 9 });
  });

  it("matches rows to selected periods", () => {
    expect(includesDashboardPeriod(2026, 9, "all")).toBe(true);
    expect(includesDashboardPeriod(2026, 9, "year:2026")).toBe(true);
    expect(includesDashboardPeriod(2025, 9, "year:2026")).toBe(false);
    expect(includesDashboardPeriod(2026, 9, "month:2026-9")).toBe(true);
    expect(includesDashboardPeriod(2026, 8, "month:2026-9")).toBe(false);
  });

  it("builds a continuous month timeline across gaps", () => {
    expect(
      buildTimelineFromPoints(
        [
          { year: 2025, month: 11 },
          { year: 2026, month: 2 },
        ],
        "all",
      ),
    ).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });

  it("rolls previous month across year boundaries", () => {
    expect(previousMonth({ year: 2026, month: 9 })).toEqual({ year: 2026, month: 8 });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it("builds an Oct-Sep financial-year window", () => {
    expect(financialYearWindow(2026)).toEqual([
      { year: 2025, month: 10 },
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  it("resolves financial year end from filter period", () => {
    const fallback = { year: 2026, month: 9 };
    expect(resolveFinancialYearEnd("all", { year: 2026, month: 9 }, fallback)).toBe(2026);
    expect(resolveFinancialYearEnd("month:2026-10", { year: 2026, month: 9 }, fallback)).toBe(2027);
    expect(resolveFinancialYearEnd("year:2025", { year: 2026, month: 9 }, fallback)).toBe(2025);
  });

  it("computes FYTD comparison against end of previous month", () => {
    const points = [
      { index: 0, revenue: 100, inputCost: 60 },
      { index: 1, revenue: 200, inputCost: 120 },
      { index: 2, revenue: 250, inputCost: 125 },
    ];
    const result = buildFytdComparison(points, 2);
    expect(result.currentRevenue).toBe(550);
    expect(result.currentCost).toBe(305);
    expect(result.currentProfit).toBe(245);
    expect(result.previousRevenue).toBe(300);
    expect(result.previousCost).toBe(180);
    expect(result.previousProfit).toBe(120);
    expect(result.currentMarginPct).toBeCloseTo(44.5454, 3);
    expect(result.previousMarginPct).toBeCloseTo(40, 4);
  });

  it("returns empty previous FYTD values at the first month", () => {
    const points = [{ index: 0, revenue: 0, inputCost: 0 }];
    expect(buildFytdComparison(points, 0)).toMatchObject({
      currentRevenue: 0,
      currentCost: 0,
      previousRevenue: null,
      previousCost: null,
      previousProfit: null,
      previousMarginPct: null,
    });
  });
});
