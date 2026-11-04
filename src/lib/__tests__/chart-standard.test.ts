import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHART_CLOUD,
  CHART_GRID,
  CHART_HEIGHT,
  CHART_MAX_SERIES,
  CHART_SERIES,
  CHART_SERIES_BG,
  CHART_TONE,
  CHART_TOOLTIP,
  chartSeriesBg,
  chartSeriesColor,
} from "@/lib/chart-standard";

const ROOT_CSS = (() => {
  const css = readFileSync(path.resolve(__dirname, "../../styles.css"), "utf8");
  const start = css.indexOf(":root {");
  return css.slice(start, css.indexOf("}", start));
})();

function rootLightness(token: string): number {
  const m = ROOT_CSS.match(new RegExp(`--${token}:\\s*oklch\\(([0-9.]+)`));
  if (!m) throw new Error(`--${token} missing from :root`);
  return Number(m[1]);
}

describe("chart standard (SCRUM-128 §2.3)", () => {
  it("uses the fixed series order chart-2, chart-4, chart-1, chart-5, chart-3", () => {
    expect(CHART_SERIES).toEqual([
      "var(--chart-2)",
      "var(--chart-4)",
      "var(--chart-1)",
      "var(--chart-5)",
      "var(--chart-3)",
    ]);
    expect(CHART_SERIES).toHaveLength(CHART_MAX_SERIES);
  });

  it("gives Private cloud chart-2 and Public cloud chart-4", () => {
    expect(CHART_CLOUD.private_cloud).toBe("var(--chart-2)");
    expect(CHART_CLOUD.public_cloud).toBe("var(--chart-4)");
  });

  it("keeps CHART_SERIES_BG in step with CHART_SERIES", () => {
    expect(CHART_SERIES_BG).toHaveLength(CHART_SERIES.length);
    CHART_SERIES.forEach((color, i) => {
      const n = color.match(/^var\(--chart-(\d)\)$/)?.[1];
      expect(CHART_SERIES_BG[i]).toBe(`bg-chart-${n}`);
    });
  });

  it("wraps series helpers after five", () => {
    expect(chartSeriesColor(0)).toBe(CHART_SERIES[0]);
    expect(chartSeriesColor(5)).toBe(CHART_SERIES[0]);
    expect(chartSeriesColor(7)).toBe(CHART_SERIES[2]);
    expect(chartSeriesBg(6)).toBe(CHART_SERIES_BG[1]);
  });

  it("alternates lightness so neighbouring series differ by at least 0.12 (azure :root values)", () => {
    const lightness = CHART_SERIES.map((c) => rootLightness(c.slice(6, -1)));
    for (let i = 1; i < lightness.length; i++) {
      expect(Math.abs(lightness[i] - lightness[i - 1])).toBeGreaterThanOrEqual(0.12 - 1e-9);
    }
  });

  it("only references theme variables, never literal colours", () => {
    const all = JSON.stringify({
      CHART_SERIES,
      CHART_CLOUD,
      CHART_TONE,
      CHART_GRID,
      CHART_TOOLTIP,
    });
    expect(all).not.toMatch(/#[0-9a-fA-F]{3,8}\b|oklch\(|rgb\(/);
    expect(CHART_TONE).toEqual({ positive: "var(--success)", negative: "var(--destructive)" });
    expect(ROOT_CSS).toMatch(/--success:/);
    expect(CHART_HEIGHT).toBe(260);
  });
});
