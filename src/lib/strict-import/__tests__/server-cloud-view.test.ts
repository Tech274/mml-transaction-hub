import { describe, expect, it } from "vitest";
import {
  committedCloudCounts,
  groupHealerFixesByRule,
  HEALER_RULE_LABELS,
  HEALER_RULE_ORDER,
  healerFixWhere,
  healerRuleLabel,
  providerRowsAgreeWithSummary,
  serverCloudCounts,
  serverErrorsByLine,
  serverHealerFixCount,
  serverHealerFixLines,
  serverStandardisedLine,
} from "@/lib/strict-import/server-cloud-view";
import {
  cloudPreviewSummary,
  importedTitle,
  importFootnote,
} from "@/lib/strict-import/cloud-preview";
import type { ProviderRowInfo } from "@/lib/strict-import/validate";
import { runPreview, type StrictImportDeps } from "@/lib/strict-import/service";
import { synthetic131Csv, synthetic131Customers } from "@/test-support/scrum131-fixture";

// Synthetic server rows only.
const providerRows: ProviderRowInfo[] = [
  {
    line: 2,
    providerInFile: "MakeMyLabs Private Cloud",
    storedProvider: "MakeMyLabs Private Cloud",
    cloudType: "private_cloud",
    aliasApplied: false,
    blocked: false,
  },
  {
    line: 3,
    providerInFile: "OCI",
    storedProvider: "Oracle",
    cloudType: "private_cloud",
    aliasApplied: true,
    blocked: false,
  },
  {
    line: 4,
    providerInFile: "Azure",
    storedProvider: "Azure",
    cloudType: "public_cloud",
    aliasApplied: false,
    blocked: false,
  },
  {
    line: 5,
    providerInFile: "",
    storedProvider: null,
    cloudType: null,
    aliasApplied: false,
    blocked: true,
  },
];
const summary = { privateRows: 2, publicRows: 1, providerErrorRows: 1, providerAliasesApplied: 1 };

describe("Bulk Upload preview reads only the server check", () => {
  it("counts, footnote and imported title come from the server", () => {
    const c = serverCloudCounts({ privateRows: 336, publicRows: 6 });
    expect(cloudPreviewSummary(c)).toBe("336 Private cloud · 6 Public cloud");
    expect(importFootnote(c)).toBe(
      "All or nothing: 336 Private cloud and 6 Public cloud rows will be saved.",
    );
    expect(importedTitle(342, committedCloudCounts({ privateRows: 336, publicRows: 6 }))).toBe(
      "342 rows imported: 336 Private cloud · 6 Public cloud",
    );
  });

  it("server summary agrees with its providerRows (contract check)", () => {
    expect(providerRowsAgreeWithSummary({ providerRows, summary })).toBe(true);
    expect(
      providerRowsAgreeWithSummary({ providerRows, summary: { ...summary, privateRows: 3 } }),
    ).toBe(false);
  });

  it("standardised line and Healer fixes come from providerRows", () => {
    expect(serverStandardisedLine({ providerRows, summary })).toBe(
      "1 provider standardised (e.g. OCI → Oracle)",
    );
    expect(
      serverStandardisedLine({ providerRows, summary: { providerAliasesApplied: 0 } }),
    ).toBeNull();
    expect(serverHealerFixLines({ providerRows })).toEqual([
      {
        line: 3,
        column: null,
        field: "Cloud Provider",
        from: "OCI",
        to: "Oracle",
        rule: "provider.alias",
      },
    ]);
  });

  it("healerFixes is the only source when present: an alias is listed once, not twice", () => {
    const lines = serverHealerFixLines({
      providerRows,
      healerFixes: [
        {
          line: 3,
          column: "L",
          header: "Cloud Provider",
          from: "OCI",
          to: "Oracle",
          rule: "provider.alias",
        },
        {
          line: 2,
          column: "G",
          header: "Start Date",
          from: "1/9/26",
          to: "2026-09-01",
          rule: "date.reorder_to_iso",
        },
      ],
    });
    expect(lines.map((l) => [l.line, l.column, l.field, l.rule])).toEqual([
      [2, "G", "Start Date", "date.reorder_to_iso"],
      [3, "L", "Cloud Provider", "provider.alias"],
    ]);
    // An empty list from the server means no fixes: the providerRows fallback is not used.
    expect(serverHealerFixLines({ providerRows, healerFixes: [] })).toEqual([]);
  });

  it("groups server row errors by line", () => {
    const m = serverErrorsByLine([
      {
        line: 5,
        column: "K",
        header: "Cloud Provider",
        value: "",
        message: "Cloud Provider is blank.",
      },
      { line: 5, column: "C", header: "Year", value: "x", message: "Year is invalid." },
    ]);
    expect(m.get(5)).toEqual(["Cloud Provider is blank.", "Year is invalid."]);
  });
});

// Bug from Chris's trial merge (SCRUM-131-PR.md): one OCI row listed twice. Real runPreview,
// synthetic one-row file.
describe("one OCI row through Chris's runPreview", () => {
  const deps: StrictImportDeps = {
    hasImportRole: async () => true,
    listCustomers: async () => [{ customer_name: "Acme Test Co", normalized_name: "acme test co" }],
    priorImport: async () => null,
    callStage: async () => {
      throw new Error("preview never stages");
    },
    loadXlsx: async () => {
      throw new Error("xlsx not used");
    },
  };
  const csv = [
    "Potential ID,Month,Year,Customer Name,Lab Name,Line of Business,Start Date,End Date,Total Users,Input Cost,Selling Cost,Cloud Provider",
    "SYN-OCI-1,3,2026,Acme Test Co,Lab A,VILT,2026-03-01,2026-03-31,5,10,20,OCI",
  ].join("\n");

  it("gives 1 Healer fix line and healerFixCount 1", async () => {
    const p = await runPreview(deps, {
      filename: "oci.csv",
      bytes: new TextEncoder().encode(csv),
    });
    expect(p.summary.healerFixCount).toBe(1);
    expect(p.summary.providerFixes).toBe(1);
    const lines = serverHealerFixLines(p);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      line: 2,
      from: "OCI",
      to: "Oracle",
      rule: "provider.alias",
    });
    expect(serverHealerFixCount(p)).toBe(1);
    expect(lines).toHaveLength(p.summary.healerFixCount ?? -1);
  });
});

describe("Healer fixes grouped by rule", () => {
  const fix = (line: number, rule: string, from = "a", to = "b", column: string | null = "G") => ({
    line,
    column,
    field: "Header",
    from,
    to,
    rule,
  });

  it("orders groups by the contract's rule order, unknown rules last, lines sorted", () => {
    const groups = groupHealerFixesByRule([
      fix(9, "text.trim"),
      fix(4, "provider.alias", "OCI", "Oracle"),
      fix(3, "zz.future_rule"),
      fix(7, "date.reorder_to_iso", "1/9/26", "2026-09-01"),
      fix(2, "date.reorder_to_iso", "3/3/26", "2026-03-03"),
      fix(5, "price.blank_to_zero", "", "0"),
    ]);
    expect(groups.map((g) => [g.rule, g.fixes.map((f) => f.line)])).toEqual([
      ["date.reorder_to_iso", [2, 7]],
      ["provider.alias", [4]],
      ["price.blank_to_zero", [5]],
      ["text.trim", [9]],
      ["zz.future_rule", [3]],
    ]);
    expect(groups[0].label).toBe("Dates rewritten as YYYY-MM-DD");
    expect(groups[4].label).toBe("zz.future_rule");
  });

  it("every contract rule has a sentence-case label", () => {
    for (const r of HEALER_RULE_ORDER) {
      const label = HEALER_RULE_LABELS[r];
      expect(label.length).toBeGreaterThan(0);
      expect(label[0]).toBe(label[0].toUpperCase());
      expect(label.slice(1)).not.toMatch(/\b(Dates|Names|Prices|Spaces|Standardised)\b/);
      expect(healerRuleLabel(r)).toBe(label);
    }
  });

  it("an empty list gives no groups; where-text shows line and column", () => {
    expect(groupHealerFixesByRule([])).toEqual([]);
    expect(healerFixWhere({ line: 12, column: "G" })).toBe("Line 12 · col G");
    expect(healerFixWhere({ line: 12, column: null })).toBe("Line 12");
  });

  it("group sizes equal the server's per-rule counts (synthetic 131 preview)", async () => {
    const p = await runPreview(
      {
        hasImportRole: async () => true,
        listCustomers: async () => synthetic131Customers(),
        priorImport: async () => null,
        callStage: async () => {
          throw new Error("preview never stages");
        },
        loadXlsx: async () => {
          throw new Error("xlsx not used");
        },
      },
      { filename: "s.csv", bytes: new TextEncoder().encode(synthetic131Csv()) },
    );
    const size = (rule: string) =>
      groupHealerFixesByRule(serverHealerFixLines(p)).find((g) => g.rule === rule)?.fixes.length ??
      0;
    expect(size("date.reorder_to_iso")).toBe(p.summary.dateFixes);
    expect(size("customer.match_existing")).toBe(p.summary.nameFixes);
    expect(size("provider.alias")).toBe(p.summary.providerFixes);
    expect(size("price.blank_to_zero") + size("price.invalid_to_zero")).toBe(p.summary.priceFixes);
    expect(size("text.trim")).toBe(p.summary.textFixes);
  });
});
