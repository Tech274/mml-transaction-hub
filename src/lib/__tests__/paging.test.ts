import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, ttlCache } from "../paging";

const source = (n: number) => async (from: number, to: number) => Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, i) => from + i);

describe("fetchAllPages", () => {
  it("reads past 5,000 rows (the old silent cap)", async () => {
    const r = await fetchAllPages(source(7250), 1000, 50_000);
    expect(r.rows).toHaveLength(7250);
    expect(r.truncated).toBe(false);
  });
  it("stops at maxRows and reports truncation instead of hiding it", async () => {
    const r = await fetchAllPages(source(12_000), 1000, 10_000);
    expect(r.rows).toHaveLength(10_000);
    expect(r.truncated).toBe(true);
  });
  it("exactly maxRows is not truncated", async () => {
    const r = await fetchAllPages(source(3000), 1000, 3000);
    expect(r).toMatchObject({ truncated: false });
    expect(r.rows).toHaveLength(3000);
  });
  it("empty table", async () => {
    expect(await fetchAllPages(source(0), 1000, 10_000)).toEqual({ rows: [], truncated: false });
  });
});

describe("ttlCache", () => {
  it("calls the loader once per TTL window and shares in-flight calls", async () => {
    let t = 0;
    const load = vi.fn(async () => ({ ok: true }));
    const get = ttlCache(300_000, load, () => t);
    await Promise.all([get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
    t = 299_999;
    await get();
    expect(load).toHaveBeenCalledTimes(1);
    t = 300_000;
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not cache a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("up");
    const get = ttlCache(1000, load);
    await expect(get()).rejects.toThrow("down");
    await expect(get()).resolves.toBe("up");
  });
});
