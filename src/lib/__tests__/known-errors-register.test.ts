// SCRUM-63: keeps docs/review/KNOWN_ERRORS_REGISTER.md honest: every review finding G-01..G-26
// is listed exactly once with a ticket, and every test or file it cites as evidence exists.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const doc = readFileSync(path.join(ROOT, "docs/review/KNOWN_ERRORS_REGISTER.md"), "utf8");
const gap = readFileSync(path.join(ROOT, "docs/review/GAP_ANALYSIS.md"), "utf8");
const rows = doc.split("\n").filter((l) => /^\| G-\d\d \|/.test(l));

describe("known errors register (SCRUM-63)", () => {
  it("lists every finding in GAP_ANALYSIS exactly once", () => {
    const inGap = [...new Set([...gap.matchAll(/^### (G-\d\d):/gm)].map((m) => m[1]))].sort();
    const inRegister = rows.map((r) => r.split("|")[1].trim());
    expect(inGap).toHaveLength(26);
    expect([...inRegister].sort()).toEqual(inGap);
    expect(new Set(inRegister).size).toBe(inRegister.length);
  });

  it("every finding has a severity that matches GAP_ANALYSIS and a Jira ticket", () => {
    const sevOf = new Map<string, string>();
    let current = "";
    for (const line of gap.split("\n")) {
      const h = line.match(/^## (Critical|High|Medium|Low)\b/);
      if (h) current = h[1];
      const g = line.match(/^### (G-\d\d):/);
      if (g) sevOf.set(g[1], current);
    }
    for (const r of rows) {
      const cells = r.split("|").map((c) => c.trim());
      expect(cells[3], cells[1]).toBe(sevOf.get(cells[1]));
      expect(cells[5], cells[1]).toMatch(/SCRUM-\d+/);
    }
  });

  it("every critical finding is flagged data-impacting", () => {
    for (const r of rows.filter((x) => x.includes("| Critical |"))) expect(r).toContain("**High**");
  });

  it("every file cited as evidence exists in the repo", () => {
    const cited = [...doc.matchAll(/`((?:src|supabase|docs|scripts)\/[^`\s]+)`/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(15);
    const missing = cited.filter((p) => !existsSync(path.join(ROOT, p.replace(/\/$/, ""))));
    expect(missing).toEqual([]);
  });
});
