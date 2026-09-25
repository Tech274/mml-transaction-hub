import { describe, it, expect, vi } from "vitest";
import { decideStaleSweep, markStaleTickets, staleSweepEnabledFromEnv } from "../freshdesk-stale";

const full = { mode: "full" as const, complete: true, seen: 400 };

describe("decideStaleSweep", () => {
  it("never runs on an incremental pass", () => {
    expect(decideStaleSweep({ ...full, mode: "incremental", candidates: 5, tracked: 500 }).run).toBe(false);
  });
  it("never runs when the full pass stopped at the page limit", () => {
    expect(decideStaleSweep({ ...full, complete: false, candidates: 5, tracked: 500 }).run).toBe(false);
  });
  it("never runs when the pass returned nothing (e.g. wrong group id)", () => {
    const d = decideStaleSweep({ ...full, seen: 0, candidates: 500, tracked: 500 });
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/FRESHDESK_GROUP_ID/);
  });
  it("marks a normal number of missing tickets", () => {
    expect(decideStaleSweep({ ...full, candidates: 30, tracked: 430 })).toEqual({ run: true, reason: "marking 30 ticket(s) stale" });
  });
  it("allows up to 50 even when that is over half (small tables)", () => {
    expect(decideStaleSweep({ ...full, seen: 10, candidates: 50, tracked: 60 }).run).toBe(true);
  });
  it("refuses to mark more than half of all tickets in one go", () => {
    const d = decideStaleSweep({ ...full, seen: 100, candidates: 400, tracked: 500 });
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/refused: 400 of 500/);
  });
  it("nothing to do is not a note-worthy event", () => {
    expect(decideStaleSweep({ ...full, candidates: 0, tracked: 400 })).toEqual({ run: false, reason: "no stale tickets" });
  });
});

describe("staleSweepEnabledFromEnv", () => {
  it("is off unless exactly 'true'", () => {
    expect(staleSweepEnabledFromEnv({})).toBe(false);
    expect(staleSweepEnabledFromEnv({ FRESHDESK_STALE_SWEEP_ENABLED: "1" })).toBe(false);
    expect(staleSweepEnabledFromEnv({ FRESHDESK_STALE_SWEEP_ENABLED: "TRUE" })).toBe(false);
    expect(staleSweepEnabledFromEnv({ FRESHDESK_STALE_SWEEP_ENABLED: " true " })).toBe(true);
  });
});

/** Fake supabase query builder: records every call, resolves with the next queued result. */
function fakeDb(results: Array<Record<string, unknown>>) {
  const calls: Array<Array<[string, unknown[]]>> = [];
  const from = vi.fn(() => {
    const log: Array<[string, unknown[]]> = [];
    calls.push(log);
    const result = results[calls.length - 1];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "is", "lt", "update"]) {
      b[m] = (...args: unknown[]) => {
        log.push([m, args]);
        return b;
      };
    }
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
    return b;
  });
  return { db: { from }, calls };
}

const RUN_START = "2026-09-25T21:00:00.000Z";

describe("markStaleTickets", () => {
  it("stamps only untouched, not-yet-stale rows and never deletes", async () => {
    const { db, calls } = fakeDb([
      { count: 430, error: null },
      { count: 30, error: null },
      { data: Array.from({ length: 30 }, (_, i) => ({ id: i })), error: null },
    ]);
    const r = await markStaleTickets(db, { runStartIso: RUN_START, ...full, now: new Date("2026-09-25T21:07:00Z") });
    expect(r).toEqual({ marked: 30, note: "Marked 30 ticket(s) stale (no longer returned by Freshdesk for this group)." });
    const update = calls[2];
    expect(update).toContainEqual(["update", [{ stale_since: "2026-09-25T21:07:00.000Z" }]]);
    expect(update).toContainEqual(["is", ["stale_since", null]]);
    expect(update).toContainEqual(["lt", ["synced_at", RUN_START]]);
    expect(calls.flat().some(([m]) => m === "delete")).toBe(false);
  });

  it("does not update anything when the guard refuses", async () => {
    const { db, calls } = fakeDb([{ count: 500, error: null }, { count: 400, error: null }]);
    const r = await markStaleTickets(db, { runStartIso: RUN_START, ...full, seen: 100 });
    expect(r.marked).toBe(0);
    expect(r.note).toMatch(/^Stale sweep skipped: refused/);
    expect(calls).toHaveLength(2);
  });

  it("a database error becomes a note instead of failing the sync", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb([{ count: null, error: { message: 'column "stale_since" does not exist' } }]);
    const r = await markStaleTickets(db, { runStartIso: RUN_START, ...full });
    expect(r).toEqual({ marked: 0, note: 'Stale sweep failed: column "stale_since" does not exist' });
    spy.mockRestore();
  });

  it("no candidates: no update and no note", async () => {
    const { db, calls } = fakeDb([{ count: 400, error: null }, { count: 0, error: null }]);
    expect(await markStaleTickets(db, { runStartIso: RUN_START, ...full })).toEqual({ marked: 0, note: null });
    expect(calls).toHaveLength(2);
  });
});

describe("runFreshdeskSync wiring (source check)", () => {
  const src = Object.values(import.meta.glob("../freshdesk.server.ts", { query: "?raw", import: "default", eager: true }))[0] as string;
  it("only sends stale_since when the sweep flag is on (column may not exist yet)", () => {
    expect(src).toMatch(/\.\.\.\(staleSweep \? \{ stale_since: null \} : \{\}\)/);
  });
  it("only sweeps after a full pass", () => {
    expect(src).toMatch(/if \(staleSweep && syncWindow\.mode === "full"\)/);
  });
});
