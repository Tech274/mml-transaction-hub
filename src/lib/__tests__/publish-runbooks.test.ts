// SCRUM-89: the cron-secret runbook must target the live pg_cron job names, and the publish
// runbook must keep the agreed release order. A wrong job name makes the header SQL match no row,
// and the hooks on `main` then reject the scheduled calls (401).
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const cronRunbook = read("docs/runbooks/scrum-89-cron-secret.md");
const publish = read("docs/runbooks/publish-main.md");
const register = read("docs/migrations.md");

const LIVE_JOBS = ["mml-daily-snapshot-sync", "mml-hourly-freshdesk-sync", "bulk-import-cleanup-daily"];

describe("SCRUM-89 cron runbook", () => {
  it("adds the header to every live job, by its live name", () => {
    for (const job of LIVE_JOBS) {
      expect(cronRunbook).toContain(`\`${job}\``);
    }
    expect(cronRunbook).toContain("jobname = 'mml-daily-snapshot-sync'");
    expect(cronRunbook).toContain("jobname = 'mml-hourly-freshdesk-sync'");
    expect(cronRunbook).toContain("jobname = 'bulk-import-cleanup-daily'");
  });

  it("never targets the migration-era Freshdesk job name in SQL", () => {
    expect(cronRunbook).not.toMatch(/jobname\s*=\s*'mml-daily-freshdesk-sync'/);
    expect(publish).not.toContain("mml-daily-freshdesk-sync");
  });

  it("keeps the cleanup job inactive", () => {
    expect(cronRunbook).toMatch(/bulk-import-cleanup-daily[\s\S]*stays `active = false`/);
  });
});

describe("publish runbook", () => {
  it("is linked from the migrations register", () => {
    expect(register).toContain("docs/runbooks/publish-main.md");
  });

  it("lists the steps in the agreed order", () => {
    const order = [
      "without the 9 migration files",
      "Apply migrations 1 and 2, then add the cron header",
      "### 4. Publish",
      "Apply migrations 8 and 9",
      "Apply migrations 3, 5, 6 and 7",
      "Hold migration 4",
      "### 8. Verify",
    ];
    const at = order.map((s) => publish.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("avoids the sync and snapshot times", () => {
    expect(publish).toContain("HH:45 IST");
    expect(publish).toContain("07:30 IST");
  });

  it("every migration file it names exists", () => {
    const cited = [...publish.matchAll(/`(\d{14}_scrum\d+_[a-z0-9_]+)`/g)].map((m) => m[1]);
    expect(cited.length).toBe(9);
    const missing = cited.filter((v) => !existsSync(path.join(ROOT, "supabase/migrations", `${v}.sql`)));
    expect(missing).toEqual([]);
  });
});
