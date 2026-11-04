import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KPI_FY_START_MONTH,
  KPI_PERIOD_RULES,
  dataMonthsOf,
  formatKpiComparison,
  formatKpiDelta,
  formatKpiPeriod,
  kpiDeltaA11yLabel,
  kpiDeltaDirection,
  kpiDeltaTone,
  kpiPeriodFor,
  previousKpiPeriod,
  resolveKpiPeriod,
  rowsInKpiPeriod,
  type KpiDelta,
  type KpiPeriod,
  type KpiPeriodRuleId,
} from "@/lib/kpi-period";
import { FINANCIAL_YEAR_START_MONTH } from "@/components/summaries/dashboard-summary-utils";

const today = new Date(2026, 9, 6); // 6 Oct 2026 (local)

describe("KPI_PERIOD_RULES: today's real behaviour, labelled (Chief Q6 pending)", () => {
  it.each<[KpiPeriodRuleId, string]>([
    ["cloud.totals", "All time"],
    ["cloud.live", "Now"],
    ["cloud.completeness", "All time"],
    ["cloud.batches", "All time"],
    ["cloud.batchState", "Now"],
    ["agents.registry", "Now"],
    ["agents.runs", "Latest 300 runs"],
    ["agents.inbox", "Latest 500 items"],
    ["aicc.inbox", "Latest 300 items"],
    ["aicc.runs", "Latest 300 runs"],
    ["aicc.runsToday", "Today (UTC)"],
    // No data: falls back to today's month (the Dashboard falls back the same way).
    ["dashboard.fyMoney", "FY to date (from Oct) · Oct 2026–Oct 2026"],
    ["dashboard.month", "Latest month with data: Oct 2026"],
    ["dashboard.cloudCount", "Latest month with data: Oct 2026"],
    ["reports.totals", "All time"],
    ["tickets.state", "Now"],
    ["tickets.last7", "Last 7 days"],
    ["tickets.dueToday", "Today (UTC)"],
    ["import.preview", "This file"],
    ["import.stage", "This file"],
    ["sync.state", "Now"],
    ["sync.last24h", "Last 24 h"],
  ])("%s → %s", (id, label) => {
    expect(formatKpiPeriod(kpiPeriodFor(id, [], today))).toBe(label);
  });

  it("every rule id is covered by the table above", () => {
    expect(Object.keys(KPI_PERIOD_RULES)).toHaveLength(22);
  });

  it("the FY start month is one value, shared with the Dashboard utils (Oct today)", () => {
    expect(KPI_FY_START_MONTH).toBe(10);
    expect(FINANCIAL_YEAR_START_MONTH).toBe(KPI_FY_START_MONTH);
    expect(KPI_PERIOD_RULES["dashboard.fyMoney"]).toMatchObject({
      fyStartMonth: KPI_FY_START_MONTH,
    });
  });
});

// Data shape from John's live check (LIVE-PLATFORM-CHECK.md §3-§5): 492 rows in Oct 2025–Sep 2026;
// Public's latest month with data is Aug 2026, All/Private's is Sep 2026. Checked on 6 Oct 2026.
describe("Dashboard rules on the live-check data shape (today's behaviour, now labelled)", () => {
  const fy = (from: number, through: number) =>
    Array.from({ length: through - from + 1 }, (_, i) => {
      const k = from + i;
      return { year: Math.floor(k / 12), month: (k % 12) + 1 };
    });
  const allMonths = fy(2025 * 12 + 9, 2026 * 12 + 8); // Oct 2025 … Sep 2026
  const publicMonths = fy(2025 * 12 + 9, 2026 * 12 + 7); // Oct 2025 … Aug 2026

  it("N14/N17: the month tiles name the latest month with data, which differs per cloud", () => {
    expect(formatKpiPeriod(kpiPeriodFor("dashboard.month", allMonths, today))).toBe(
      "Latest month with data: Sep 2026",
    );
    expect(formatKpiPeriod(kpiPeriodFor("dashboard.month", publicMonths, today))).toBe(
      "Latest month with data: Aug 2026",
    );
    // …which is not the calendar month (Q6 option), so the two resolve differently.
    expect(formatKpiPeriod(resolveKpiPeriod({ resolve: "calendar-month" }, allMonths, today))).toBe(
      "Calendar month: Oct 2026",
    );
  });

  it("N16: the money tiles are FY to date from October, through the latest month with data", () => {
    const p = kpiPeriodFor("dashboard.fyMoney", allMonths, today);
    expect(formatKpiPeriod(p)).toBe("FY to date (from Oct) · Oct 2025–Sep 2026");
    // The FY window moves on once an Oct-2026 row exists (live check §5 item 2).
    const withOct = [...allMonths, { year: 2026, month: 10 }];
    expect(formatKpiPeriod(kpiPeriodFor("dashboard.fyMoney", withOct, today))).toBe(
      "FY to date (from Oct) · Oct 2026–Oct 2026",
    );
  });

  it("today's Dashboard does not cap at today: a future-dated month counts as latest", () => {
    const future = [...allMonths, { year: 2027, month: 1 }];
    expect(formatKpiPeriod(kpiPeriodFor("dashboard.month", future, today))).toBe(
      "Latest month with data: Jan 2027",
    );
    // The generic rule (Peter's default) ignores future months.
    expect(
      formatKpiPeriod(resolveKpiPeriod({ resolve: "latest-month-with-data" }, future, today)),
    ).toBe("Latest month with data: Sep 2026");
  });

  it("label and maths share one object: rowsInKpiPeriod uses exactly the labelled months", () => {
    const rows = [...allMonths.map((m, i) => ({ id: i, ...m }))];
    const p = kpiPeriodFor("dashboard.month", publicMonths, today);
    expect(rowsInKpiPeriod(rows, p).map((r) => `${r.year}-${r.month}`)).toEqual(["2026-8"]);
    expect(rowsInKpiPeriod(rows, kpiPeriodFor("dashboard.fyMoney", allMonths, today))).toHaveLength(
      12,
    );
  });
});

describe("formatter and resolver (for Chief's Q6 options)", () => {
  const months = [
    { year: 2026, month: 8 },
    { year: 2026, month: 9 },
    { year: 2026, month: 11 }, // future month is ignored for "latest with data"
  ];
  it("latest month with data", () => {
    const p = resolveKpiPeriod({ resolve: "latest-month-with-data" }, months, today);
    expect(formatKpiPeriod(p)).toBe("Latest month with data: Sep 2026");
  });
  it("calendar month", () => {
    expect(formatKpiPeriod(resolveKpiPeriod({ resolve: "calendar-month" }, [], today))).toBe(
      "Calendar month: Oct 2026",
    );
  });
  it("FY to date from October", () => {
    const p = resolveKpiPeriod({ resolve: "fy-to-date", fyStartMonth: 10 }, [], today);
    expect(formatKpiPeriod(p)).toBe("FY to date (from Oct) · Oct 2026–Oct 2026");
    const p2 = resolveKpiPeriod({ resolve: "fy-to-date", fyStartMonth: 4 }, [], today);
    expect(formatKpiPeriod(p2)).toBe("FY to date (from Apr) · Apr 2026–Oct 2026");
  });
  it.each(Array.from({ length: 12 }, (_, i) => i + 1))(
    "FY to date honours fyStartMonth %i and crosses the year boundary",
    (start) => {
      const p = resolveKpiPeriod({ resolve: "fy-to-date", fyStartMonth: start }, [], today);
      if (p.kind !== "fy-to-date") throw new Error("kind");
      expect(p.from.month).toBe(start);
      // From start month (this year if already reached by October, else last year) to Oct 2026.
      expect(p.from.year).toBe(start <= 10 ? 2026 : 2025);
      expect(p.through).toEqual({ year: 2026, month: 10 });
      expect(formatKpiPeriod(p)).toMatch(/^FY to date \(from [A-Z][a-z]{2}\) · /);
    },
  );

  it("year labels", () => {
    expect(formatKpiPeriod({ kind: "year", year: 2026, basis: "calendar" })).toBe("Year 2026");
    expect(
      formatKpiPeriod({ kind: "year", year: 2025, basis: "financial", fyStartMonth: 10 }),
    ).toBe("FY 2025–26 (Oct–Sep)");
  });
  it("rowsInKpiPeriod filters month windows and keeps all rows otherwise", () => {
    const rows = [
      { id: 1, year: 2026, month: 8 },
      { id: 2, year: 2026, month: 9 },
      { id: 3, year: null, month: null },
    ];
    expect(rowsInKpiPeriod(rows, { kind: "all-time" })).toHaveLength(3);
    expect(
      rowsInKpiPeriod(rows, {
        kind: "month",
        month: { year: 2026, month: 9 },
        basis: "calendar",
      }).map((r) => r.id),
    ).toEqual([2]);
    expect(dataMonthsOf(rows)).toHaveLength(2);
  });
});

// Guard (plan §4.2 / C13): every <SummaryKpi in src passes period=, and no period word sits
// in a label or subline (the period line says it once). Type-checking also enforces period.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : walk(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("SummaryKpi period guard", () => {
  const files = walk(join(__dirname, "..", ".."));
  const blocks = files.flatMap((f) => {
    const src = readFileSync(f, "utf8");
    return [...src.matchAll(/<SummaryKpi\b[\s\S]*?\/>/g)].map((m) => ({ f, block: m[0] }));
  });

  it("finds the tiles", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(33);
  });

  it("every <SummaryKpi> has a period prop", () => {
    const missing = blocks.filter((b) => !/\bperiod=\{/.test(b.block)).map((b) => b.f);
    expect(missing).toEqual([]);
  });

  it("no period words in label or subline", () => {
    const bad = blocks
      .filter((b) => {
        const texts = [...b.block.matchAll(/(?:label|subline)=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
          (m) => m[1] ?? m[2] ?? "",
        );
        return texts.some((t) => /\b(FY|FYTD|Current|this month|last month|today)\b/i.test(t));
      })
      .map((b) => b.f);
    expect(bad).toEqual([]);
  });

  it("no local SummaryKpi copies", () => {
    const local = files.filter(
      (f) =>
        !f.endsWith("summary-kpi.tsx") && /function SummaryKpi\(/.test(readFileSync(f, "utf8")),
    );
    expect(local).toEqual([]);
  });
});

describe("every KpiPeriod kind formats to a non-empty label", () => {
  const kinds: KpiPeriod[] = [
    {
      kind: "fy-to-date",
      fyStartMonth: 4,
      from: { year: 2026, month: 4 },
      through: { year: 2026, month: 9 },
    },
    { kind: "month", month: { year: 2026, month: 9 }, basis: "latest-with-data" },
    { kind: "month", month: { year: 2026, month: 10 }, basis: "calendar" },
    { kind: "year", year: 2026, basis: "calendar" },
    { kind: "year", year: 2025, basis: "financial", fyStartMonth: 4 },
    { kind: "range", from: { year: 2025, month: 10 }, through: { year: 2026, month: 8 } },
    { kind: "all-time" },
    { kind: "rolling", hours: 24 },
    { kind: "now" },
    { kind: "today", timeZone: "Asia/Kolkata" },
    { kind: "latest-records", limit: 300, noun: "runs" },
    { kind: "file" },
  ];
  it.each(kinds)("%o", (p) => {
    expect(formatKpiPeriod(p).trim().length).toBeGreaterThan(0);
    expect(formatKpiComparison(p).trim().length).toBeGreaterThan(0);
  });
  it("plan §4.2 examples", () => {
    expect(formatKpiPeriod(kinds[5])).toBe("Oct 2025–Aug 2026");
    expect(formatKpiPeriod(kinds[7])).toBe("Last 24 h");
  });
});

describe("delta standard (N15)", () => {
  const aug: KpiPeriod = { kind: "month", month: { year: 2026, month: 8 }, basis: "calendar" };
  const fytdAug: KpiPeriod = {
    kind: "fy-to-date",
    fyStartMonth: 10,
    from: { year: 2025, month: 10 },
    through: { year: 2026, month: 8 },
  };
  const lines = { one: "line", other: "lines" };
  const d = (over: Partial<KpiDelta>): KpiDelta => ({
    value: 0,
    unit: "percent",
    comparedWith: aug,
    goodWhen: "up",
    ...over,
  });

  it("signs every change with + or U+2212 and names the comparison", () => {
    expect(formatKpiDelta(d({ value: -17, unit: "count", noun: lines }))).toBe(
      "−17 lines vs Aug 2026",
    );
    expect(formatKpiDelta(d({ value: -17, unit: "count", noun: lines }))).toContain("\u2212");
    expect(formatKpiDelta(d({ value: -17, unit: "count", noun: lines }))).not.toContain("-");
    expect(formatKpiDelta(d({ value: 2.6 }))).toBe("+2.6% vs Aug 2026");
    expect(formatKpiDelta(d({ value: -72.8 }))).toBe("−72.8% vs Aug 2026");
    expect(formatKpiDelta(d({ value: 0.4, unit: "points", comparedWith: fytdAug }))).toBe(
      "+0.4 pts vs end of Aug 2026",
    );
    expect(formatKpiDelta(d({ value: 1, unit: "count", noun: lines }))).toBe("+1 line vs Aug 2026");
    expect(formatKpiDelta(d({ value: 1234, unit: "count" }))).toBe("+1,234 vs Aug 2026");
    expect(formatKpiDelta(d({ value: -120000, unit: "currency" }))).toBe("−₹1.2L vs Aug 2026");
  });

  it("never says 'new' and never uses Math.abs on the value", () => {
    expect(formatKpiDelta(d({ value: -17, unit: "count", noun: lines }))).not.toMatch(/\bnew\b/);
  });

  it("rounds half away from zero like the old toFixed(1) text (C20, Eng QC S1)", () => {
    expect(formatKpiDelta(d({ value: -19.85 }))).toBe("−19.9% vs Aug 2026");
    expect(formatKpiDelta(d({ value: 19.85 }))).toBe("+19.9% vs Aug 2026");
    expect(formatKpiDelta(d({ value: -0.05 }))).toBe("−0.1% vs Aug 2026");
    expect(formatKpiDelta(d({ value: 0.05 }))).toBe("+0.1% vs Aug 2026");
    expect(kpiDeltaDirection(d({ value: -0.05 }))).toBe("down");
    expect(kpiDeltaDirection(d({ value: 0.05 }))).toBe("up");
    expect(formatKpiDelta(d({ value: -19.85, unit: "points", comparedWith: fytdAug }))).toBe(
      "−19.9 pts vs end of Aug 2026",
    );
    expect(formatKpiDelta(d({ value: 0 }))).toBe("No change");
    expect(formatKpiDelta(d({ value: -0 }))).toBe("No change");
  });

  it("agrees with the old Dashboard text on every value, ties and float pitfalls included", () => {
    // 73ec842 dashboard-super-admin-summary.tsx:1122-1184: `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`
    // (and " pts" for margin). The only intended difference: a value the old code printed as
    // "+0.0" / "-0.0" now reads "No change" (N15).
    const old = (v: number, suffix: string) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix}`;
    const values: number[] = [19.85, -19.85, 0.05, -0.05, 0.15, -0.15, 1.45, -1.45, 2.675, -2.675];
    for (let k = -20000; k <= 20000; k++) values.push(k / 100); // every x.x5 tie up to ±200
    for (let k = -100000; k <= 100000; k += 7) values.push(k / 100); // ties up to ±1,000, sampled
    for (let k = -2000; k <= 2000; k++) values.push(k / 20, k / 40, k * 0.07, k * 0.035);
    let seed = 42;
    for (let i = 0; i < 10000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push(((seed / 2147483648) * 2 - 1) * 999.99);
    }
    let compared = 0;
    for (const v of values) {
      for (const [unit, suffix] of [
        ["percent", "%"],
        ["points", " pts"],
      ] as const) {
        const want = old(v, suffix);
        const got = formatKpiDelta(d({ value: v, unit }));
        if (/^[+-]0\.0/.test(want)) {
          expect(got, `${v}`).toBe("No change");
          continue;
        }
        const shown = got
          .split(" vs ")[0]
          .replace(/\u2212/g, "-")
          .replace(/,/g, "");
        if (shown !== want) expect(`${v} ${unit}: ${shown}`).toBe(`${v} ${unit}: ${want}`);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100000);
  }, 120_000);

  it("0, and values that round to 0, read 'No change'", () => {
    expect(formatKpiDelta(d({ value: 0 }))).toBe("No change");
    expect(formatKpiDelta(d({ value: -0.04 }))).toBe("No change");
    expect(kpiDeltaDirection(d({ value: -0.04 }))).toBe("none");
    expect(formatKpiDelta(d({ value: Number.NaN }))).toBe("—");
  });

  it("a11y label says Up / Down / No change and names the period", () => {
    expect(kpiDeltaA11yLabel(d({ value: -17, unit: "count", noun: lines }))).toBe(
      "Down 17 lines compared with Aug 2026",
    );
    expect(kpiDeltaA11yLabel(d({ value: 2.6 }))).toBe("Up 2.6% compared with Aug 2026");
    expect(kpiDeltaA11yLabel(d({ value: 0 }))).toBe("No change compared with Aug 2026");
  });

  it("colour comes from direction x goodWhen (a rise in cost is bad)", () => {
    expect(kpiDeltaTone(d({ value: 5, goodWhen: "up" }))).toBe("positive");
    expect(kpiDeltaTone(d({ value: 5, goodWhen: "down" }))).toBe("negative");
    expect(kpiDeltaTone(d({ value: -5, goodWhen: "down" }))).toBe("positive");
    expect(kpiDeltaTone(d({ value: -5, goodWhen: "neither" }))).toBe("neutral");
    expect(kpiDeltaTone(d({ value: 0, goodWhen: "up" }))).toBe("neutral");
  });

  it("previousKpiPeriod: the month before, and FY to date to the end of the month before", () => {
    const sep: KpiPeriod = {
      kind: "month",
      month: { year: 2026, month: 9 },
      basis: "latest-with-data",
    };
    expect(previousKpiPeriod(sep)).toEqual(aug);
    const jan: KpiPeriod = { kind: "month", month: { year: 2026, month: 1 }, basis: "calendar" };
    expect(previousKpiPeriod(jan)).toEqual({
      kind: "month",
      month: { year: 2025, month: 12 },
      basis: "calendar",
    });
    const fytdSep: KpiPeriod = { ...fytdAug, through: { year: 2026, month: 9 } };
    expect(previousKpiPeriod(fytdSep)).toEqual(fytdAug);
    expect(formatKpiComparison(previousKpiPeriod(fytdSep)!)).toBe("end of Aug 2026");
    // First month of the FY: nothing to compare with (today's Dashboard shows no delta then).
    expect(previousKpiPeriod({ ...fytdAug, through: { year: 2025, month: 10 } })).toBeNull();
    expect(previousKpiPeriod({ kind: "all-time" })).toBeNull();
  });
});
