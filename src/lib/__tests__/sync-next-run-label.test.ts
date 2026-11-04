// SCRUM-128 C14/C18: Sync Status "Next scheduled run" is shown in IST. C14: labelled IST, not UTC.
// C18: formatted explicitly in Asia/Kolkata, so the browser's own zone does not matter.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatNextScheduledRun } from "@/lib/sync-schedule-label";

describe("formatNextScheduledRun (C14)", () => {
  let savedTz: string | undefined;
  beforeEach(() => {
    savedTz = process.env.TZ;
    process.env.TZ = "Asia/Kolkata";
  });
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("shows 02:00Z as 07:30 IST", () => {
    expect(formatNextScheduledRun("2026-09-30T02:00:00Z")).toBe("30 Sep, 07:30 IST");
  });

  it("crosses midnight the same way as before (20:00Z → next day 01:30 IST)", () => {
    expect(formatNextScheduledRun("2026-09-30T20:00:00Z")).toBe("01 Oct, 01:30 IST");
  });

  it("keeps the minutes and a 00 hour at IST midnight (18:30Z → next day 00:00 IST)", () => {
    expect(formatNextScheduledRun("2026-09-30T18:30:00Z")).toBe("01 Oct, 00:00 IST");
  });

  it("the Sync Status page uses it and no longer labels the time UTC", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "routes", "_authenticated", "sync-status.tsx"),
      "utf8",
    );
    expect(src).toContain("formatNextScheduledRun(d.next_cron_at)");
    expect(src).not.toContain("HH:mm 'UTC'");
  });
});

// C18: the shown time is IST whatever the browser's zone (the only value change, for non-IST browsers).
describe.each(["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"])(
  "formatNextScheduledRun with the browser on %s (C18)",
  (zone) => {
    let savedTz: string | undefined;
    beforeEach(() => {
      savedTz = process.env.TZ;
      process.env.TZ = zone;
    });
    afterEach(() => {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    });

    it("still shows 02:00Z as 30 Sep, 07:30 IST", () => {
      expect(new Date("2026-09-30T02:00:00Z").getTimezoneOffset()).not.toBe(-330);
      expect(formatNextScheduledRun("2026-09-30T02:00:00Z")).toBe("30 Sep, 07:30 IST");
    });

    it("crosses midnight in IST, not in the browser's zone", () => {
      expect(formatNextScheduledRun("2026-09-30T20:00:00Z")).toBe("01 Oct, 01:30 IST");
    });
  },
);
