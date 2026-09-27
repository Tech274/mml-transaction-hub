// SCRUM-46: the current-state audit must cover every page in the app. Adding a page without an
// audit row fails this test.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const doc = readFileSync(path.join(ROOT, "docs/review/CURRENT_STATE_AND_30_DAY_ROADMAP.md"), "utf8");

describe("current-state audit (SCRUM-46)", () => {
  it("has a row for every signed-in page", () => {
    const pages = readdirSync(path.join(ROOT, "src/routes/_authenticated"))
      .filter((f) => f.endsWith(".tsx") && f !== "route.tsx")
      .map((f) => `src/routes/_authenticated/${f}`);
    expect(pages.length).toBeGreaterThan(10);
    const missing = pages.filter((p) => !doc.includes(`\`${p}\``));
    expect(missing).toEqual([]);
  });

  it("covers sign-in, the job hooks and the MCP endpoint", () => {
    for (const p of ["src/routes/auth.tsx", "src/routes/api/public/hooks/", "src/routes/mcp.ts"]) expect(doc).toContain(`\`${p}\``);
  });

  it("every path it cites exists", () => {
    const cited = [...doc.matchAll(/`((?:src|supabase|docs)\/[^`\s]+)`/g)].map((m) => m[1]);
    const missing = cited.filter((p) => !existsSync(path.join(ROOT, p.replace(/\/$/, ""))));
    expect(missing).toEqual([]);
  });
});
