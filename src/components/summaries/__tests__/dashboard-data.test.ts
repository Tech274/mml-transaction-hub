// SCRUM-128 C5: pins the Dashboard's numbers BEFORE its UI is rebuilt (plan R1: "every KPI value
// is compared before/after"). `todayKpis` below is a verbatim copy of the inline KPI code in
// dashboard-super-admin-summary.tsx at f3f01da (the chartTimeline useMemo and the block from
// `const periodSelection` to `privateCountDelta`). resolveDashboardKpis must return the same
// numbers for every filter on the example data, a live-check shaped fixture and 400 random
// fixtures. The literal values pin the example data so a change to the shared helpers shows too.
import { describe, expect, it } from "vitest";
import {
  buildFytdComparison,
  financialYearWindow,
  parseDashboardPeriod,
  resolveFinancialYearEnd,
  type DashboardPeriodFilter,
  type YearMonthPoint,
} from "@/components/summaries/dashboard-summary-utils";
import {
  EXAMPLE_INBOX,
  EXAMPLE_PROFILES,
  EXAMPLE_SYNC_OVERVIEW,
  EXAMPLE_TICKETS,
  EXAMPLE_TX_ROWS,
  EXAMPLE_USER_ROLES,
  applyTxFilters,
  buildPeriodOptions,
  buildTrendPoints,
  chartBaseRowsOf,
  cloudAndPeriodRowsOf,
  customerOptionsOf,
  dashboardFilterPeriod,
  dashboardViewer,
  filterDashboardInbox,
  filterDashboardTickets,
  inboxSummaryOf,
  lineCost,
  lobRowsOf,
  resolveDashboardKpis,
  summarizeFreshdeskRuns,
  ticketCountsOf,
  ticketsByAgentOf,
  toPctChange,
  toPointChange,
  topCustomersBy,
  topCustomersOf,
  userEntriesOf,
  type CloudFilter,
  type TxRow,
} from "@/components/summaries/dashboard-data";
import { formatKpiDelta, formatKpiPeriod, rowsInKpiPeriod } from "@/lib/kpi-period";
import { addNullable } from "@/lib/nullable-sum";

const TODAY = new Date(2026, 9, 6, 7, 30); // Tue 6 Oct 2026, 07:30 IST

/** Verbatim copy of today's inline code (f3f01da), with `new Date()` replaced by `today`. */
function todayKpis(chartBaseRows: TxRow[], periodFilter: DashboardPeriodFilter, today: Date) {
  const chartTimeline = (() => {
    const fallbackPoint = {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
    };
    const chartPoints: YearMonthPoint[] = chartBaseRows
      .filter(
        (row): row is TxRow & { year: number; month: number } =>
          typeof row.year === "number" && typeof row.month === "number",
      )
      .map((row) => ({ year: row.year, month: row.month }))
      .sort((a, b) => (a.year === b.year ? a.month - b.month : a.year - b.year));
    const latestChartPoint = chartPoints.at(-1) ?? null;
    const fyEndYear = resolveFinancialYearEnd(periodFilter, latestChartPoint, fallbackPoint);
    return financialYearWindow(fyEndYear);
  })();
  const trendRows = buildTrendPoints(chartBaseRows, chartTimeline);

  const periodSelection = parseDashboardPeriod(periodFilter);
  const selectedPeriodIndex =
    periodSelection.kind === "month"
      ? trendRows.findIndex(
          (row) => row.year === periodSelection.year && row.month === periodSelection.month,
        )
      : -1;
  const latestDataIndex = (() => {
    for (let idx = trendRows.length - 1; idx >= 0; idx -= 1) {
      if (trendRows[idx].lineCount > 0) return idx;
    }
    return -1;
  })();
  const currentPeriodIndex =
    selectedPeriodIndex >= 0
      ? selectedPeriodIndex
      : latestDataIndex >= 0
        ? latestDataIndex
        : trendRows.length > 0
          ? trendRows.length - 1
          : null;
  const currentTrendPoint =
    currentPeriodIndex !== null && currentPeriodIndex >= 0 ? trendRows[currentPeriodIndex] : null;
  const previousTrendPoint =
    currentPeriodIndex !== null && currentPeriodIndex > 0
      ? trendRows[currentPeriodIndex - 1]
      : null;

  const fytd = buildFytdComparison(
    trendRows.map((row, index) => ({ index, revenue: row.revenue, inputCost: row.inputCost })),
    currentPeriodIndex,
  );

  const totalRevenue = fytd.currentRevenue;
  const totalInputCost = fytd.currentCost;
  const totalProfit = fytd.currentProfit;
  const marginPct = fytd.currentMarginPct;

  const currentMonthRevenue = currentTrendPoint?.revenue ?? 0;
  const currentMonthProfit = currentTrendPoint?.profit ?? 0;
  const previousRevenue = previousTrendPoint?.revenue ?? null;
  const previousProfit = previousTrendPoint?.profit ?? null;
  const publicLineCount = currentTrendPoint?.publicCount ?? 0;
  const privateLineCount = currentTrendPoint?.privateCount ?? 0;
  const previousPublicCount = previousTrendPoint?.publicCount ?? null;
  const previousPrivateCount = previousTrendPoint?.privateCount ?? null;

  const revenueDelta = toPctChange(totalRevenue, fytd.previousRevenue);
  const costDelta = toPctChange(totalInputCost, fytd.previousCost);
  const profitDelta = toPctChange(totalProfit, fytd.previousProfit);
  const marginDelta = toPointChange(marginPct, fytd.previousMarginPct);
  const monthRevenueDelta = toPctChange(currentMonthRevenue, previousRevenue);
  const monthProfitDelta = toPctChange(currentMonthProfit, previousProfit);
  const publicCountDelta =
    previousPublicCount === null ? null : publicLineCount - previousPublicCount;
  const privateCountDelta =
    previousPrivateCount === null ? null : privateLineCount - previousPrivateCount;

  return {
    chartTimeline,
    trendRows,
    currentPeriodIndex,
    totalRevenue,
    totalInputCost,
    totalProfit,
    marginPct,
    currentMonthRevenue,
    currentMonthProfit,
    publicLineCount,
    privateLineCount,
    revenueDelta,
    costDelta,
    profitDelta,
    marginDelta,
    monthRevenueDelta,
    monthProfitDelta,
    publicCountDelta,
    privateCountDelta,
  };
}

/** Same numbers, field by field. */
function expectSameNumbers(rows: TxRow[], filter: DashboardPeriodFilter, today = TODAY) {
  if (filter === "all" && !rows.some((r) => r.year && r.month)) return expectEmptyAll(rows, today);
  const before = todayKpis(rows, filter, today);
  const after = resolveDashboardKpis(rows, filter, today);
  const label = `${filter} · ${rows.length} rows`;
  expect(after.timeline, label).toEqual(before.chartTimeline);
  expect(after.trendRows, label).toEqual(before.trendRows);
  expect(after.currentIndex, label).toBe(before.currentPeriodIndex);
  const pairs: Array<[string, number | null, number | null]> = [
    ["Revenue", after.totalRevenue, before.totalRevenue],
    ["Input cost", after.totalInputCost, before.totalInputCost],
    ["Profit", after.totalProfit, before.totalProfit],
    ["Margin", after.marginPct, before.marginPct],
    ["Month revenue", after.monthRevenue, before.currentMonthRevenue],
    ["Month profit", after.monthProfit, before.currentMonthProfit],
    ["Public cloud", after.publicLines, before.publicLineCount],
    ["Private cloud", after.privateLines, before.privateLineCount],
    ["revenue delta", after.revenueDelta, before.revenueDelta],
    ["cost delta", after.costDelta, before.costDelta],
    ["profit delta", after.profitDelta, before.profitDelta],
    ["margin delta", after.marginDelta, before.marginDelta],
    ["month revenue delta", after.monthRevenueDelta, before.monthRevenueDelta],
    ["month profit delta", after.monthProfitDelta, before.monthProfitDelta],
    ["public delta", after.publicLinesDelta, before.publicCountDelta],
    ["private delta", after.privateLinesDelta, before.privateCountDelta],
  ];
  // toEqual compares primitives with Object.is, so 0 vs -0 and null vs 0 count as different.
  expect(
    pairs.map(([name, a]) => [name, a]),
    label,
  ).toEqual(pairs.map(([name, , b]) => [name, b]));
  return after;
}

/**
 * "All months" with no dated rows. Today: the FY window of today's month, "current" = its LAST
 * month (Sep 2027), so the margin and count deltas compared 0 with 0 ("+0.0 pts", "+0 new lines").
 * Now: the rule's month (today, Oct 2026 = the FY's first month), so there is nothing to compare
 * with and no delta line. Every value is the same (0).
 */
function expectEmptyAll(rows: TxRow[], today = TODAY) {
  const before = todayKpis(rows, "all", today);
  const after = resolveDashboardKpis(rows, "all", today);
  expect(after.timeline).toEqual(before.chartTimeline);
  expect(after.trendRows).toEqual(before.trendRows);
  const values = (k: typeof after) => [
    k.totalRevenue,
    k.totalInputCost,
    k.totalProfit,
    k.marginPct,
    k.monthRevenue,
    k.monthProfit,
    k.publicLines,
    k.privateLines,
  ];
  expect(values(after)).toEqual([
    before.totalRevenue,
    before.totalInputCost,
    before.totalProfit,
    before.marginPct,
    before.currentMonthRevenue,
    before.currentMonthProfit,
    before.publicLineCount,
    before.privateLineCount,
  ]);
  expect(values(after).every((v) => v === 0)).toBe(true);
  expect([before.marginDelta, before.publicCountDelta, before.privateCountDelta]).toEqual([
    0, 0, 0,
  ]);
  expect([after.marginDelta, after.publicLinesDelta, after.privateLinesDelta]).toEqual([
    null,
    null,
    null,
  ]);
  for (const k of [
    "revenueDelta",
    "costDelta",
    "profitDelta",
    "monthRevenueDelta",
    "monthProfitDelta",
  ] as const) {
    expect(after[k]).toBeNull();
    expect(before[k]).toBeNull();
  }
  return after;
}

const CLOUDS: CloudFilter[] = ["all", "public_cloud", "private_cloud"];

function row(partial: Partial<TxRow> & Pick<TxRow, "year" | "month">): TxRow {
  return {
    customer_name: "Acme",
    line_of_business: "VILT",
    cloud_provider: "Azure",
    selling_cost: 1000,
    input_cost: 600,
    input_cost_actual_alloc: null,
    input_cost_auto: null,
    total_users: 10,
    repository_type: "public_cloud",
    potential_id: "P-1",
    lab_name: "Lab",
    ...partial,
  };
}

/** Live-check shape (LIVE-PLATFORM-CHECK.md §4): All's latest month Sep 2026, Public's Aug 2026. */
function liveShapeRows(): TxRow[] {
  const rows: TxRow[] = [];
  const months: YearMonthPoint[] = financialYearWindow(2026); // Oct 2025 - Sep 2026
  months.forEach((m, i) => {
    rows.push(
      row({
        ...m,
        repository_type: "private_cloud",
        selling_cost: 100000 + i * 7919,
        input_cost: 61000 + i * 3001,
        customer_name: `Cust ${i % 4}`,
      }),
    );
    if (!(m.year === 2026 && m.month === 9)) {
      rows.push(
        row({
          ...m,
          repository_type: "public_cloud",
          selling_cost: 50000 + i * 1237.5,
          input_cost: null,
          input_cost_actual_alloc: 30000 + i * 101.25,
          customer_name: `Cust ${(i + 1) % 4}`,
        }),
      );
      rows.push(
        row({
          ...m,
          repository_type: "public_cloud",
          selling_cost: null,
          input_cost: 0,
          potential_id: null,
        }),
      );
    }
  });
  return rows;
}

/** Deterministic random rows (mulberry32), including nulls, zero prices and future months. */
function randomRows(seed: number): TxRow[] {
  let t = seed >>> 0;
  const rnd = () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const money = () =>
    rnd() < 0.1 ? null : rnd() < 0.05 ? 0 : Math.round(rnd() * 200000) / (rnd() < 0.3 ? 100 : 1);
  const n = Math.floor(rnd() * 40);
  return Array.from({ length: n }, () =>
    row({
      year: pick([2024, 2025, 2025, 2026, 2026, 2026, 2027]),
      month: 1 + Math.floor(rnd() * 12),
      repository_type: pick(["public_cloud", "private_cloud"] as const),
      customer_name: rnd() < 0.05 ? null : pick(["Acme", "Globex", "Initech", "Umbrella"]),
      line_of_business: rnd() < 0.1 ? null : pick(["VILT", "Standalone", "Integrated"]),
      selling_cost: money(),
      input_cost: money(),
      input_cost_actual_alloc: rnd() < 0.5 ? null : money(),
      input_cost_auto: rnd() < 0.7 ? null : money(),
      total_users: rnd() < 0.1 ? null : Math.floor(rnd() * 60),
    }),
  );
}

function filtersFor(rows: TxRow[]): DashboardPeriodFilter[] {
  return [
    ...buildPeriodOptions(rows).map((o) => o.value),
    "year:2023",
    "year:2028",
    "month:2026-10",
    "month:2025-10",
  ];
}

describe("Dashboard KPI tiles: same numbers as today's inline code", () => {
  it("example data: every cloud, customer and period filter", () => {
    let cases = 0;
    for (const cloud of CLOUDS) {
      const customers = [
        "all",
        ...customerOptionsOf(cloudAndPeriodRowsOf(EXAMPLE_TX_ROWS, cloud, "all")),
      ];
      for (const customer of customers) {
        const base = chartBaseRowsOf(EXAMPLE_TX_ROWS, cloud, customer);
        for (const filter of filtersFor(EXAMPLE_TX_ROWS)) {
          expectSameNumbers(base, filter);
          cases += 1;
        }
      }
    }
    expect(cases).toBe(297);
  }, 60_000);

  it("live-check shape: Public's month is Aug 2026 while All's is Sep 2026", () => {
    const rows = liveShapeRows();
    for (const cloud of CLOUDS) {
      for (const filter of filtersFor(rows))
        expectSameNumbers(chartBaseRowsOf(rows, cloud, "all"), filter);
    }
    const all = resolveDashboardKpis(chartBaseRowsOf(rows, "all", "all"), "all", TODAY);
    const pub = resolveDashboardKpis(chartBaseRowsOf(rows, "public_cloud", "all"), "all", TODAY);
    expect(formatKpiPeriod(all.monthPeriod)).toBe("Latest month with data: Sep 2026");
    expect(formatKpiPeriod(pub.monthPeriod)).toBe("Latest month with data: Aug 2026");
    expect(formatKpiPeriod(all.fyPeriod)).toBe("FY to date (from Oct) · Oct 2025–Sep 2026");
    expect(formatKpiPeriod(pub.fyPeriod)).toBe("FY to date (from Oct) · Oct 2025–Aug 2026");
  });

  it("data in a future month is not capped at today (today's behaviour, N16/N17)", () => {
    const rows = [...liveShapeRows(), row({ year: 2026, month: 12, selling_cost: 5000 })];
    for (const filter of filtersFor(rows)) expectSameNumbers(rows, filter);
    expect(formatKpiPeriod(resolveDashboardKpis(rows, "all", TODAY).monthPeriod)).toBe(
      "Latest month with data: Dec 2026",
    );
  });

  it("400 random fixtures x every period filter", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const rows = randomRows(seed);
      const cloud = CLOUDS[seed % 3];
      for (const filter of filtersFor(rows))
        expectSameNumbers(chartBaseRowsOf(rows, cloud, "all"), filter);
    }
  }, 60_000);

  it("no rows at all: same values (all 0); only the empty-data delta lines differ", () => {
    expectEmptyAll([]);
    expectEmptyAll([row({ year: null, month: null })]);
    // The other filters keep today's behaviour exactly, even with no rows.
    for (const filter of ["year:2026", "month:2026-9"] as const) expectSameNumbers([], filter);
  });
});

describe("Dashboard KPI tiles: example data values (pinned)", () => {
  const k = resolveDashboardKpis(EXAMPLE_TX_ROWS, "all", TODAY);

  it("money tiles: FY to date Oct 2025–Sep 2026", () => {
    expect(formatKpiPeriod(k.fyPeriod)).toBe("FY to date (from Oct) · Oct 2025–Sep 2026");
    expect(k.totalRevenue).toBe(707100);
    expect(k.totalInputCost).toBe(467840);
    expect(k.totalProfit).toBe(239260);
    expect(k.marginPct.toFixed(1)).toBe("33.8");
  });

  it("month tiles: latest month with data Sep 2026", () => {
    expect(formatKpiPeriod(k.monthPeriod)).toBe("Latest month with data: Sep 2026");
    expect(k.monthRevenue).toBe(284700);
    expect(k.monthProfit).toBe(86590);
    expect(k.publicLines).toBe(3);
    expect(k.privateLines).toBe(1);
  });

  it("deltas: signed, named comparison", () => {
    const pct = (v: number | null) => (v === null ? null : v.toFixed(1));
    expect(pct(k.revenueDelta)).toBe("67.4");
    expect(pct(k.costDelta)).toBe("73.4");
    expect(pct(k.profitDelta)).toBe("56.7");
    expect(pct(k.marginDelta)).toBe("-2.3");
    expect(pct(k.monthRevenueDelta)).toBe("151.5");
    expect(pct(k.monthProfitDelta)).toBe("112.0");
    expect([k.publicLinesDelta, k.privateLinesDelta]).toEqual([2, 0]);
    expect(k.fyComparedWith && formatKpiPeriod(k.fyComparedWith)).toBe(
      "FY to date (from Oct) · Oct 2025–Aug 2026",
    );
    expect(
      formatKpiDelta({
        value: k.revenueDelta!,
        unit: "percent",
        comparedWith: k.fyComparedWith!,
        goodWhen: "up",
      }),
    ).toBe("+67.4% vs end of Aug 2026");
    expect(
      formatKpiDelta({
        value: -8,
        unit: "count",
        noun: { one: "line", other: "lines" },
        comparedWith: k.monthComparedWith!,
        goodWhen: "up",
      }),
    ).toBe("\u22128 lines vs Aug 2026");
  });

  it("the money tiles' value is the sum of the rows in their period (label and maths agree)", () => {
    const fyRows = rowsInKpiPeriod(EXAMPLE_TX_ROWS, k.fyPeriod);
    expect(fyRows.reduce((s, r) => addNullable(s, r.selling_cost), 0)).toBe(k.totalRevenue);
    expect(fyRows.reduce((s, r) => addNullable(s, lineCost(r)), 0)).toBe(k.totalInputCost);
    const monthRows = rowsInKpiPeriod(EXAMPLE_TX_ROWS, k.monthPeriod);
    expect(monthRows.reduce((s, r) => addNullable(s, r.selling_cost), 0)).toBe(k.monthRevenue);
  });

  it("incomplete note inputs: the example rows are complete; the live shape has 22 incomplete", () => {
    expect(k.incompleteFy).toEqual({ count: 0, revenue: 0, inputCost: 0 });
    const live = resolveDashboardKpis(liveShapeRows(), "all", TODAY);
    // Oct-Aug: two public rows a month. One has no selling price and no potential ID; the other
    // has input_cost null (its cost comes from input_cost_actual_alloc), and the SCRUM-131 rule
    // checks input_cost itself. Both stay in the totals.
    expect(live.incompleteFy.count).toBe(22);
    expect(live.incompleteMonth.count).toBe(0); // Sep 2026: private row only
  });

  it("a selected month: that month and the FY to date through it", () => {
    const m = resolveDashboardKpis(EXAMPLE_TX_ROWS, "month:2026-8", TODAY);
    expect(formatKpiPeriod(m.monthPeriod)).toBe("Calendar month: Aug 2026");
    expect(formatKpiPeriod(m.fyPeriod)).toBe("FY to date (from Oct) · Oct 2025–Aug 2026");
    expect(m.monthRevenue).toBe(113200);
  });
});

describe("Dashboard tile periods", () => {
  it("Public/Private counts use their own rule (dashboard.cloudCount), the same month as today", () => {
    const rows = liveShapeRows();
    for (const cloud of CLOUDS) {
      const k = resolveDashboardKpis(chartBaseRowsOf(rows, cloud, "all"), "all", TODAY);
      expect(k.cloudPeriod).toEqual(k.monthPeriod);
      expect(k.cloudComparedWith).toEqual(k.monthComparedWith);
    }
  });

  it("filter-driven cards say which period they cover; a year option is a CALENDAR year", () => {
    expect(formatKpiPeriod(dashboardFilterPeriod("all"))).toBe("All time");
    expect(formatKpiPeriod(dashboardFilterPeriod("month:2026-8"))).toBe("Calendar month: Aug 2026");
    // The option reads "All months · FY 2026" but includesDashboardPeriod keeps Jan-Dec 2026,
    // while the money tiles for "year:2026" use the FY window Oct 2025-Sep 2026 (unchanged in C5).
    expect(formatKpiPeriod(dashboardFilterPeriod("year:2026"))).toBe("Year 2026");
    expect(
      formatKpiPeriod(resolveDashboardKpis(liveShapeRows(), "year:2026", TODAY).fyPeriod),
    ).toBe("FY to date (from Oct) · Oct 2025–Sep 2026");
  });
});

describe("Dashboard cards: example data values (pinned)", () => {
  const filtered = applyTxFilters(EXAMPLE_TX_ROWS, "all", "all", "all");
  const NOW = new Date("2026-09-29T08:00:00Z");

  it("period and customer options", () => {
    expect(buildPeriodOptions(undefined)).toEqual([
      { value: "all", label: "All months · All years" },
    ]);
    expect(buildPeriodOptions(EXAMPLE_TX_ROWS).map((o) => o.label)).toEqual([
      "All months · All years",
      "All months · FY 2026",
      "Sep 2026",
      "Aug 2026",
      "Jul 2026",
      "Jun 2026",
      "May 2026",
    ]);
    expect(
      customerOptionsOf(cloudAndPeriodRowsOf(EXAMPLE_TX_ROWS, "private_cloud", "all")),
    ).toEqual(["Accenture", "HCL", "Hexaware", "Persistent", "TechM"]);
  });

  it("top customers and line of business", () => {
    const top = topCustomersOf(filtered);
    expect(topCustomersBy(top, "revenue").map((c) => [c.name, c.revenue])).toEqual([
      ["TCS", 96500],
      ["LTIMindtree", 87400],
      ["Accenture", 68600],
      ["Cognizant", 67600],
      ["HCL", 63100],
    ]);
    expect(topCustomersBy(top, "profit").map((c) => [c.name, c.profit])).toEqual([
      ["LTIMindtree", 30280],
      ["Accenture", 24480],
      ["TCS", 24370],
      ["HCL", 22890],
      ["Cognizant", 20750],
    ]);
    expect(topCustomersBy(top, "users").map((c) => [c.name, c.users, c.dominantLob])).toEqual([
      ["TCS", 55, "VILT"],
      ["LTIMindtree", 46, "VILT"],
      ["Cognizant", 42, "VILT"],
      ["Accenture", 37, "Integrated"],
      ["HCL", 33, "Integrated"],
    ]);
    expect(lobRowsOf(filtered)).toEqual([
      { name: "VILT", value: 4 },
      { name: "Standalone", value: 4 },
      { name: "Integrated", value: 4 },
    ]);
  });

  it("support tickets, Freshdesk sync and AI inbox", () => {
    const tickets = filterDashboardTickets(EXAMPLE_TICKETS, filtered, "all", "all", "all");
    expect(ticketCountsOf(tickets, NOW.getTime())).toEqual({
      open: 2,
      pending: 1,
      overdue: 1, // only #5128 (due 07:00 UTC) is past due and open at 08:00 UTC
      escalated: 2,
      resolved: 1,
      closed: 1,
      total: 6,
    });
    expect(ticketsByAgentOf(tickets)).toEqual([
      { name: "Ritu Sharma", count: 3 },
      { name: "Nisha Patel", count: 2 },
      { name: "Amit Singh", count: 1 },
    ]);
    // Public cloud only: tickets from companies with public rows in the filtered set.
    const pubRows = applyTxFilters(EXAMPLE_TX_ROWS, "public_cloud", "all", "all");
    expect(
      filterDashboardTickets(EXAMPLE_TICKETS, pubRows, "all", "public_cloud", "all").map(
        (t) => t.id,
      ),
    ).toEqual([5142, 5139, 5131, 5124]);
    const sync = summarizeFreshdeskRuns(EXAMPLE_SYNC_OVERVIEW.freshdesk.runs, NOW.getTime());
    expect(sync).toMatchObject({ state: "warn", runs24h: 2, failed24h: 1, failuresInRow: 1 });
    expect(sync.lastSuccess?.id).toBe("fd-2");
    const inbox = inboxSummaryOf(filterDashboardInbox(EXAMPLE_INBOX, "all", "all"), NOW);
    expect(inbox.pendingInbox.map((i) => i.id)).toEqual(["inb-55", "inb-58"]);
    expect(inbox.confirmedToday).toBe(1);
    expect(filterDashboardInbox(EXAMPLE_INBOX, "all", "TCS").map((i) => i.id)).toEqual(["inb-49"]);
  });

  it("users and roles, and the viewer line", () => {
    const entries = userEntriesOf(EXAMPLE_PROFILES, EXAMPLE_USER_ROLES);
    expect(entries.map((e) => [e.name, e.isLive, e.parked])).toEqual([
      ["Admin Demo", true, false],
      ["Meera Krishnan", true, false],
      ["Kavya Iyer", false, true],
      ["Nisha Patel", false, true],
      ["Ritu Sharma", false, true],
      ["Arjun Kapoor", false, true],
    ]);
    expect(
      dashboardViewer(["finance", "admin"], {
        email: "x@y.z",
        user_metadata: { full_name: "Asha Rao" },
      }),
    ).toEqual({
      viewerName: "Asha Rao",
      viewerRole: "Super Admin",
    });
    expect(
      dashboardViewer([], { email: "ops.demo@mml.local", user_metadata: { full_name: "  " } })
        .viewerName,
    ).toBe("ops.demo");
    expect(dashboardViewer([], null)).toEqual({ viewerName: "demo", viewerRole: "Viewer" });
  });
});
