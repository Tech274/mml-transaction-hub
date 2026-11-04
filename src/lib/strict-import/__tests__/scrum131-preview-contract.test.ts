// SCRUM-131: the preview response contract Peter's Bulk Upload preview reads (see SCRUM-131-PR.md,
// "Preview response contract"). Synthetic data only.
import { describe, expect, it } from "vitest";
import { synthetic131Csv, synthetic131Customers } from "@/test-support/scrum131-fixture";
import { runPreview, type StrictImportDeps } from "../service";
import { healerFixCounts, type HealerFix } from "../review";

const enc = (s: string) => new TextEncoder().encode(s);
const named = (n: string) => [{ customer_name: n, normalized_name: n.toLowerCase() }];
const deps = (customers: { customer_name: string; normalized_name: string }[] = synthetic131Customers()): StrictImportDeps => ({
  hasImportRole: async () => true,
  listCustomers: async () => customers,
  priorImport: async () => null,
  callStage: async () => {
    throw new Error("preview never stages");
  },
  loadXlsx: async () => {
    throw new Error("xlsx not used");
  },
});

const HEADER = "Potential ID,Month,Year,Customer Name,Lab Name,Line of Business,Start Date,End Date,Total Users,Input Cost,Selling Cost,Cloud Provider";

function expectCountsMatchList(summary: object, fixes: HealerFix[]) {
  const s = summary as Record<string, unknown>;
  expect(s.healerFixCount).toBe(fixes.length);
  expect(s.dateFixes).toBe(fixes.filter((f) => f.rule === "date.reorder_to_iso").length);
  expect(s.nameFixes).toBe(fixes.filter((f) => f.rule === "customer.match_existing").length);
  expect(s.providerFixes).toBe(fixes.filter((f) => f.rule === "provider.alias").length);
  expect(s.priceFixes).toBe(fixes.filter((f) => f.rule.startsWith("price.")).length);
  expect(s.textFixes).toBe(fixes.filter((f) => f.rule === "text.trim").length);
}

describe("preview response contract", () => {
  it("synthetic 342-row file: healerFixes per row, counts equal filters over the list", async () => {
    const p = await runPreview(deps(), { filename: "synthetic.csv", bytes: enc(synthetic131Csv()) });
    const fixes = p.healerFixes ?? [];
    expect(fixes).toHaveLength(695);
    expect(p.summary).toMatchObject({ healerFixCount: 695, dateFixes: 684, nameFixes: 11, providerFixes: 0, priceFixes: 0, textFixes: 0 });
    expectCountsMatchList(p.summary, fixes);
    for (const f of fixes) {
      expect(typeof f.line).toBe("number");
      expect(typeof f.from).toBe("string");
      expect(typeof f.to).toBe("string");
      expect(f.from).not.toBe(f.to);
      expect(Object.keys(f).sort()).toEqual(["column", "from", "header", "line", "rule", "to"]);
    }
    const dateFix = fixes.find((f) => f.rule === "date.reorder_to_iso")!;
    expect(dateFix.header).toBe("Start Date");
    expect(dateFix.column).toBe("G");
    expect(dateFix.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Row errors and per-type counts keep their places.
    expect(p.rowErrors).toEqual([]);
    expect(p.summary).toMatchObject({ privateRows: 336, publicRows: 6 });
    expect(p.providerRows).toHaveLength(342);
  });

  it("alias, blank price and name fixes: from/to strings, providerRows keep the file's spelling", async () => {
    const csv = [
      HEADER,
      "SYN-1,3,2026,acme test co,Lab A,VILT,2026-03-01,2026-03-31,5,10,20,OCI",
      "SYN-2,3,2026,Acme Test Co,Lab A,VILT,2026-03-01,2026-03-31,5,,20,AWS",
    ].join("\n");
    const p = await runPreview(deps(named("Acme Test Co")), { filename: "s.csv", bytes: enc(csv) });
    const fixes = p.healerFixes ?? [];
    expect(fixes.map((f) => [f.line, f.header, f.from, f.to, f.rule])).toEqual([
      [2, "Customer Name", "acme test co", "Acme Test Co", "customer.match_existing"],
      [2, "Cloud Provider", "OCI", "Oracle", "provider.alias"],
      [3, "Input Cost", "", "0", "price.blank_to_zero"],
    ]);
    expectCountsMatchList(p.summary, fixes);
    expect(p.providerRows[0]).toMatchObject({ line: 2, providerInFile: "OCI", storedProvider: "Oracle", cloudType: "private_cloud", aliasApplied: true, blocked: false });
    expect(p.providerRows[1]).toMatchObject({ line: 3, providerInFile: "AWS", aliasApplied: false });
  });

  it("healerFixCounts on an empty list is all zeros", () => {
    expect(healerFixCounts([])).toEqual({ healerFixCount: 0, dateFixes: 0, nameFixes: 0, providerFixes: 0, priceFixes: 0, textFixes: 0 });
  });
});

describe("providerRows agree with the Healer", () => {
  it("every alias the Healer fixed is an aliasApplied provider row, and the summary count matches", async () => {
    const csv = [HEADER, "SYN-1,3,2026,Acme Test Co,Lab A,VILT,2026-03-01,2026-03-31,5,10,20,makemylabs", "SYN-2,3,2026,Acme Test Co,Lab A,VILT,2026-03-01,2026-03-31,5,10,20,Azure"].join("\n");
    const p = await runPreview(deps(named("Acme Test Co")), { filename: "s.csv", bytes: enc(csv) });
    const aliasLines = (p.healerFixes ?? []).filter((f) => f.rule === "provider.alias").map((f) => f.line);
    expect(p.providerRows.filter((r) => r.aliasApplied).map((r) => r.line)).toEqual(aliasLines);
    expect(p.summary.providerAliasesApplied).toBe(aliasLines.length);
    expect(p.summary.providerFixes).toBe(aliasLines.length);
  });
});
