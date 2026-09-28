import { describe, it, expect } from "vitest";
import { buildRpcRows, centsToDecimalString, commitBlockers, duplicateFileMessage, planCustomers, MAX_ROWS_PER_BATCH } from "../commit-plan";
import { validateStrict, type StrictRecord } from "../validate";
import { isStrictImportEnabled } from "../flag";
import { HEADER, row } from "./fixtures";

const rec = (line: number, customer: string): StrictRecord => ({
  line, potential_id: "PID-TEST-1", month: 3, year: 2026, customer_name: customer, lab_name: "Synthetic Lab",
  line_of_business: "VILT", start_date: "2026-03-01", end_date: "2026-03-31", total_users: 5,
  input_cost_cents: 100000, selling_cost_cents: 150050, cloud_provider: "AWS",
});

describe("feature flag", () => {
  it("is OFF by default and only ON for the exact string 'true'", () => {
    expect(isStrictImportEnabled({})).toBe(false);
    expect(isStrictImportEnabled({ STRICT_IMPORT_ENABLED: "1" })).toBe(false);
    expect(isStrictImportEnabled({ STRICT_IMPORT_ENABLED: "TRUE" })).toBe(false);
    expect(isStrictImportEnabled({ STRICT_IMPORT_ENABLED: "true" })).toBe(true);
  });
});

describe("centsToDecimalString", () => {
  it("formats exactly without floating point", () => {
    expect(centsToDecimalString(0)).toBe("0.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(150050)).toBe("1500.50");
    expect(centsToDecimalString(123456789012)).toBe("1234567890.12");
    expect(centsToDecimalString(-250)).toBe("-2.50");
  });
  it("rejects non-integers", () => {
    expect(() => centsToDecimalString(1.5)).toThrow();
  });
});

describe("planCustomers", () => {
  it("unknown customers are new; first spelling is kept exactly as typed", () => {
    const p = planCustomers([rec(2, "Beta Test Ltd"), rec(3, "Acme Test Co")], []);
    expect(p.newCustomers).toEqual(["Acme Test Co", "Beta Test Ltd"]);
  });
  it("existing customers are reused, never renamed; different spelling is flagged", () => {
    const p = planCustomers([rec(2, "acme  test co"), rec(3, "Acme Test Co")], [{ customer_name: "Acme Test Co", normalized_name: "acme test co" }]);
    expect(p.newCustomers).toEqual([]);
    expect(p.matchedWithDifferentSpelling).toEqual([{ fileName: "acme  test co", existingName: "Acme Test Co", lines: [2] }]);
    expect(p.inFileVariants).toHaveLength(1);
  });
  it("in-file variants of a new customer are flagged and create only one customer", () => {
    const p = planCustomers([rec(2, "Gamma Test"), rec(3, "GAMMA test"), rec(4, "Gamma Test")], []);
    expect(p.newCustomers).toEqual(["Gamma Test"]);
    expect(p.inFileVariants).toEqual([{ normalized: "gamma test", spellings: ["Gamma Test", "GAMMA test"], lines: [2, 3, 4] }]);
  });
});

describe("buildRpcRows", () => {
  it("one record in = one row out, with source line and exact money strings", () => {
    const rows = buildRpcRows([rec(2, "A"), rec(2 + 1, "A"), rec(7, "B")]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.source_line)).toEqual([2, 3, 7]);
    expect(rows[0]).toMatchObject({ potential_id: "PID-TEST-1", input_cost: "1000.00", selling_cost: "1500.50" });
  });
  it("a blank cost is JSON null, never 0", () => {
    const rows = buildRpcRows([{ ...rec(9, "A"), input_cost_cents: null, selling_cost_cents: null, potential_id: null }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].input_cost).toBeNull();
    expect(rows[0].selling_cost).toBeNull();
    expect(rows[0].potential_id).toBeNull();
    expect(JSON.stringify(rows[0])).not.toContain('"input_cost":"0');
  });
});

describe("commitBlockers", () => {
  const okValidation = validateStrict(HEADER, [row(2), row(3, { "Customer Name": "Beta Test Ltd" })]);
  const open = { priorImport: null, importAnyway: false };

  it("allows a clean file without approving new customers", () => {
    expect(planCustomers(okValidation.records, []).newCustomers.length).toBeGreaterThan(0);
    expect(commitBlockers(okValidation, open)).toEqual([]);
  });
  it("blocks a file with an unknown column, and does not block an unstorable cell", () => {
    const bad = validateStrict([...HEADER, "Notes"], [row(2)]);
    expect(commitBlockers(bad, open)[0]).toMatch(/1 error/);
    const soft = validateStrict(HEADER, [row(2, { Month: "nope", "Cloud Provider": "OpenAI" })]);
    expect(commitBlockers(soft, open)).toEqual([]);
  });
  it("asks for Import anyway on a repeated file, and allows it once confirmed", () => {
    const prior = { id: "batch-9", importedOn: "2026-09-15" };
    const msg = duplicateFileMessage(prior);
    expect(msg).toBe("This exact file was already imported on 2026-09-15 (batch batch-9)");
    expect(commitBlockers(okValidation, { priorImport: prior, importAnyway: false })).toEqual([msg]);
    expect(commitBlockers(okValidation, { priorImport: prior, importAnyway: true })).toEqual([]);
    expect(commitBlockers(okValidation, open)).toEqual([]);
  });
  it("selling below cost does not block", () => {
    const warn = validateStrict(HEADER, [row(2, { "Input Cost": 2000, "Selling Cost": 1000 })]);
    expect(warn.warnings.length).toBeGreaterThan(0);
    expect(commitBlockers(warn, open)).toEqual([]);
  });
  it("blocks files over the batch limit", () => {
    const big = { ...okValidation, summary: { ...okValidation.summary, rowsToImport: MAX_ROWS_PER_BATCH + 1 } };
    expect(commitBlockers(big, open).join(" ")).toMatch(/Too many rows/);
  });
});
