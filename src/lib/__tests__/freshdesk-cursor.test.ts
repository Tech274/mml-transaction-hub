import { describe, it, expect } from "vitest";
import { decideSyncWindow, fullSyncHourFromEnv, runOutcome } from "../freshdesk-cursor";

const FROM = "2026-04-01T00:00:00Z";
const base = { ticketsFrom: FROM, fullSyncHourUtc: 21 as number | null };

describe("decideSyncWindow", () => {
  it("first run (no success on record) is a full pass from the configured start date", () => {
    expect(decideSyncWindow({ ...base, now: new Date("2026-09-25T10:05:00Z"), lastSuccessStartedAt: null })).toEqual({
      mode: "full", updatedSince: "2026-04-01T00:00:00.000Z", reason: "no successful run on record",
    });
  });
  it("hourly run is incremental from the last successful start minus 10 minutes", () => {
    const d = decideSyncWindow({ ...base, now: new Date("2026-09-25T10:05:00Z"), lastSuccessStartedAt: "2026-09-25T09:05:00Z" });
    expect(d.mode).toBe("incremental");
    expect(d.updatedSince).toBe("2026-09-25T08:55:00.000Z");
  });
  it("after failed runs the window grows back to the last success (nothing is skipped)", () => {
    const d = decideSyncWindow({ ...base, now: new Date("2026-09-25T15:05:00Z"), lastSuccessStartedAt: "2026-09-25T09:05:00Z" });
    expect(d.updatedSince).toBe("2026-09-25T08:55:00.000Z");
  });
  it("never goes earlier than the configured start date", () => {
    const d = decideSyncWindow({ ...base, now: new Date("2026-04-01T00:30:00Z"), lastSuccessStartedAt: "2026-04-01T00:05:00Z" });
    expect(d.updatedSince).toBe("2026-04-01T00:00:00.000Z");
  });
  it("runs a full pass once a day in the configured UTC hour, or when forced", () => {
    expect(decideSyncWindow({ ...base, now: new Date("2026-09-25T21:05:00Z"), lastSuccessStartedAt: "2026-09-25T20:05:00Z" }).mode).toBe("full");
    expect(decideSyncWindow({ ...base, fullSyncHourUtc: null, now: new Date("2026-09-25T21:05:00Z"), lastSuccessStartedAt: "2026-09-25T20:05:00Z" }).mode).toBe("incremental");
    expect(decideSyncWindow({ ...base, forceFull: true, now: new Date("2026-09-25T10:05:00Z"), lastSuccessStartedAt: "2026-09-25T09:05:00Z" }).mode).toBe("full");
  });
});

describe("fullSyncHourFromEnv", () => {
  it("defaults to 21 UTC (02:30 IST), accepts 0-23 or off, rejects junk", () => {
    expect(fullSyncHourFromEnv({})).toBe(21);
    expect(fullSyncHourFromEnv({ FRESHDESK_FULL_SYNC_HOUR_UTC: "3" })).toBe(3);
    expect(fullSyncHourFromEnv({ FRESHDESK_FULL_SYNC_HOUR_UTC: "off" })).toBeNull();
    expect(() => fullSyncHourFromEnv({ FRESHDESK_FULL_SYNC_HOUR_UTC: "24" })).toThrow();
  });
});

describe("runOutcome", () => {
  it("complete runs are plain successes", () => {
    expect(runOutcome("incremental", true, 60, 5)).toEqual({ failure: null, note: null });
  });
  it("an incomplete incremental run fails so the cursor does not skip unread pages", () => {
    expect(runOutcome("incremental", false, 60, 6000).failure).toMatch(/page limit \(60 pages\).*saved 6000/);
  });
  it("an incomplete full pass succeeds with a visible note (same coverage as before)", () => {
    const o = runOutcome("full", false, 60, 6000);
    expect(o.failure).toBeNull();
    expect(o.note).toMatch(/^Warning: full pass stopped/);
  });
});
