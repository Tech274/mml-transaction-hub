export type DashboardPeriodFilter = "all" | `year:${number}` | `month:${number}-${number}`;
export const FINANCIAL_YEAR_START_MONTH = 10;

export interface YearMonthPoint {
  year: number;
  month: number;
}

interface ParsedYearPeriod {
  kind: "year";
  year: number;
}

interface ParsedMonthPeriod {
  kind: "month";
  year: number;
  month: number;
}

type ParsedPeriod = { kind: "all" } | ParsedYearPeriod | ParsedMonthPeriod;

export function parseDashboardPeriod(period: DashboardPeriodFilter): ParsedPeriod {
  if (period === "all") return { kind: "all" };
  if (period.startsWith("year:")) {
    const year = Number(period.slice(5));
    if (Number.isFinite(year)) return { kind: "year", year };
    return { kind: "all" };
  }
  if (period.startsWith("month:")) {
    const token = period.slice(6);
    const [yearRaw, monthRaw] = token.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      return { kind: "month", year, month };
    }
  }
  return { kind: "all" };
}

export function includesDashboardPeriod(
  year: number | null | undefined,
  month: number | null | undefined,
  period: DashboardPeriodFilter,
): boolean {
  if (!year || !month) return false;
  const parsed = parseDashboardPeriod(period);
  if (parsed.kind === "all") return true;
  if (parsed.kind === "year") return year === parsed.year;
  return year === parsed.year && month === parsed.month;
}

export function previousMonth(point: YearMonthPoint): YearMonthPoint {
  if (point.month === 1) {
    return { year: point.year - 1, month: 12 };
  }
  return { year: point.year, month: point.month - 1 };
}

function monthIndex(point: YearMonthPoint): number {
  return point.year * 12 + (point.month - 1);
}

function fromMonthIndex(index: number): YearMonthPoint {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month };
}

export function buildTimelineFromPoints(
  points: YearMonthPoint[],
  period: DashboardPeriodFilter,
): YearMonthPoint[] {
  const parsed = parseDashboardPeriod(period);
  if (parsed.kind === "month") {
    return [{ year: parsed.year, month: parsed.month }];
  }
  if (parsed.kind === "year") {
    return Array.from({ length: 12 }, (_, idx) => ({ year: parsed.year, month: idx + 1 }));
  }
  if (points.length === 0) return [];

  const validPoints = points.filter((point) => point.month >= 1 && point.month <= 12);
  if (validPoints.length === 0) return [];
  const sorted = [...validPoints].sort((a, b) => monthIndex(a) - monthIndex(b));
  const start = monthIndex(sorted[0]);
  const end = monthIndex(sorted[sorted.length - 1]);
  const timeline: YearMonthPoint[] = [];
  for (let idx = start; idx <= end; idx += 1) {
    timeline.push(fromMonthIndex(idx));
  }
  return timeline;
}

export function financialYearEndForPoint(
  point: YearMonthPoint,
  fyStartMonth: number = FINANCIAL_YEAR_START_MONTH,
): number {
  return point.month >= fyStartMonth ? point.year + 1 : point.year;
}

export function financialYearWindow(
  fyEndYear: number,
  fyStartMonth: number = FINANCIAL_YEAR_START_MONTH,
): YearMonthPoint[] {
  const startYear = fyEndYear - 1;
  const points: YearMonthPoint[] = [];
  for (let idx = 0; idx < 12; idx += 1) {
    const month = ((fyStartMonth - 1 + idx) % 12) + 1;
    const year = month >= fyStartMonth ? startYear : fyEndYear;
    points.push({ year, month });
  }
  return points;
}

export function resolveFinancialYearEnd(
  period: DashboardPeriodFilter,
  latestPoint: YearMonthPoint | null,
  fallback: YearMonthPoint,
  fyStartMonth: number = FINANCIAL_YEAR_START_MONTH,
): number {
  const parsed = parseDashboardPeriod(period);
  if (parsed.kind === "year") return parsed.year;
  if (parsed.kind === "month") {
    return financialYearEndForPoint({ year: parsed.year, month: parsed.month }, fyStartMonth);
  }
  if (latestPoint) return financialYearEndForPoint(latestPoint, fyStartMonth);
  return financialYearEndForPoint(fallback, fyStartMonth);
}

export type TrendMetricPoint = {
  revenue: number;
  inputCost: number;
  index: number;
};

export type FytdComparison = {
  currentRevenue: number;
  currentCost: number;
  currentProfit: number;
  currentMarginPct: number;
  previousRevenue: number | null;
  previousCost: number | null;
  previousProfit: number | null;
  previousMarginPct: number | null;
};

export function buildFytdComparison(
  points: TrendMetricPoint[],
  currentIndex: number | null,
): FytdComparison {
  if (currentIndex === null || currentIndex < 0 || points.length === 0) {
    return {
      currentRevenue: 0,
      currentCost: 0,
      currentProfit: 0,
      currentMarginPct: 0,
      previousRevenue: null,
      previousCost: null,
      previousProfit: null,
      previousMarginPct: null,
    };
  }
  let currentRevenue = 0;
  let currentCost = 0;
  let previousRevenue = 0;
  let previousCost = 0;
  for (const point of points) {
    if (point.index <= currentIndex) {
      currentRevenue += point.revenue;
      currentCost += point.inputCost;
    }
    if (point.index < currentIndex) {
      previousRevenue += point.revenue;
      previousCost += point.inputCost;
    }
  }
  const currentProfit = currentRevenue - currentCost;
  const currentMarginPct = currentRevenue > 0 ? (currentProfit / currentRevenue) * 100 : 0;
  const hasPrevious = currentIndex > 0;
  const previousProfit = hasPrevious ? previousRevenue - previousCost : null;
  const previousMarginPct =
    hasPrevious && previousRevenue > 0 && previousProfit !== null
      ? (previousProfit / previousRevenue) * 100
      : hasPrevious
        ? 0
        : null;
  return {
    currentRevenue,
    currentCost,
    currentProfit,
    currentMarginPct,
    previousRevenue: hasPrevious ? previousRevenue : null,
    previousCost: hasPrevious ? previousCost : null,
    previousProfit,
    previousMarginPct,
  };
}
