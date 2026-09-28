import { describe, it, expect } from "vitest";
import { validateStrict, matchHeaders, parseStrictNumber, toCents } from "../validate";
import { PROPOSED_RULES, STRICT_TEMPLATE_STATUS, columnLetter } from "../template";
import { HEADER, row } from "./fixtures";

describe("template status", () => {
  it("records the 28 Sep lenient rules", () => {
    expect(STRICT_TEMPLATE_STATUS).toBe("LENIENT_2026-09-28");
  });
  it("column letters", () => {
    expect([0, 11, 25, 26, 27].map(columnLetter)).toEqual(["A", "L", "Z", "AA", "AB"]);
  });
});

describe("headers", () => {
  it("match exactly, ignoring only case and surrounding spaces", () => {
    const h = HEADER.map((x, i) => (i === 0 ? "  potential id " : x.toUpperCase()));
    expect(matchHeaders(h).warnings).toEqual([]);
  });
  it("a missing column is stored blank, warned, and does not block", () => {
    const r = validateStrict(HEADER.slice(0, 11), [row(2)]);
    expect(r.ok).toBe(true);
    expect(r.records[0].cloud_provider).toBeNull();
    expect(r.warnings).toEqual([
      expect.objectContaining({ header: "Cloud Provider", message: 'Column "Cloud Provider" is missing. Those cells are stored blank.' }),
    ]);
    expect(commitReady(r)).toBe(true);
  });
  it("unknown extra columns are ignored, listed, and do not block", () => {
    const header = [...HEADER, "S.No", "Remarks"];
    const cells = [...row(2).cells, "4", "bring laptop"];
    const r = validateStrict(header, [{ line: 2, cells }]);
    expect(r.ok).toBe(true);
    expect(r.records).toHaveLength(1);
    expect(r.records[0].cloud_provider).toBe("AWS");
    expect(r.records[0].potential_id).toBe("PID-TEST-001");
    expect(r.warnings.map((w) => w.message)).toEqual([
      'Unknown column "S.No" is ignored.',
      'Unknown column "Remarks" is ignored.',
    ]);
  });
  it("a blank header cell is ignored and does not block", () => {
    const header = ["Potential ID", "", ...HEADER.slice(2)];
    const r = validateStrict(header, [row(2)]);
    expect(r.ok).toBe(true);
    expect(r.records[0].month).toBeNull();
    expect(r.records[0].year).toBe(2026);
    expect(r.records[0].lab_name).toBe("Synthetic Lab A");
    expect(r.warnings.map((w) => w.message)).toEqual(['Column "Month" is missing. Those cells are stored blank.']);
  });
  it("an explicitly ignored column produces no warning", () => {
    const r = validateStrict([...HEADER, "S.No"], [row(2)], { rules: { ...PROPOSED_RULES, ignoredHeaders: ["s.no"] } });
    expect(r.warnings.filter((w) => w.header === "S.No")).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("near-miss headers are NOT fuzzy-matched, and the file still commits", () => {
    const h = [...HEADER];
    h[10] = "Selling Price";
    const r = validateStrict(h, [row(2, { "Selling Cost": 1500.5 })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].selling_cost_cents).toBeNull();
    expect(r.warnings.some((w) => w.message === 'Unknown column "Selling Price" is ignored.')).toBe(true);
    expect(r.warnings.some((w) => w.message === 'Column "Selling Cost" is missing. Those cells are stored blank.')).toBe(true);
  });
  it("a duplicate header uses the first occurrence and warns", () => {
    const header = [...HEADER, "Month"];
    const cells = [...row(2).cells, 9];
    const r = validateStrict(header, [{ line: 2, cells }]);
    expect(r.ok).toBe(true);
    expect(r.records[0].month).toBe(3);
    expect(r.warnings).toEqual([
      expect.objectContaining({
        column: "M",
        message: 'Duplicate header "Month" (also in column B). The first occurrence is used.',
      }),
    ]);
  });
});

function commitReady(r: { ok: boolean }) {
  return r.ok;
}

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
  it("a row with an unstorable month still yields exactly one record and does not block", () => {
    const r = validateStrict(HEADER, [row(2, { Month: 13 })]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0].month).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.column === "B" && w.value === "13")).toBe(true);
    expect(r.rowErrors).toEqual([]);
  });
  it("exact duplicate rows are kept and flagged as a warning", () => {
    const r = validateStrict(HEADER, [row(2), row(3)]);
    expect(r.records).toHaveLength(2);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([{ line: 3, column: null, header: null, value: "", message: "Exact duplicate of line 2" }]);
  });
});

describe("blanks and unstorable cells (28 Sep)", () => {
  it("a row with every field blank except one is one record, and the blanks stay null", () => {
    const r = validateStrict(HEADER, [row(2, {
      "Potential ID": "",
      Month: null,
      Year: "",
      "Customer Name": "Only Customer",
      "Lab Name": "",
      "Line of Business": "",
      "Start Date": null,
      "End Date": "",
      "Total Users": "",
      "Input Cost": null,
      "Selling Cost": "",
      "Cloud Provider": "  ",
    })]);
    expect(r.ok).toBe(true);
    expect(r.rowErrors).toEqual([]);
    expect(r.records).toHaveLength(1);
    expect(r.records[0].customer_name).toBe("Only Customer");
    expect(r.records[0].potential_id).toBeNull();
    expect(r.records[0].input_cost_cents).toBeNull();
    expect(r.records[0].selling_cost_cents).toBeNull();
    expect(r.records[0].cloud_provider).toBeNull();
    expect(r.records[0].total_users).toBeNull();
  });
  it("blank costs are NULL, never 0", () => {
    const r = validateStrict(HEADER, [row(2, { "Input Cost": "", "Selling Cost": null })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].input_cost_cents).toBeNull();
    expect(r.records[0].selling_cost_cents).toBeNull();
    expect(r.warnings.filter((w) => w.header === "Input Cost" || w.header === "Selling Cost")).toEqual([]);
  });
  it("input cost above selling cost is a note and does not block", () => {
    const r = validateStrict(HEADER, [row(2, { "Input Cost": 2000, "Selling Cost": 1500 })]);
    expect(r.ok).toBe(true);
    expect(r.rowErrors).toEqual([]);
    expect(r.records[0].input_cost_cents).toBe(200000);
    expect(r.records[0].selling_cost_cents).toBe(150000);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/higher than Selling Cost/);
    expect(r.warnings[0]).toMatchObject({ line: 2, column: "J", value: "2000.00" });
  });
  it("an unparseable number is NULL plus a warning and does not block", () => {
    const r = validateStrict(HEADER, [row(2, { "Total Users": "ten", "Input Cost": "₹100" })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].total_users).toBeNull();
    expect(r.records[0].input_cost_cents).toBeNull();
    const users = r.warnings.find((w) => w.header === "Total Users");
    const cost = r.warnings.find((w) => w.header === "Input Cost");
    expect(users).toMatchObject({ line: 2, column: "I", value: "ten" });
    expect(cost).toMatchObject({ line: 2, column: "J", value: "₹100" });
  });
  it("an unknown provider does not block; the cell is NULL and the original value is on the warning", () => {
    const r = validateStrict(HEADER, [row(2, { "Cloud Provider": "OpenAI" })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].cloud_provider).toBeNull();
    expect(r.warnings[0]).toMatchObject({ line: 2, column: "L", header: "Cloud Provider", value: "OpenAI" });
  });
  it("DD/MM text dates are stored blank with a warning", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "07/02/2026" })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].start_date).toBeNull();
    expect(r.warnings[0].column).toBe("G");
    expect(r.warnings[0].value).toBe("07/02/2026");
  });
  it("YYYY-MM-DD text and Excel date cells are accepted as-is", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "2026-02-07", "End Date": { kind: "date", iso: "2026-07-02" } })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].start_date).toBe("2026-02-07");
    expect(r.records[0].end_date).toBe("2026-07-02");
  });
  it("impossible calendar dates are stored blank", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "2026-02-30" })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].start_date).toBeNull();
  });
  it("end before start is a note and both dates are kept", () => {
    const r = validateStrict(HEADER, [row(2, { "Start Date": "2026-03-10", "End Date": "2026-03-01" })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].start_date).toBe("2026-03-10");
    expect(r.records[0].end_date).toBe("2026-03-01");
    expect(r.warnings[0].message).toMatch(/before Start Date/);
  });
  it("month/year are not clamped; out of range is stored blank", () => {
    const r = validateStrict(HEADER, [row(2, { Month: 0, Year: 1999 })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].month).toBeNull();
    expect(r.records[0].year).toBeNull();
    expect(r.warnings).toHaveLength(2);
  });
  it("provider and line of business must match exactly; near misses are stored blank", () => {
    const provider = validateStrict(HEADER, [row(2, { "Cloud Provider": "aws" })]);
    expect(provider.ok).toBe(true);
    expect(provider.records[0].cloud_provider).toBeNull();
    const lob = validateStrict(HEADER, [row(2, { "Line of Business": "vilt" })]);
    expect(lob.records[0].line_of_business).toBeNull();
    expect(lob.ok).toBe(true);
  });
  it("blank Potential ID is NULL, not an error", () => {
    const r = validateStrict(HEADER, [row(2, { "Potential ID": "  " })]);
    expect(r.ok).toBe(true);
    expect(r.records[0].potential_id).toBeNull();
    expect(r.rowErrors).toEqual([]);
  });
  it("combined Potential IDs are kept verbatim", () => {
    const r = validateStrict(HEADER, [row(2, { "Potential ID": "PF-X/87/88/89" })]);
    expect(r.records[0].potential_id).toBe("PF-X/87/88/89");
  });
  it("customer name is stored exactly as typed (trim only)", () => {
    const r = validateStrict(HEADER, [row(2, { "Customer Name": "  ACME test CO " })]);
    expect(r.records[0].customer_name).toBe("ACME test CO");
  });
  it("short rows: missing trailing cells are blank, never 0", () => {
    const r = validateStrict(HEADER, [{ line: 2, cells: row(2).cells.slice(0, 9) }]);
    expect(r.ok).toBe(true);
    expect(r.rowErrors).toEqual([]);
    expect(r.records[0].input_cost_cents).toBeNull();
    expect(r.records[0].selling_cost_cents).toBeNull();
    expect(r.records[0].cloud_provider).toBeNull();
  });
  it("N non-blank rows in produce N records out", () => {
    const blank = { line: 4, cells: HEADER.map(() => null) };
    const rows = [row(2), blank, row(3, { "Lab Name": "Other" }), row(5, { "Potential ID": "PID-TEST-9" })];
    const r = validateStrict(HEADER, rows);
    expect(r.records).toHaveLength(3);
    expect(r.summary.blankRowsIgnored).toBe(1);
    expect(r.summary.rowsToImport).toBe(3);
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
