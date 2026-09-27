import { describe, it, expect } from "vitest";
import { readAllRows } from "../read-all";

// Fake query builder over N synthetic rows; records the ranges requested.
function fakeTable(n: number, error: unknown = null) {
  const ranges: [number, number][] = [];
  const build = () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      if (error) return { data: null, error };
      const data = Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, i) => ({ id: from + i }));
      return { data, error: null };
    },
  });
  return { build, ranges };
}

describe("readAllRows", () => {
  it("returns every row past the 1,000-row PostgREST default", async () => {
    const t = fakeTable(2500);
    const rows = await readAllRows(t.build, "test");
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toEqual({ id: 2499 });
    expect(t.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("throws instead of returning partial totals when over the cap", async () => {
    await expect(readAllRows(fakeTable(1500).build, "Dashboard transactions", 1000)).rejects.toThrow(/Dashboard transactions: more than 1,000 rows/);
  });
  it("passes database errors through (no silent empty result)", async () => {
    await expect(readAllRows(fakeTable(10, { message: "permission denied" }).build, "x")).rejects.toMatchObject({ message: "permission denied" });
  });
});
