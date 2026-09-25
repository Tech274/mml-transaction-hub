import { describe, it, expect } from "vitest";
import { DEFAULT_FRESHDESK_SCOPE, formatDailyTimeUtc, freshdeskScopeFromEnv, nextDailyRunAt, snapshotCronFromEnv } from "../app-config";

describe("freshdeskScopeFromEnv", () => {
  it("defaults to the previously hard-coded values (no behaviour change)", () => {
    expect(freshdeskScopeFromEnv({})).toEqual({ groupId: 1060000391179, groupName: "Cloud Labs", ticketsFrom: "2026-04-01T00:00:00Z" });
    expect(freshdeskScopeFromEnv({ FRESHDESK_GROUP_ID: "  " })).toEqual(DEFAULT_FRESHDESK_SCOPE);
  });
  it("reads overrides", () => {
    expect(freshdeskScopeFromEnv({ FRESHDESK_GROUP_ID: "123", FRESHDESK_GROUP_NAME: "Test Group", FRESHDESK_TICKETS_FROM: "2026-05-01" })).toEqual({
      groupId: 123, groupName: "Test Group", ticketsFrom: "2026-05-01T00:00:00Z",
    });
    expect(freshdeskScopeFromEnv({ FRESHDESK_TICKETS_FROM: "2026-05-01T06:30:00Z" }).ticketsFrom).toBe("2026-05-01T06:30:00Z");
  });
  it("rejects invalid values instead of silently using the default", () => {
    expect(() => freshdeskScopeFromEnv({ FRESHDESK_GROUP_ID: "abc" })).toThrow(/FRESHDESK_GROUP_ID/);
    expect(() => freshdeskScopeFromEnv({ FRESHDESK_TICKETS_FROM: "01/05/2026" })).toThrow(/FRESHDESK_TICKETS_FROM/);
    expect(() => freshdeskScopeFromEnv({ FRESHDESK_TICKETS_FROM: "2026-05-01T00:00:00+05:30" })).toThrow(/UTC/);
  });
});

describe("snapshot schedule", () => {
  it("defaults to 02:00 UTC and validates HH:MM", () => {
    expect(snapshotCronFromEnv({})).toEqual({ hour: 2, minute: 0 });
    expect(snapshotCronFromEnv({ SNAPSHOT_CRON_UTC: "21:45" })).toEqual({ hour: 21, minute: 45 });
    expect(() => snapshotCronFromEnv({ SNAPSHOT_CRON_UTC: "25:00" })).toThrow();
    expect(formatDailyTimeUtc({ hour: 2, minute: 0 })).toBe("02:00 UTC");
  });
  it("next run is later today, or tomorrow once the time has passed", () => {
    expect(nextDailyRunAt(new Date("2026-09-25T01:00:00Z"), { hour: 2, minute: 0 })).toBe("2026-09-25T02:00:00.000Z");
    expect(nextDailyRunAt(new Date("2026-09-25T02:00:00Z"), { hour: 2, minute: 0 })).toBe("2026-09-26T02:00:00.000Z");
  });
});
