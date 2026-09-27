import { describe, it, expect } from "vitest";
import { validateStrict, matchHeaders, parseStrictNumber, toCents } from "../validate";
import { PROPOSED_RULES, STRICT_TEMPLATE_STATUS, columnLetter } from "../template";
import { HEADER, row } from "./fixtures";

describe("template status", () => {
  it("is clearly marked as pending Vivek's confirmation", () => {
    expect(STRICT_TEMPLATE_STATUS).toBe("PENDING_VIVEK_CONFIRMATION");
  });
  it("column letters", () => {
    expect([0, 11, 25, 26, 27].map(columnLetter)).toEqual(["A", "L", "Z", "AA", "AB"]);
  });
});

describe("headers", () => {
  it("match exactly, ignoring only case and surrounding spaces", () => {
    const h = HEADER.map((x, i) => (i === 0 ? "  potential id " : x.toUpperCase()));
    expect(matchHeaders(h).errors).toEqual([]);
  });
  it("missing column is a blocking error", () => {
    const r = validateStrict(HEADER.slice(0, 11), [row(2)]);
    expect(r.ok).toBe(false);
    expect(r.headerErrors.map((e) => e.message)).toContain('Missing column "Cloud Provider"');
  });
  it("unknown extra column is a blocking error", () => {
    const r = validateStrict([...HEADER, "Notes"], [row(2)]);
    expect(r.headerErrors).toEqual([{ column: "M", header: "Notes", message: 'Unknown column "Notes". It is not in the template.' }]);
  });
  it("an explicitly ignored column is allowed", () => {
    const r = validateStrict([...HEADER, "S.No"], [row(2)], { rules: { ...PROPOSED_RULES, ignoredHeaders: ["s.no"] } });
    expect(r.headerErrors).toEqual([]);
  });
  it("near-miss headers are NOT fuzzy-matched", () => {
    const h = [...HEADER];
    h[10] = "Selling Price";
    const r = validateStrict(h, [row(2)]);
    expect(r.ok).toBe(false);
  });
  it("duplicate header is an error", () => {
    const h = [...HEADER, "Month"];
    expect(matchHeaders(h).errors.some((e) => e.message.startsWith('Duplicate header "Month"'))).toBe(true);
  });
});

describe("one row in = one row out", () => {
  it("repeated Potential IDs produce one record each (no merging)", () => {
    const rows = [
      row(2, { "Lab Name": "Lab 1" }),
      row(3, { "Lab Name": "Lab 2" }),
      row(4, { "Lab Name": "Lab 1", "Month": 4, "Start Date": { kind: "date", iso: "2026-04-01" }, "End Date": { kind: "date", iso: "2026-04-30" } }),
    ];
    const r = validateStrict(HEADER, rows);
    expect(r.ok).toBe(true);
    expect(r.records).toHaveLength(3);
    expect(r.records.map((x) => x.line)).toEqual([2, 3, 4]);
    expect(r.summary.rowsToImport).toBe(3);
  });
  it("fully blank rows are counted, not imported", () => {
    const blank = { line: 3, cells: HEADER.map(() => null) };
    const r = validateStrict(HEADER, [row(2), blank, row(4, { "Lab Name": "Other" })]);
    expect(r.records).toHaveLength(2);
    expect(r.summary.blankRowsIgnored).toBe(1);
    expect(r.summary.rowsInFile).toBe(3);
  });
  it("a row with errors still yields exactly one record (and blocks commit)", () => {
    const r = validateStrict(HEADER, [row(2, { Month: 13 })]);
    expect(r.records).toHaveLength(1);
    expect(r.ok).toBe(false);
  });
  it("exact duplicate rows are kept and flagged as a warning", () => {
    const r = validateStrict(HEADER, [row(2), row(3)]);
    expect(r.records).toHaveLength(2);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([{ line: 3, column: null, header: null, value: "", message: "Exact duplicate of line 2" }]);
  });
});

describe("no guessing", () => {
  it("blank Selling Cost is an error, never 0 (proposed default)", () => {
    const r = validateStrict(HEADER, [row(2, { "Selling Cost": "" })]);
    expect(r.rowErrors).toEqual([{ line: 2, column: "K", header: "Selling Cost", value: "", message: "Required value is blank" }]);
    expect(r.records[0].selling_cost_cents).toBeNull();
  });
  it("blank cost can be stored as NULL only if the rule is switched", () => {
    const r = validateStrict(HEADER, [row(2, { "Input Cost": null })], { rules: { ...PROPOSED_RULES, blankCost: "null" } });
    expect(r.ok).toBe(true);
    expect(r.records[0].input_cost_cents).toBeNull();
  });
  it("DD/MM text dates are rejected", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "07/02/2026" })]);
    expect(r.rowErrors[0].column).toBe("G");
    expect(r.rowErrors[0].message).toMatch(/YYYY-MM-DD/);
  });
  it("YYYY-MM-DD text and Excel date cells are accepted as-is", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "2026-02-07", "End Date": { kind: "date", iso: "2026-07-02" } })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].start_date).toBe("2026-02-07");
    expect(r.records[0].end_date).toBe("2026-07-02");
  });
  it("impossible calendar dates are rejected", () => {
    expect(validateStrict(HEADER, [row(2, { "Start Date": "2026-02-30" })]).ok).toBe(false);
  });
  it("end before start is an error", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "2026-03-10", "End Date": "2026-03-01" })]);
    expect(r.rowErrors[0].message).toBe("End Date is before Start Date");
  });
  it("month/year are not clamped", () => {
    const r = validateStrict(HEADER, [row(2, { Month: 0, Year: 1999 })]);
    expect(r.rowErrors).toHaveLength(2);
  });
  it("providers must match exactly; OpenAI rejected pending decision", () => {
    expect(validateStrict(HEADER, [row(2, { "Cloud Provider": "aws" })]).ok).toBe(false);
    expect(validateStrict(HEADER, [row(2, { "Cloud Provider": "OpenAI" })]).ok).toBe(false);
  });
  it("line of business must match exactly", () => {
    expect(validateStrict(HEADER, [row(2, { "Line of Business": "vilt" })]).ok).toBe(false);
  });
  it("blank Potential ID is an error (proposed default)", () => {
    const r = validateStrict(HEADER, [row(2, { "Potential ID": "  " })]);
    expect(r.rowErrors[0]).toMatchObject({ column: "A", header: "Potential ID" });
  });
  it("combined Potential IDs are kept verbatim", () => {
    const r = validateStrict(HEADER, [row(2, { "Potential ID": "PF-X/87/88/89" })]);
    expect(r.records[0].potential_id).toBe("PF-X/87/88/89");
  });
  it("customer name is stored exactly as typed (trim only)", () => {
    const r = validateStrict(HEADER, [row(2, { "Customer Name": "  ACME test CO " })]);
    expect(r.records[0].customer_name).toBe("ACME test CO");
  });
  it("input above selling is a warning by default, an error if the rule says so", () => {
    const over = row(2, { "Input Cost": 2000, "Selling Cost": 1500 });
    const warn = validateStrict(HEADER, [over]);
    expect(warn.ok).toBe(true);
    expect(warn.warnings[0].message).toBe("Input Cost is higher than Selling Cost");
    const strict = validateStrict(HEADER, [over], { rules: { ...PROPOSED_RULES, inputAboveSelling: "error" } });
    expect(strict.ok).toBe(false);
  });
  it("short rows: missing trailing cells are blank (and therefore errors), never 0", () => {
    const r = validateStrict(HEADER, [{ line: 2, cells: row(2).cells.slice(0, 9) }]);
    expect(r.rowErrors.map((e) => e.header)).toEqual(["Input Cost", "Selling Cost", "Cloud Provider"]);
  });
});

describe("numbers", () => {
  it("accepts numeric cells and strict numeric text", () => {
    expect(parseStrictNumber(12)).toBe(12);
    expect(parseStrictNumber("1,234.50")).toBe(1234.5);
    expect(parseStrictNumber(" 1234 ")).toBe(1234);
  });
  it("rejects anything else", () => {
    for (const bad of ["12abc", "1.234,50", "₹100", "1,23,456", "", "12 34", ".5"]) {
      expect(parseStrictNumber(bad)).toBeNull();
    }
  });
  it("money to cents, rejecting more than 2 decimals", () => {
    expect(toCents(1500.5)).toBe(150050);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(10.005)).toBeNull();
  });
  it("totals are summed in cents", () => {
    const r = validateStrict(HEADER, [row(2, { "Selling Cost": 0.1 }), row(3, { "Selling Cost": 0.2, "Lab Name": "B" })]);
    expect(r.summary.totalSellingCents).toBe(30);
    expect(r.summary.distinctCustomers).toBe(1);
  });
});
