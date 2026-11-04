// SCRUM-128 (plan §2.3, D6): the one place charts get their colours and shared recharts props.
// Pages never write colour literals or style objects for charts; they import these constants.
//
// The azure --chart-1..5 values are one hue, so the series order alternates dark and light
// (lightness 0.52, 0.70, 0.58, 0.76, 0.64): two neighbouring series always differ by at least
// 0.12 in lightness. --chart-4 and --chart-5 are below 3:1 against white, so slices and bars
// also rely on the legend, PIE_SLICE_STROKE and direct labels (plan R3).
import type { CSSProperties } from "react";
import type { CloudType } from "@/lib/cloud-provider";

/** At most this many series or slices per chart; more categories become the top 4 plus "Other". */
export const CHART_MAX_SERIES = 5;

/** Series 1–5, in this order. */
export const CHART_SERIES = [
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-1)",
  "var(--chart-5)",
  "var(--chart-3)",
] as const;

/**
 * Background utilities matching CHART_SERIES one for one, for legend dots (`size-2 rounded-full`).
 * Written out as literal class names so Tailwind's source scan generates them.
 */
export const CHART_SERIES_BG = [
  "bg-chart-2",
  "bg-chart-4",
  "bg-chart-1",
  "bg-chart-5",
  "bg-chart-3",
] as const;

/** Colour of series `index` (wraps after five). */
export function chartSeriesColor(index: number): string {
  const n = CHART_SERIES.length;
  return CHART_SERIES[((index % n) + n) % n];
}

/** Legend-dot class of series `index` (wraps after five). */
export function chartSeriesBg(index: number): string {
  const n = CHART_SERIES_BG.length;
  return CHART_SERIES_BG[((index % n) + n) % n];
}

/** Fixed colours for every Private vs Public split on every page. */
export const CHART_CLOUD: Readonly<Record<CloudType, string>> = {
  private_cloud: "var(--chart-2)",
  public_cloud: "var(--chart-4)",
};

/** Only for series that mean good or bad (for example failed runs). */
export const CHART_TONE = {
  positive: "var(--success)",
  negative: "var(--destructive)",
} as const;

/** Spread into `<CartesianGrid {...CHART_GRID} />`. */
export const CHART_GRID = { strokeDasharray: "3 3", stroke: "var(--border)" } as const;

/** Pass as `tick={CHART_AXIS_TICK}` on `XAxis` / `YAxis`. */
export const CHART_AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

/** Spread into every `<Tooltip {...CHART_TOOLTIP} />`. */
export const CHART_TOOLTIP: { contentStyle: CSSProperties; labelStyle: CSSProperties } = {
  contentStyle: {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
  },
  labelStyle: { color: "var(--foreground)" },
};

/** Height of every chart (`ResponsiveContainer height={CHART_HEIGHT}`). */
export const CHART_HEIGHT = 260;

/** Spread into `<Pie>` so neighbouring slices stay apart. */
export const PIE_SLICE_STROKE = { stroke: "var(--card)", strokeWidth: 2 } as const;
