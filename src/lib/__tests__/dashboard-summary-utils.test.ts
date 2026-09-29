import { describe, expect, it } from "vitest";
import {
  buildTimelineFromPoints,
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
});
