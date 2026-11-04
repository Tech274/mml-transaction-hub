// SCRUM-128 plan §4.2 (N14–N18) + Eng QC: every SummaryKpi tile states the time span its
// value covers. This file is the ONE rules table. Until Chief answers Q6 the rules encode
// TODAY's real behaviour (what each query actually computes), now labelled.
//
// Chief's Q6 answer is a one-file change: edit KPI_PERIOD_RULES below (and the expected
// labels in kpi-period.test.ts). Pages resolve a tile family's period once with
// kpiPeriodFor(), filter their rows with rowsInKpiPeriod() and pass the same object to
// <SummaryKpi period>, so the label and the maths cannot drift apart.
//
// Pure TS (only lib/format). Also holds the delta standard (KpiDelta, formatKpiDelta) used by
// SummaryKpi.
import { fmtCurrencyCompact } from "@/lib/format";

export type YearMonth = { year: number; month: number }; // month 1-12

export type KpiPeriod =
  | { kind: "fy-to-date"; fyStartMonth: number; from: YearMonth; through: YearMonth }
  | { kind: "month"; month: YearMonth; basis: "calendar" | "latest-with-data" }
  | { kind: "year"; year: number; basis: "calendar" | "financial"; fyStartMonth?: number }
  | { kind: "range"; from: YearMonth; through: YearMonth }
  | { kind: "all-time" }
  | { kind: "rolling"; hours: number }
  /** Current state (open queue, running now). */
  | { kind: "now" }
  /** Calendar day "today", in the time zone the query uses. */
  | { kind: "today"; timeZone: "UTC" | "Asia/Kolkata" }
  /** The query reads only the newest N records (a `.limit(N)`), not a date window. */
  | { kind: "latest-records"; limit: number; noun: string }
  /** Counts of one uploaded file (Bulk import preview), not a time window (SCRUM-128 C8). */
  | { kind: "file" };

/**
 * A rule: either a fixed period, or one resolved from the data months and today's date.
 * - `includeFutureMonths` (default false): whether a month after today's month can be "the latest
 *   month with data". The Dashboard today does not cap at today, so its rules set it to true.
 * - `fy-to-date` `through` (default "today"): the FY window ends at today's month, or at the latest
 *   month with data (the Dashboard today: the FY that holds the latest data month, through it).
 */
export type KpiPeriodRule =
  | { resolve: "fixed"; period: KpiPeriod }
  | { resolve: "latest-month-with-data"; includeFutureMonths?: boolean }
  | { resolve: "calendar-month" }
  | {
      resolve: "fy-to-date";
      fyStartMonth: number;
      through?: "today" | "latest-month-with-data";
      includeFutureMonths?: boolean;
    };

/**
 * Financial year start month (1-12). Today's value: October (was FINANCIAL_YEAR_START_MONTH in
 * summaries/dashboard-summary-utils.ts, which now re-exports this). Part of Chief's Q6.
 */
export const KPI_FY_START_MONTH = 10;

/**
 * Tile families. Every <SummaryKpi> in the app takes its period from one of these.
 * The comment on each says what the code computes today (file:what).
 */
export const KPI_PERIOD_RULES = {
  /** public/private-cloud-summary: Revenue, Profit, Input cost, Lines/Transactions, Users,
   *  Credit used, LOB entries, Top customer: every non-deleted row of that cloud type, no date filter. */
  "cloud.totals": { resolve: "fixed", period: { kind: "all-time" } },
  /** public-cloud-summary: Running now, Status (start <= now <= end). */
  "cloud.live": { resolve: "fixed", period: { kind: "now" } },
  /** completeness-card: Complete / Incomplete over every row of the view. */
  "cloud.completeness": { resolve: "fixed", period: { kind: "all-time" } },
  /** private-cloud-summary Lab batches card: every private lab batch, no date filter. */
  "cloud.batches": { resolve: "fixed", period: { kind: "all-time" } },
  /** private-cloud-summary: Recompute pending (current flag state). */
  "cloud.batchState": { resolve: "fixed", period: { kind: "now" } },
  /** agents-summary: Agents (the configured agent list). */
  "agents.registry": { resolve: "fixed", period: { kind: "now" } },
  /** agents-summary: Runs (ai_cc_runs .limit(300), newest first). */
  "agents.runs": { resolve: "fixed", period: { kind: "latest-records", limit: 300, noun: "runs" } },
  /** agents-summary: Proposals, Awaiting review, Confirmation rate, Time to decision (ai_cc_inbox .limit(500)). */
  "agents.inbox": {
    resolve: "fixed",
    period: { kind: "latest-records", limit: 500, noun: "items" },
  },
  /** ai-command-center-summary: Review queue, Review outcomes (ai_cc_inbox .limit(300)). */
  "aicc.inbox": { resolve: "fixed", period: { kind: "latest-records", limit: 300, noun: "items" } },
  /** ai-command-center-summary: Alerts, Automation status, Live AI work (ai_cc_runs .limit(300)). */
  "aicc.runs": { resolve: "fixed", period: { kind: "latest-records", limit: 300, noun: "runs" } },
  /** ai-command-center-summary: AI work volume (created_at's UTC date == today's UTC date). */
  "aicc.runsToday": { resolve: "fixed", period: { kind: "today", timeZone: "UTC" } },
  /**
   * dashboard-super-admin-summary: Revenue, Input cost, Profit, Margin (were "Total …"; "Total"
   * now only labels all-time values, N16). Today: buildFytdComparison over the FY window (Oct-Sep) that holds
   * the latest month with data (resolveFinancialYearEnd + financialYearWindow), summed from the FY
   * start through that month. Not capped at today (live check §5 item 2, N16).
   */
  "dashboard.fyMoney": {
    resolve: "fy-to-date",
    fyStartMonth: KPI_FY_START_MONTH,
    through: "latest-month-with-data",
    includeFutureMonths: true,
  },
  /**
   * dashboard-super-admin-summary: Month revenue and Month profit (were "Current month …").
   * Today: the latest month in the FY window with lineCount > 0 for the chosen cloud (so Public
   * can show Aug 2026 while All shows Sep 2026), not the calendar month and not capped at today
   * (live check §5 item 3, N17).
   */
  "dashboard.month": { resolve: "latest-month-with-data", includeFutureMonths: true },
  /**
   * dashboard-super-admin-summary: Public cloud / Private cloud line counts. Today: the same
   * month as "dashboard.month" (the lines of that one month), not a total (live check §5 item 1,
   * N14). Its own entry so Q6 can make these totals without touching the month tiles.
   */
  "dashboard.cloudCount": { resolve: "latest-month-with-data", includeFutureMonths: true },
  /**
   * SCRUM-128 C7. reports-view: Revenue, Input cost, Profit, Margin. Today: computeTotals over the
   * rows matching the Year / Provider / LOB filters. With "All years" that is every row (this
   * rule); with a year chosen the tiles say that calendar year (reportsFilterPeriod in
   * lib/reports-view-data.ts). The Year filter defaults to the current calendar year.
   */
  "reports.totals": { resolve: "fixed", period: { kind: "all-time" } },
  /**
   * SCRUM-128 C7. tickets: Open, Pending, Overdue, Escalated, Resolved, Closed, Due in next 7 days:
   * current status of every synced ticket in scope (newest 20,000).
   */
  "tickets.state": { resolve: "fixed", period: { kind: "now" } },
  /**
   * SCRUM-128 C7. tickets: Resolved / Closed (last 7 days), Avg resolution time, Resolved within
   * due by: tickets whose ticket_updated_at is within the last 7 × 24 h.
   */
  "tickets.last7": { resolve: "fixed", period: { kind: "rolling", hours: 168 } },
  /** SCRUM-128 C7. tickets: Due today (due_by's UTC date == today's UTC date). */
  "tickets.dueToday": { resolve: "fixed", period: { kind: "today", timeZone: "UTC" } },
  /**
   * SCRUM-128 C8. strict-import preview: Rows to import, Private cloud, Public cloud, Customers,
   * Errors, Warnings, Total selling, Total input: the server's summary of the chosen file.
   */
  "import.preview": { resolve: "fixed", period: { kind: "file" } },
  /**
   * SCRUM-128 C15. import-approvals/$stageId: Rows, Selling cost, Incomplete rows, Healer fixes:
   * the staged file's own counts.
   */
  "import.stage": { resolve: "fixed", period: { kind: "file" } },
  /**
   * SCRUM-128 C10. sync-status: Customers, Transactions, Snapshot rows, Last successful sync, Next
   * scheduled run; Freshdesk Last successful run and Failures in a row: live counts and states.
   */
  "sync.state": { resolve: "fixed", period: { kind: "now" } },
  /**
   * SCRUM-128 C10. sync-status Freshdesk card: Runs / Failed (were "(last 24h)" in the label):
   * runs whose started_at is within 24 h of now (lib/sync-health.ts).
   */
  "sync.last24h": { resolve: "fixed", period: { kind: "rolling", hours: 24 } },
} as const satisfies Record<string, KpiPeriodRule>;

export type KpiPeriodRuleId = keyof typeof KPI_PERIOD_RULES;

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function ym(p: YearMonth): string {
  return `${MONTH_SHORT[p.month - 1] ?? "?"} ${p.year}`;
}

function ymKey(p: YearMonth): number {
  return p.year * 12 + (p.month - 1);
}

export function formatKpiPeriod(p: KpiPeriod): string {
  switch (p.kind) {
    case "fy-to-date":
      return `FY to date (from ${MONTH_SHORT[p.fyStartMonth - 1]}) · ${ym(p.from)}–${ym(p.through)}`;
    case "month":
      return p.basis === "latest-with-data"
        ? `Latest month with data: ${ym(p.month)}`
        : `Calendar month: ${ym(p.month)}`;
    case "year":
      if (p.basis === "calendar") return `Year ${p.year}`;
      {
        const start = p.fyStartMonth ?? 4;
        const end = ((start + 10) % 12) + 1;
        return `FY ${p.year}–${String((p.year + 1) % 100).padStart(2, "0")} (${MONTH_SHORT[start - 1]}–${MONTH_SHORT[end - 1]})`;
      }
    case "range":
      return `${ym(p.from)}–${ym(p.through)}`;
    case "all-time":
      return "All time";
    case "rolling":
      // Whole weeks or days read better than "Last 168 h"; a single day stays "Last 24 h".
      return p.hours >= 48 && p.hours % 24 === 0
        ? `Last ${p.hours / 24} days`
        : `Last ${p.hours} h`;
    case "now":
      return "Now";
    case "today":
      return p.timeZone === "UTC" ? "Today (UTC)" : "Today (IST)";
    case "latest-records":
      return `Latest ${p.limit} ${p.noun}`;
    case "file":
      return "This file";
  }
}

/** Resolve a rule against the months that have data and today's date. */
export function resolveKpiPeriod(
  rule: KpiPeriodRule,
  dataMonths: readonly YearMonth[],
  today: Date,
): KpiPeriod {
  const thisMonth: YearMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };
  const latestWithData = (includeFuture: boolean | undefined): YearMonth | undefined =>
    [...dataMonths]
      .filter((m) => m.month >= 1 && m.month <= 12)
      .filter((m) => includeFuture === true || ymKey(m) <= ymKey(thisMonth))
      .sort((a, b) => ymKey(b) - ymKey(a))[0];
  switch (rule.resolve) {
    case "fixed":
      return rule.period;
    case "calendar-month":
      return { kind: "month", month: thisMonth, basis: "calendar" };
    case "latest-month-with-data":
      return {
        kind: "month",
        month: latestWithData(rule.includeFutureMonths) ?? thisMonth,
        basis: "latest-with-data",
      };
    case "fy-to-date": {
      const s = rule.fyStartMonth;
      const through =
        rule.through === "latest-month-with-data"
          ? (latestWithData(rule.includeFutureMonths) ?? thisMonth)
          : thisMonth;
      const startYear = through.month >= s ? through.year : through.year - 1;
      return {
        kind: "fy-to-date",
        fyStartMonth: s,
        from: { year: startYear, month: s },
        through,
      };
    }
  }
}

export function kpiPeriodFor(
  id: KpiPeriodRuleId,
  dataMonths: readonly YearMonth[] = [],
  today: Date = new Date(),
): KpiPeriod {
  return resolveKpiPeriod(KPI_PERIOD_RULES[id], dataMonths, today);
}

/**
 * Rows a month-based period covers (rows carry month/year). Periods that are not a month
 * window (all-time, now, today, rolling, latest-records) keep every row: their windows are
 * applied by the query itself.
 */
export function rowsInKpiPeriod<T extends { month?: number | null; year?: number | null }>(
  rows: readonly T[],
  period: KpiPeriod,
): T[] {
  let from: number;
  let through: number;
  switch (period.kind) {
    case "fy-to-date":
    case "range":
      from = ymKey(period.from);
      through = ymKey(period.through);
      break;
    case "month":
      from = through = ymKey(period.month);
      break;
    case "year": {
      const s = period.basis === "financial" ? (period.fyStartMonth ?? 4) : 1;
      from = ymKey({ year: period.year, month: s });
      through = from + 11;
      break;
    }
    default:
      return rows.slice();
  }
  return rows.filter((r) => {
    if (typeof r.year !== "number" || typeof r.month !== "number") return false;
    const k = ymKey({ year: r.year, month: r.month });
    return k >= from && k <= through;
  });
}

/** Distinct year/months present in rows (input for resolveKpiPeriod). */
export function dataMonthsOf(
  rows: readonly { month?: number | null; year?: number | null }[],
): YearMonth[] {
  const seen = new Map<number, YearMonth>();
  for (const r of rows) {
    if (
      typeof r.year === "number" &&
      typeof r.month === "number" &&
      r.month >= 1 &&
      r.month <= 12
    ) {
      seen.set(ymKey({ year: r.year, month: r.month }), { year: r.year, month: r.month });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------------------------
// Deltas (plan §4.2 "Delta standard", N15). A delta is always signed (never Math.abs), names the
// period it compares with ("vs Aug 2026", never "vs last month"), and carries its meaning in the
// sign and an arrow; colour is a secondary cue from direction x goodWhen.

export type KpiDeltaUnit = "percent" | "points" | "count" | "currency";

export type KpiDelta = {
  /** Signed change: current minus comparison (or % / pts change). Never Math.abs. */
  value: number;
  unit: KpiDeltaUnit;
  /** For count deltas: "line" / "lines". Never "new lines". */
  noun?: { one: string; other: string };
  /** The period the value is compared with; named in the text ("vs Aug 2026"). */
  comparedWith: KpiPeriod;
  /** Which direction is good. A rise in cost is "down" good; a neutral count is "neither". */
  goodWhen: "up" | "down" | "neither";
};

export type KpiDeltaDirection = "up" | "down" | "none";
export type KpiDeltaTone = "positive" | "negative" | "neutral";

const MINUS = "\u2212"; // U+2212 MINUS SIGN, never the ASCII hyphen

function deltaDigits(unit: KpiDeltaUnit): number {
  return unit === "percent" || unit === "points" ? 1 : 0;
}

/**
 * The value as it will be shown, so "No change" and the arrow agree with the visible number.
 * SCRUM-128 C20 (Eng QC S1): rounds exactly like the pre-SCRUM-128 Dashboard text, which printed
 * `delta.toFixed(1)`: half away from zero on the value's exact binary form (−19.85 → −19.9,
 * −0.05 → −0.1, 0.15 → 0.1 because 0.15 is stored just below .15). `Math.round(x * 10) / 10`
 * rounded half toward +∞ and differed by 0.1 on negative ties.
 */
function roundedDelta(d: KpiDelta): number {
  const r = Number(d.value.toFixed(deltaDigits(d.unit)));
  return Object.is(r, -0) ? 0 : r;
}

export function kpiDeltaDirection(d: KpiDelta): KpiDeltaDirection {
  if (!Number.isFinite(d.value)) return "none";
  const r = roundedDelta(d);
  return r > 0 ? "up" : r < 0 ? "down" : "none";
}

/** Colour cue: direction x goodWhen. Neutral for no change or goodWhen "neither". */
export function kpiDeltaTone(d: KpiDelta): KpiDeltaTone {
  const dir = kpiDeltaDirection(d);
  if (dir === "none" || d.goodWhen === "neither") return "neutral";
  return dir === d.goodWhen ? "positive" : "negative";
}

/** How a comparison period is named after "vs": "Aug 2026", "end of Aug 2026", "FY 2024–25 (Oct–Sep)". */
export function formatKpiComparison(p: KpiPeriod): string {
  switch (p.kind) {
    case "month":
      return ym(p.month);
    case "fy-to-date":
      return `end of ${ym(p.through)}`;
    case "year":
    case "range":
      return formatKpiPeriod(p);
    default:
      return formatKpiPeriod(p).toLowerCase();
  }
}

function deltaMagnitude(d: KpiDelta, signed: boolean): string {
  const digits = deltaDigits(d.unit);
  const nf = new Intl.NumberFormat("en-IN", {
    signDisplay: signed ? "exceptZero" : "never",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const r = roundedDelta(d);
  switch (d.unit) {
    case "percent":
      return `${nf.format(r)}%`;
    case "points":
      return `${nf.format(r)} pts`;
    case "count": {
      const noun = d.noun ? ` ${Math.abs(r) === 1 ? d.noun.one : d.noun.other}` : "";
      return `${nf.format(r)}${noun}`;
    }
    case "currency": {
      const sign = signed ? (r > 0 ? "+" : r < 0 ? "-" : "") : "";
      return `${sign}${fmtCurrencyCompact(Math.abs(r))}`;
    }
  }
}

/**
 * Visible delta text: "+2.6% vs Aug 2026", "−17 lines vs Aug 2026", "+0.4 pts vs end of Aug 2026".
 * "No change" when the shown value rounds to 0. "—" for a non-finite value.
 */
export function formatKpiDelta(d: KpiDelta): string {
  if (!Number.isFinite(d.value)) return "—";
  if (kpiDeltaDirection(d) === "none") return "No change";
  return `${deltaMagnitude(d, true).replace(/-/g, MINUS)} vs ${formatKpiComparison(d.comparedWith)}`;
}

/** Screen-reader sentence: "Down 17 lines compared with Aug 2026". */
export function kpiDeltaA11yLabel(d: KpiDelta): string {
  const vs = formatKpiComparison(d.comparedWith);
  if (!Number.isFinite(d.value)) return `No comparison with ${vs}`;
  const dir = kpiDeltaDirection(d);
  if (dir === "none") return `No change compared with ${vs}`;
  return `${dir === "up" ? "Up" : "Down"} ${deltaMagnitude(d, false)} compared with ${vs}`;
}

/**
 * The period today's Dashboard deltas compare with: the month before for a month ("vs Aug 2026"),
 * and the same FY to the end of the month before for FY to date ("vs end of Aug 2026"). Null when
 * there is nothing to compare with (the first month of the FY, or a period that is not month-based).
 */
export function previousKpiPeriod(p: KpiPeriod): KpiPeriod | null {
  const prev = (m: YearMonth): YearMonth =>
    m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 };
  switch (p.kind) {
    case "month":
      return { kind: "month", month: prev(p.month), basis: "calendar" };
    case "fy-to-date":
      if (ymKey(p.through) <= ymKey(p.from)) return null;
      return { ...p, through: prev(p.through) };
    default:
      return null;
  }
}
