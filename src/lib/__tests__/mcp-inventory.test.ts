// SCRUM-75: docs/mcp-tools-inventory.md must match the MCP server in code: same tools, same
// tables, all read-only. Adding a tool (or a table to a tool) without updating the inventory fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const doc = readFileSync(path.join(ROOT, "docs/mcp-tools-inventory.md"), "utf8");
const index = readFileSync(path.join(ROOT, "src/lib/mcp/index.ts"), "utf8");

type Tool = { file: string; name: string; readOnly: boolean; tables: string[]; writes: boolean };
const tools: Tool[] = [...index.matchAll(/import \w+ from "\.\/tools\/([\w-]+)"/g)].map((m) => {
  const file = `src/lib/mcp/tools/${m[1]}.ts`;
  const src = readFileSync(path.join(ROOT, file), "utf8");
  return {
    file,
    name: src.match(/name:\s*"([\w-]+)"/)![1],
    readOnly: /readOnlyHint:\s*true/.test(src),
    tables: [...new Set([...src.matchAll(/\.from\("(\w+)"\)/g)].map((x) => x[1]))].sort(),
    writes: /\.(insert|update|upsert|delete)\(|\.rpc\(/.test(src),
  };
});
const row = (name: string) => doc.split("\n").find((l) => l.startsWith(`| \`${name}\` |`));

describe("MCP tools inventory (SCRUM-75)", () => {
  it("finds the registered tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(["list_customers", "list_transactions", "reports_summary", "whoami"]);
  });

  it("every registered tool has exactly one inventory row, and no extra rows exist", () => {
    const rows = doc.split("\n").filter((l) => /^\| `[a-z_]+` \| (read|write|destructive) \|/.test(l));
    expect(rows.map((l) => l.split("`")[1]).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it.each(tools.map((t) => [t.name, t] as const))("%s: tables and class match the code", (name, t) => {
    const r = row(name)!;
    expect(r).toBeDefined();
    const cells = r.split("|").map((c) => c.trim());
    const cls = cells[2];
    const tablesCell = cells[5];
    for (const table of t.tables) expect(tablesCell, `${name} reads ${table}`).toContain(`\`${table}\``);
    expect(cls).toBe(t.writes ? "write" : "read");
    expect(t.readOnly, `${name} must declare readOnlyHint: true while classed read`).toBe(cls === "read");
  });

  it("no tool uses the service-role client", () => {
    for (const t of tools) expect(readFileSync(path.join(ROOT, t.file), "utf8")).not.toMatch(/supabaseAdmin|client\.server|SERVICE_ROLE/);
  });

  it("every tool is wrapped in withAudit (revocation check + audit row)", () => {
    for (const t of tools) expect(readFileSync(path.join(ROOT, t.file), "utf8")).toMatch(new RegExp(`withAudit\\("${t.name}"`));
  });
});
