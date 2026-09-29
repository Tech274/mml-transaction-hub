import { describe, expect, it } from "vitest";

const src = import.meta.glob("/src/lib/mcp/tools/reports-summary.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("reports_summary finance visibility guard", () => {
  const code = src["/src/lib/mcp/tools/reports-summary.ts"];

  it("loads role visibility and redacts finance totals when not allowed", () => {
    expect(code).toContain("loadFinanceVisibilityForUser");
    expect(code).toContain("finance_totals_visible");
    expect(code).toContain("visibility.canViewFinanceTotals ? revenue : null");
    expect(code).toContain("visibility.canViewFinanceTotals ? cost : null");
    expect(code).toContain("visibility.canViewFinanceTotals ? profit : null");
    expect(code).toContain("visibility.canViewFinanceTotals ? Math.round(margin_pct * 100) / 100 : null");
  });
});
