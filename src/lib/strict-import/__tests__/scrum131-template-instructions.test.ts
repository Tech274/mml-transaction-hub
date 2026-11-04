// SCRUM-131 (John, 06:55): the template instructions call all six REQUIRED_TRANSACTION_FIELDS required.
// Text only: the template column `required` flags and lenient-mode behaviour must not change.
import { describe, it, expect } from "vitest";
import { REQUIRED_TRANSACTION_FIELDS } from "@/lib/transaction-completeness";
import { PROPOSED_RULES, STRICT_COLUMNS } from "../template";
import { STRICT_REQUIRED_COLUMN_HEADERS, STRICT_TEMPLATE_BANNER, STRICT_TEMPLATE_INSTRUCTIONS, strictTemplateCsv } from "../ui-state";
import { parseCsvText } from "../parse";
import { validateStrict } from "../validate";

const headerOf = (field: string) => STRICT_COLUMNS.find((c) => c.field === field)!.header;

describe("template instructions name all six required fields", () => {
  it("lists exactly the six REQUIRED_TRANSACTION_FIELDS, by template header, in column order", () => {
    expect(REQUIRED_TRANSACTION_FIELDS).toHaveLength(6);
    expect(STRICT_REQUIRED_COLUMN_HEADERS).toEqual(["Potential ID", "Month", "Year", "Customer Name", "Lab Name", "Cloud Provider"]);
    expect([...STRICT_REQUIRED_COLUMN_HEADERS].sort()).toEqual(REQUIRED_TRANSACTION_FIELDS.map(headerOf).sort());
  });

  it("the instruction line and the on-screen banner both say every one of them is required", () => {
    const requiredLine = STRICT_TEMPLATE_INSTRUCTIONS.find((l) => l.startsWith("Required in every row:"))!;
    expect(requiredLine).toBeDefined();
    for (const f of REQUIRED_TRANSACTION_FIELDS) {
      expect(requiredLine).toContain(headerOf(f));
      expect(STRICT_TEMPLATE_BANNER).toContain(headerOf(f));
    }
    expect(STRICT_TEMPLATE_BANNER).toContain(requiredLine);
  });

  it("lab type is not listed as required (it is derived from the provider)", () => {
    const requiredLine = STRICT_TEMPLATE_INSTRUCTIONS.find((l) => l.startsWith("Required in every row:"))!;
    expect(requiredLine.toLowerCase()).not.toMatch(/lab type|cloud type|lab_type/);
    expect(STRICT_COLUMNS.some((c) => (c.field as string) === "lab_type")).toBe(false);
    expect((REQUIRED_TRANSACTION_FIELDS as readonly string[]).includes("lab_type")).toBe(false);
  });

  it("every required header is a column of the downloadable template", () => {
    const header = parseCsvText(strictTemplateCsv()).header;
    for (const h of STRICT_REQUIRED_COLUMN_HEADERS) expect(header).toContain(h);
  });
});

describe("lenient mode is unchanged", () => {
  it("template column `required` flags: only Cloud Provider is true (SCRUM-129), the rest false", () => {
    expect(Object.fromEntries(STRICT_COLUMNS.map((c) => [c.field, c.required]))).toEqual({
      potential_id: false,
      month: false,
      year: false,
      customer_name: false,
      lab_name: false,
      line_of_business: false,
      start_date: false,
      end_date: false,
      total_users: false,
      input_cost: false,
      selling_cost: false,
      cloud_provider: true,
      cloud_type: false,
      system_config: false,
    });
    expect(PROPOSED_RULES.columns).toBe(STRICT_COLUMNS);
    expect(PROPOSED_RULES).toMatchObject({ blankCost: "null", provider: "required-blocking", blankPotentialId: "null" });
  });

  it("lenient validation still accepts blank identity cells; the approval tier blocks them", () => {
    const header = STRICT_COLUMNS.filter((c) => !c.optional).map((c) => c.header);
    const csv = [header.join(","), ",,,,,VILT,2026-03-01,2026-03-31,5,10,20,AWS"].join("\n");
    const sheet = parseCsvText(csv);
    const lenient = validateStrict(sheet.header, sheet.rows);
    expect(lenient.rowErrors).toEqual([]);
    const approval = validateStrict(sheet.header, sheet.rows, { tiers: "approval" });
    const blocked = new Set(approval.rowErrors.map((e) => e.header));
    for (const f of REQUIRED_TRANSACTION_FIELDS.filter((f) => f !== "cloud_provider")) expect(blocked.has(headerOf(f))).toBe(true);
  });

  it("lenient validation still blocks a blank Cloud Provider (unchanged SCRUM-129 rule)", () => {
    const header = STRICT_COLUMNS.filter((c) => !c.optional).map((c) => c.header);
    const sheet = parseCsvText([header.join(","), "SYN-1,3,2026,Acme Test Co,Lab A,VILT,2026-03-01,2026-03-31,5,10,20,"].join("\n"));
    expect(validateStrict(sheet.header, sheet.rows).rowErrors.map((e) => e.header)).toContain("Cloud Provider");
  });
});
