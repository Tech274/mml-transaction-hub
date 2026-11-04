// SCRUM-128 C6: value pins for the Public cloud, Private cloud, AI Command Center and Agents
// summaries, written BEFORE their UI rewrite (plan R1: numbers must not change).
// - The data shaping was moved verbatim into *-data.ts (token-checked; the only change is an
//   optional `now`). The fixture below was frozen from that code before any UI edit.
// - publicCloudView / privateCloudView replace the components' useMemo chains; the oracles here
//   are the old chains copied verbatim, run on random rows that include incomplete ones.
import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/c6-example-values.json";
import {
  EXAMPLE_ROWS,
  buildPublicSummary,
  lineCost as publicLineCost,
  publicCloudView,
  type PublicCloudRow,
} from "../public-cloud-data";
import {
  EXAMPLE_BATCHES,
  EXAMPLE_TRANSACTIONS,
  buildPrivateSummary,
  lineCost as privateLineCost,
  privateCloudView,
  type TxRow as PrivateTxRow,
} from "../private-cloud-data";
import {
  EXAMPLE_AUDIT,
  EXAMPLE_INBOX as AICC_INBOX,
  EXAMPLE_RUNS as AICC_RUNS,
  buildAiccSummary,
} from "../ai-command-center-data";
import {
  EXAMPLE_AGENTS,
  EXAMPLE_INBOX as AGENTS_INBOX,
  EXAMPLE_RUNS as AGENTS_RUNS,
  buildAgentsSummary,
} from "../agents-data";
import {
  completenessTabCounts,
  filterByCompletenessTab,
  COMPLETENESS_TABS,
  type CompletenessTab,
} from "@/lib/completeness-tabs";
import { dataMonthsOf, kpiPeriodFor, rowsInKpiPeriod } from "@/lib/kpi-period";
import { splitByCompleteness } from "@/lib/transaction-completeness";

const NOW = new Date("2026-10-06T06:00:00Z");
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function maybe<T>(r: () => number, value: T, pNull = 0.15): T | null {
  return r() < pNull ? null : value;
}

function randomPublicRows(seed: number): PublicCloudRow[] {
  const r = rng(seed);
  const n = Math.floor(r() * 25);
  return Array.from({ length: n }, (_, i) => {
    const year = 2025 + Math.floor(r() * 2);
    const month = 1 + Math.floor(r() * 12);
    const start = `${year}-${String(month).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`;
    return {
      id: `p-${seed}-${i}`,
      potential_id: maybe(r, `POT-${i}`),
      customer_name: maybe(r, ["TCS", "Infosys", "Wipro", "HCL", "Acme"][Math.floor(r() * 5)]),
      lab_name: maybe(r, `Lab ${i}`),
      cloud_provider: maybe(r, ["AWS", "Azure", "GCP"][Math.floor(r() * 3)]),
      line_of_business: maybe(r, ["VILT", "Standalone", "Integrated"][Math.floor(r() * 3)]),
      selling_cost: maybe(r, Math.round(r() * 100000)),
      input_cost: maybe(r, Math.round(r() * 80000)),
      input_cost_auto: maybe(r, Math.round(r() * 80000), 0.5),
      input_cost_actual_alloc: maybe(r, Math.round(r() * 80000), 0.7),
      total_users: maybe(r, Math.floor(r() * 60)),
      start_date: maybe(r, start),
      end_date: maybe(r, `${year}-12-31`),
      public_credit_allocated: maybe(r, Math.round(r() * 90000)),
      public_actual_consumption: maybe(r, Math.round(r() * 90000)),
      public_unused_credit: maybe(r, Math.round(r() * 9000)),
      month: maybe(r, month, 0.1),
      year: maybe(r, year, 0.1),
      is_deleted: false,
    } as PublicCloudRow;
  });
}

function randomPrivate(seed: number): { tx: PrivateTxRow[]; batches: typeof EXAMPLE_BATCHES } {
  const r = rng(seed);
  const batches = EXAMPLE_BATCHES.filter(() => r() < 0.7).map((b) => ({
    ...b,
    actual_cost_total: maybe(r, Math.round(r() * 200000)),
    needs_recompute: r() < 0.3,
  })) as typeof EXAMPLE_BATCHES;
  const n = Math.floor(r() * 25);
  const tx = Array.from({ length: n }, (_, i) => {
    const year = 2025 + Math.floor(r() * 2);
    return {
      ...EXAMPLE_TRANSACTIONS[i % EXAMPLE_TRANSACTIONS.length],
      id: `q-${seed}-${i}`,
      lab_batch_id: maybe(r, batches[0]?.id ?? "pb-1", 0.4),
      potential_id: maybe(r, `POT-${i}`),
      lab_name: maybe(r, `Lab ${i}`),
      cloud_provider: maybe(
        r,
        ["MakeMyLabs Private Cloud", "Oracle", "SAP", "Other"][Math.floor(r() * 4)],
      ),
      customer_name: maybe(r, ["TCS", "Infosys", "Wipro", "HCL"][Math.floor(r() * 4)]),
      total_users: maybe(r, Math.floor(r() * 60)),
      selling_cost: maybe(r, Math.round(r() * 100000)),
      input_cost: maybe(r, Math.round(r() * 80000)),
      input_cost_auto: maybe(r, Math.round(r() * 80000), 0.5),
      input_cost_actual_alloc: maybe(r, Math.round(r() * 80000), 0.7),
      month: maybe(r, 1 + Math.floor(r() * 12), 0.1),
      year: maybe(r, year, 0.1),
    } as PrivateTxRow;
  });
  return { tx, batches };
}

// The components' useMemo chains before C6, copied verbatim (minus useMemo).
function oldPublicChain(allRows: PublicCloudRow[], tab: CompletenessTab, now: Date) {
  const months = dataMonthsOf(allRows ?? []);
  const totalsPeriod = kpiPeriodFor("cloud.totals", months);
  const livePeriod = kpiPeriodFor("cloud.live", months);
  const completenessPeriod = kpiPeriodFor("cloud.completeness", months);
  const view = buildPublicSummary(
    filterByCompletenessTab(rowsInKpiPeriod(allRows, totalsPeriod), tab),
    now,
  );
  const completenessRows = rowsInKpiPeriod(allRows, completenessPeriod);
  const cardSplit = splitByCompleteness(completenessRows, publicLineCost);
  const tabCounts = completenessTabCounts(completenessRows ?? []);
  return { totalsPeriod, livePeriod, completenessPeriod, view, cardSplit, tabCounts };
}

function oldPrivateChain(
  allTx: PrivateTxRow[],
  batchesRaw: typeof EXAMPLE_BATCHES,
  tab: CompletenessTab,
  now: Date,
) {
  const months = dataMonthsOf(allTx ?? []);
  const totalsPeriod = kpiPeriodFor("cloud.totals", months);
  const completenessPeriod = kpiPeriodFor("cloud.completeness", months);
  const batchesPeriod = kpiPeriodFor("cloud.batches");
  const batchStatePeriod = kpiPeriodFor("cloud.batchState");
  const view = buildPrivateSummary(
    batchesRaw,
    filterByCompletenessTab(rowsInKpiPeriod(allTx, totalsPeriod), tab),
    allTx,
    now,
  );
  const completenessRows = rowsInKpiPeriod(allTx, completenessPeriod);
  const cardSplit = splitByCompleteness(completenessRows, privateLineCost);
  const tabCounts = completenessTabCounts(completenessRows ?? []);
  return {
    totalsPeriod,
    completenessPeriod,
    batchesPeriod,
    batchStatePeriod,
    view,
    cardSplit,
    tabCounts,
  };
}

describe("SCRUM-128 C6 frozen example values", () => {
  it("Public and Private views equal the pre-C6 fixture on every tab", () => {
    for (const tab of COMPLETENESS_TABS) {
      expect(json(publicCloudView(EXAMPLE_ROWS, tab, NOW))).toEqual(
        (fixture as Record<string, unknown>)[`public.${tab}`],
      );
      expect(json(privateCloudView(EXAMPLE_TRANSACTIONS, EXAMPLE_BATCHES, tab, NOW))).toEqual(
        (fixture as Record<string, unknown>)[`private.${tab}`],
      );
    }
  });

  it("AI Command Center and Agents equal the pre-C6 fixture", () => {
    expect(json(buildAiccSummary(AICC_INBOX, AICC_RUNS, EXAMPLE_AUDIT, NOW))).toEqual(fixture.aicc);
    expect(json(buildAgentsSummary(EXAMPLE_AGENTS, AGENTS_RUNS, AGENTS_INBOX))).toEqual(
      fixture.agents,
    );
  });

  it("Public cloud literal pins", () => {
    const { view, cardSplit, tabCounts } = publicCloudView(EXAMPLE_ROWS, "all", NOW);
    expect(view.revenue).toBe(301400);
    expect(view.inputCost).toBe(208120);
    expect(view.profit).toBe(93280);
    expect(view.marginPct.toFixed(1)).toBe("30.9");
    expect(view.creditUsed).toBe(208120);
    expect(view.runningNow).toBe(0);
    expect(view.endingSoon).toBe(0);
    expect(view.chartYear).toBe(2026);
    expect(view.providerRevenue).toEqual([
      { name: "Azure", value: 199300 },
      { name: "AWS", value: 57500 },
      { name: "GCP", value: 44600 },
    ]);
    expect(view.topCustomers[0]).toEqual({ name: "TCS", value: 96500 });
    expect(cardSplit.complete.count).toBe(5);
    expect(cardSplit.complete.users).toBe(171);
    expect(tabCounts).toEqual({ all: 5, complete: 5, incomplete: 0 });
  });

  it("Private cloud literal pins", () => {
    const { view, tabCounts } = privateCloudView(EXAMPLE_TRANSACTIONS, EXAMPLE_BATCHES, "all", NOW);
    expect(view.txRevenue).toBe(693000);
    expect(view.txCost).toBe(402500);
    expect(view.txUsers).toBe(140);
    expect(view.inBatches).toBe(7);
    expect(view.revenue).toBe(693000);
    expect(view.actualCost).toBe(402500);
    expect(view.estimatedCost).toBe(419900);
    expect(view.profit).toBe(290500);
    expect(view.marginPct.toFixed(1)).toBe("41.9");
    expect(view.locked).toBe(1);
    expect(view.recomputePending).toBe(1);
    expect(view.year).toBe(2026);
    expect(view.providerSplit).toEqual([
      { name: "MakeMyLabs Private Cloud", rows: 4, revenue: 383000 },
      { name: "Oracle", rows: 2, revenue: 212000 },
      { name: "SAP", rows: 1, revenue: 98000 },
    ]);
    expect(view.statusSplit).toEqual([
      { name: "Open", value: 2 },
      { name: "Closed", value: 1 },
    ]);
    expect(tabCounts).toEqual({ all: 7, complete: 7, incomplete: 0 });
  });

  it("AI Command Center literal pins", () => {
    const s = buildAiccSummary(AICC_INBOX, AICC_RUNS, EXAMPLE_AUDIT, NOW);
    expect(s.pending).toHaveLength(2);
    expect(s.confirmed).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.runsToday).toBe(0);
    expect(s.automationHealthy).toBe(false);
    expect(s.liveWork).toHaveLength(1);
    expect(s.alerts).toHaveLength(1);
    expect(s.auditRuns).toBe(1);
    expect(s.auditDecisions).toBe(2);
    expect(s.reviewOutcomes).toEqual([
      { name: "Confirmed", value: 1 },
      { name: "Rejected", value: 1 },
      { name: "Pending", value: 2 },
    ]);
    // "AI work volume" counts runs created today (UTC date of `now`).
    expect(
      buildAiccSummary(AICC_INBOX, AICC_RUNS, EXAMPLE_AUDIT, new Date("2026-09-29T12:00:00Z"))
        .runsToday,
    ).toBe(AICC_RUNS.filter((r) => r.created_at.startsWith("2026-09-29")).length);
  });

  it("Agents literal pins", () => {
    const s = buildAgentsSummary(EXAMPLE_AGENTS, AGENTS_RUNS, AGENTS_INBOX);
    expect(s.totalAgents).toBe(3);
    expect(s.totalRuns).toBe(4);
    expect(s.totalProposals).toBe(6);
    expect(s.pending).toBe(3);
    expect(s.confirmationRate.toFixed(1)).toBe("66.7");
    expect(s.avgDecisionHours.toFixed(2)).toBe("0.11");
    expect(s.byAgent.map((a) => [a.key, a.runs, a.proposals])).toEqual([
      ["generalist", 1, 2],
      ["support", 2, 2],
      ["cost_adr", 1, 2],
    ]);
  });
});

describe("SCRUM-128 C6 page pipelines (plan §8: tab counts = splitByCompleteness counts)", () => {
  it("publicCloudView equals the old useMemo chain on 300 random fixtures", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rows = randomPublicRows(seed);
      for (const tab of COMPLETENESS_TABS) {
        const got = publicCloudView(rows, tab, NOW);
        expect(json(got)).toEqual(json(oldPublicChain(rows, tab, NOW)));
        expect(got.tabCounts.complete).toBe(got.cardSplit.complete.count);
        expect(got.tabCounts.incomplete).toBe(got.cardSplit.incomplete.count);
        // The view built for a tab holds exactly that tab's rows (all-time totals period).
        const split = got.view.completeness;
        if (tab === "complete") expect(split.complete.count).toBe(got.tabCounts.complete);
        if (tab === "incomplete") expect(split.incomplete.count).toBe(got.tabCounts.incomplete);
        if (tab === "all")
          expect(split.complete.count + split.incomplete.count).toBe(got.tabCounts.all);
      }
    }
  });

  it("privateCloudView equals the old useMemo chain on 300 random fixtures", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const { tx, batches } = randomPrivate(seed);
      for (const tab of COMPLETENESS_TABS) {
        const got = privateCloudView(tx, batches, tab, NOW);
        expect(json(got)).toEqual(json(oldPrivateChain(tx, batches, tab, NOW)));
        expect(got.tabCounts.complete).toBe(got.cardSplit.complete.count);
        expect(got.tabCounts.incomplete).toBe(got.cardSplit.incomplete.count);
        const split = got.view.completeness;
        if (tab === "complete") expect(split.complete.count).toBe(got.tabCounts.complete);
        if (tab === "incomplete") expect(split.incomplete.count).toBe(got.tabCounts.incomplete);
      }
    }
  });

  it("random fixtures include incomplete rows (the pipeline test is not vacuous)", () => {
    let incomplete = 0;
    for (let seed = 1; seed <= 300; seed += 1)
      incomplete += completenessTabCounts(randomPublicRows(seed)).incomplete;
    expect(incomplete).toBeGreaterThan(100);
  });
});
