import { describe, it, expect, vi } from "vitest";
import { summarizeSyncHealth, type RunLike } from "../sync-health";
import { finishRun, startRun } from "../sync-run-log";

const NOW = new Date("2026-09-25T10:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const run = (minAgo: number, status: string, error: string | null = null): RunLike => ({
  status, started_at: ago(minAgo), finished_at: status === "running" ? null : ago(minAgo - 1), error_message: error,
});

describe("summarizeSyncHealth", () => {
  it("no runs = never", () => {
    expect(summarizeSyncHealth([], NOW).state).toBe("never");
  });
  it("recent success = ok", () => {
    const h = summarizeSyncHealth([run(10, "success"), run(70, "success")], NOW);
    expect(h).toMatchObject({ state: "ok", consecutiveFailures: 0, runsLast24h: 2, failuresLast24h: 0 });
  });
  it("one failure after a success = warning", () => {
    const h = summarizeSyncHealth([run(10, "error", "Freshdesk 429"), run(70, "success")], NOW);
    expect(h).toMatchObject({ state: "warning", consecutiveFailures: 1, lastError: "Freshdesk 429" });
  });
  it("2 failures in a row = failing (alert), with the newest error", () => {
    const h = summarizeSyncHealth([run(70, "error", "older"), run(10, "error", "newest"), run(130, "success")], NOW);
    expect(h).toMatchObject({ state: "failing", consecutiveFailures: 2, lastError: "newest" });
  });
  it("a run stuck in 'running' for over 30 minutes counts as a failure; a fresh one is ignored", () => {
    expect(summarizeSyncHealth([run(5, "running"), run(65, "success")], NOW).state).toBe("ok");
    const h = summarizeSyncHealth([run(40, "running"), run(100, "error", "x"), run(160, "success")], NOW);
    expect(h.state).toBe("failing");
    expect(h.consecutiveFailures).toBe(2);
  });
  it("no success for more than 3 hours = stale", () => {
    expect(summarizeSyncHealth([run(200, "success")], NOW).state).toBe("stale");
    expect(summarizeSyncHealth([run(20, "running")], NOW).state).toBe("stale");
  });
  it("only counts the last 24h in the 24h figures", () => {
    const h = summarizeSyncHealth([run(10, "success"), run(60 * 25, "error")], NOW);
    expect(h.runsLast24h).toBe(1);
    expect(h.failuresLast24h).toBe(0);
  });
});

function fakeDb(opts: { insertError?: string; updateErrors?: (string | null)[] } = {}) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const updateErrors = [...(opts.updateErrors ?? [])];
  return {
    inserts,
    updates,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { select: () => ({ single: async () => (opts.insertError ? { data: null, error: { message: opts.insertError } } : { data: { id: "run-1" }, error: null }) }) };
      },
      update: (row: Record<string, unknown>) => {
        updates.push(row);
        const err = updateErrors.shift() ?? null;
        return { eq: async () => ({ error: err ? { message: err } : null }) };
      },
    }),
  };
}

describe("sync-run-log", () => {
  it("records a freshdesk run start and finish with counts", async () => {
    const db = fakeDb();
    const id = await startRun(db, { kind: "freshdesk", trigger_source: "cron" });
    expect(id).toBe("run-1");
    expect(db.inserts[0]).toMatchObject({ kind: "freshdesk", trigger_source: "cron", status: "running" });
    await finishRun(db, id, { status: "success", duration_ms: 1234, fetched_count: 10, upserted_count: 10 });
    expect(db.updates[0]).toMatchObject({ status: "success", duration_ms: 1234, fetched_count: 10, upserted_count: 10, error_message: null });
  });
  it("logs (does not hide) a failed start and keeps going", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ insertError: "permission denied" });
    expect(await startRun(db, { kind: "freshdesk", trigger_source: "manual" })).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("falls back to base columns when the count columns are missing (migration not applied)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = fakeDb({ updateErrors: ['column "fetched_count" does not exist', null] });
    await finishRun(db, "run-1", { status: "error", duration_ms: 5, error_message: "boom", fetched_count: 0, upserted_count: 0 });
    expect(db.updates).toHaveLength(2);
    expect(db.updates[1]).not.toHaveProperty("fetched_count");
    expect(db.updates[1]).toMatchObject({ status: "error", error_message: "boom" });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
