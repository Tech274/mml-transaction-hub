// SCRUM-131: the Healer (pure TS) and the approval-tier validation. Synthetic data only.
import { describe, expect, it } from "vitest";
import { synthetic131Csv, synthetic131Customers, synthetic131Rows, SYNTHETIC_NAME_VARIANTS } from "@/test-support/scrum131-fixture";
import { isIncompleteTransaction } from "@/lib/transaction-completeness";
import { HEALER_RULES, HEALER_VERSION, customerMatcher, detectDateOrder, healDate, healSheet } from "../healer";
import { parseCsvText } from "../parse";
import { reviewImport } from "../review";
import { HEADER, row } from "./fixtures";

const CUSTOMERS = [{ customer_name: "Acme Test Co" }, { customer_name: "Beta Synthetic LLC" }];
const review = (rows: ReturnType<typeof row>[], customers = CUSTOMERS) => reviewImport(HEADER, rows, { customers });
const codes = (r: ReturnType<typeof review>, tier: "blockers" | "warnings") => r.report[tier].map((i) => [i.line, i.header, i.code ?? i.message]);

describe("H-F1 synthetic acceptance file (same shape as the owner's 342-row file)", () => {
  const sheet = parseCsvText(synthetic131Csv());
  const rv = reviewImport(sheet.header, sheet.rows, { customers: synthetic131Customers() });

  it("0 blocked rows, can submit", () => {
    expect(rv.summary.blockedRows).toBe(0);
    expect(rv.report.blockers).toEqual([]);
    expect(rv.canSubmit).toBe(true);
  });

  it("all 342 rows get both dates: 684 date fixes, file order DMY from 425 day-first cells", () => {
    expect(rv.summary.rows).toBe(342);
    expect(rv.report.fixedByRule["date.reorder_to_iso"]).toBe(684);
    expect(rv.report.dateOrder).toMatchObject({
      order: "DMY",
      dayFirstCells: 425,
      monthFirstCells: 0,
      used: "DMY",
      source: "file",
      needsChoice: false,
    });
    expect(rv.validation.records.filter((r) => r.start_date && r.end_date)).toHaveLength(342);
    expect(rv.stagedRows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.healed.start_date)) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.healed.end_date)))).toBe(true);
  });

  it("336 private / 6 public, batch kind mixed", () => {
    expect(rv.summary).toMatchObject({ privateRows: 336, publicRows: 6, batchKind: "mixed" });
  });

  it("11 customer-name fixes, each to the existing spelling; no new customers", () => {
    const fixes = rv.report.fixed.filter((c) => c.rule === "customer.match_existing");
    expect(fixes).toHaveLength(11);
    const expected = new Map(SYNTHETIC_NAME_VARIANTS.map(([from, to]) => [from, to]));
    for (const f of fixes) expect(f.healed).toBe(expected.get(f.original ?? ""));
    expect(rv.report.newCustomers).toEqual([]);
  });

  it("provider fixes: 0 (the canonical 'MakeMyLabs Private Cloud' is already canonical); no other rule fires", () => {
    expect(rv.report.fixedByRule).toEqual({
      "date.reorder_to_iso": 684,
      "customer.match_existing": 11,
      "provider.alias": 0,
      "price.blank_to_zero": 0,
      "price.invalid_to_zero": 0,
      "text.trim": 0,
    });
    expect(rv.summary.correctionCount).toBe(695);
  });

  it("248 Incomplete rows by Peter's isIncompleteTransaction (prices of 0), counted and kept, not excluded", () => {
    expect(rv.summary).toMatchObject({ incompleteRows: 248, completeRows: 94 });
    expect(rv.stagedRows).toHaveLength(342);
    expect(rv.stagedRows.filter((r) => r.is_incomplete)).toHaveLength(248);
    for (const r of rv.stagedRows) expect(r.is_incomplete).toBe(isIncompleteTransaction(r.healed));
    expect(rv.stagedRows.every((r) => r.healed.input_cost !== null && r.healed.selling_cost !== null)).toBe(true);
  });

  it("is idempotent (healing the healed file changes nothing) and deterministic", () => {
    const again = healSheet(rv.healer.header, rv.healer.rows, { customers: synthetic131Customers() });
    expect(again.corrections).toEqual([]);
    const twice = reviewImport(sheet.header, sheet.rows, { customers: synthetic131Customers() });
    expect(JSON.stringify(twice.report)).toBe(JSON.stringify(rv.report));
    expect(JSON.stringify(twice.stagedRows)).toBe(JSON.stringify(rv.stagedRows));
  });

  it("does not modify the parsed input", () => {
    const fresh = parseCsvText(synthetic131Csv());
    expect(sheet.rows).toEqual(fresh.rows);
  });

  it("the fixture really has the advertised shape", () => {
    const rows = synthetic131Rows();
    expect(rows.filter((r) => r.input === 0 && r.selling === 0)).toHaveLength(131);
    expect(rows.filter((r) => r.input === 0 && r.selling > 0)).toHaveLength(113);
    expect(rows.filter((r) => r.selling === 0 && r.input > 0)).toHaveLength(4);
  });
});

describe("H1-H11 Healer fixes and flags (one small file each)", () => {
  it("H1 SAP is private; OCI maps to Oracle and is shown as a Healer fix", () => {
    const r = review([row(2, { "Cloud Provider": "SAP" }), row(3, { "Cloud Provider": "OCI" })]);
    expect(r.canSubmit).toBe(true);
    expect(r.stagedRows.map((x) => [x.healed.cloud_provider, x.healed.lab_type])).toEqual([
      ["SAP", "private_cloud"],
      ["Oracle", "private_cloud"],
    ]);
    expect(r.report.fixed.filter((c) => c.rule === "provider.alias").map((c) => [c.line, c.original, c.healed])).toEqual([[3, "OCI", "Oracle"]]);
  });

  it("H2 unknown and blank providers are blockers with line numbers", () => {
    const r = review([row(2, { "Cloud Provider": "OpenAI" }), row(3, { "Cloud Provider": "" }), row(4)]);
    expect(r.canSubmit).toBe(false);
    expect(r.report.blockers.map((b) => [b.line, b.header])).toEqual([
      [2, "Cloud Provider"],
      [3, "Cloud Provider"],
    ]);
    expect(r.stagedRows).toEqual([]);
  });

  it("H3 an ambiguous date (03-04-2026 with nothing proving the order) is a blocker", () => {
    const r = review([row(2, { "Start Date": "03-04-2026", "End Date": "05-04-2026" })]);
    expect(r.canSubmit).toBe(false);
    expect(codes(r, "blockers")).toEqual([
      [2, "Start Date", "date.ambiguous"],
      [2, "End Date", "date.ambiguous"],
    ]);
  });

  it("H3b once one cell proves day-first, 03-04-2026 is 3 April; month-first proof gives 4 March", () => {
    const dmy = review([row(2, { "Start Date": "03-04-2026", "End Date": "25-04-2026" })]);
    expect(dmy.stagedRows[0].healed).toMatchObject({ start_date: "2026-04-03", end_date: "2026-04-25" });
    const mdy = review([row(2, { "Start Date": "03-04-2026", "End Date": "04-25-2026" })]);
    expect(mdy.stagedRows[0].healed).toMatchObject({ start_date: "2026-03-04", end_date: "2026-04-25" });
    const mixed = review([row(2, { "Start Date": "25-04-2026", "End Date": "04-25-2026" }), row(3, { "Start Date": "03-04-2026" })]);
    expect(mixed.report.dateOrder.order).toBe("MIXED");
    // SCRUM-131 date fix: a file with both orders is inconsistent, so every DD-MM-style date in it is blocked.
    expect(codes(mixed, "blockers")).toEqual([
      [2, "Start Date", "date.mixed_order"],
      [2, "End Date", "date.mixed_order"],
      [3, "Start Date", "date.mixed_order"],
    ]);
  });

  it("H4 DD/MM/YYYY and DD.MM.YYYY are healed too; ISO and Excel dates are left alone", () => {
    const r = review([row(2, { "Start Date": "15/03/2026", "End Date": "31.03.2026" }), row(3, { "Start Date": "2026-03-01" })]);
    expect(r.stagedRows.map((x) => [x.healed.start_date, x.healed.end_date])).toEqual([
      ["2026-03-15", "2026-03-31"],
      ["2026-03-01", "2026-03-31"],
    ]);
    expect(r.report.fixedByRule["date.reorder_to_iso"]).toBe(2);
  });

  it("H5 an unparseable date (2026/31/05) and an impossible one (31-02-2026) are blockers", () => {
    const r = review([row(2, { "Start Date": "2026/31/05" }), row(3, { "Start Date": "31-02-2026" })]);
    expect(codes(r, "blockers")).toEqual([
      [2, "Start Date", "date.unparseable"],
      [3, "Start Date", "date.impossible"],
    ]);
  });

  it("H6 missing identity fields (Potential ID, Customer Name, Lab Name, Month, Year) are blockers", () => {
    const r = review([
      row(2, { "Potential ID": "" }),
      row(3, { "Customer Name": " " }),
      row(4, { "Lab Name": null }),
      row(5, { Month: null }),
      row(6, { Year: "" }),
    ]);
    expect(r.canSubmit).toBe(false);
    expect(r.report.blockers.map((b) => [b.line, b.header])).toEqual([
      [2, "Potential ID"],
      [3, "Customer Name"],
      [4, "Lab Name"],
      [5, "Month"],
      [6, "Year"],
    ]);
  });

  it("H7 blank prices are stored as 0 (never NULL) with a correction keeping the blank, and a warning; the row is Incomplete", () => {
    const r = review([row(2, { "Input Cost": null, "Selling Cost": "" })]);
    expect(r.canSubmit).toBe(true);
    expect(r.stagedRows[0].healed).toMatchObject({ input_cost: "0.00", selling_cost: "0.00" });
    expect(r.report.fixed.filter((c) => c.rule === "price.blank_to_zero").map((c) => [c.header, c.original, c.healed])).toEqual([
      ["Input Cost", null, "0"],
      ["Selling Cost", null, "0"],
    ]);
    expect(r.report.warnings.filter((w) => w.line === 2 && /Cost/.test(w.header ?? "")).length).toBeGreaterThanOrEqual(2);
    expect(r.stagedRows[0].is_incomplete).toBe(true);
    expect(r.summary.incompleteRows).toBe(1);
  });

  it("H7b a negative or non-numeric price becomes 0 (rule price.invalid_to_zero, original kept); a typed 0 is a warning only", () => {
    const r = review([row(2, { "Input Cost": "-5", "Selling Cost": "abc" }), row(3, { "Input Cost": 0 })]);
    expect(r.canSubmit).toBe(true);
    expect(r.report.fixed.filter((c) => c.rule === "price.invalid_to_zero").map((c) => [c.line, c.original])).toEqual([
      [2, "-5"],
      [2, "abc"],
    ]);
    expect(r.report.fixed.filter((c) => c.line === 3)).toEqual([]);
    expect(r.report.warnings.some((w) => w.line === 3 && w.header === "Input Cost")).toBe(true);
    expect(r.stagedRows.map((x) => x.is_incomplete)).toEqual([true, true]);
  });

  it("H8 blank dates, Line of Business and Total Users are warnings, not blockers (non-critical blanks are not Incomplete)", () => {
    const r = review([row(2, { "Start Date": null, "End Date": null, "Line of Business": "", "Total Users": null })]);
    expect(r.canSubmit).toBe(true);
    expect(r.report.blockers).toEqual([]);
    expect(r.report.warnings.map((w) => w.header).sort()).toEqual(["End Date", "Line of Business", "Start Date", "Total Users"]);
    expect(r.stagedRows[0].is_incomplete).toBe(false);
  });

  it("H9 customer names: casing/spacing matched to the existing record; a new name is a note; two candidates block", () => {
    const r = review([row(2, { "Customer Name": "ACME TEST CO" }), row(3, { "Customer Name": "Acme  Test  Co" }), row(4, { "Customer Name": "Gamma New Ltd" })]);
    expect(r.report.fixed.filter((c) => c.rule === "customer.match_existing").map((c) => [c.line, c.healed])).toEqual([
      [2, "Acme Test Co"],
      [3, "Acme Test Co"],
    ]);
    expect(r.report.newCustomers).toEqual(["Gamma New Ltd"]);
    expect(r.report.warnings.some((w) => w.line === 4 && w.code === "customer.new")).toBe(true);
    expect(r.canSubmit).toBe(true);
    const twins = review([row(2, { "Customer Name": "acme test co" })], [{ customer_name: "ACME Test Co" }, { customer_name: "Acme Test CO" }]);
    expect(codes(twins, "blockers")).toEqual([[2, "Customer Name", "customer.multiple_matches"]]);
  });

  it("H10 text.trim only for inside-value spacing in Potential ID / Lab Name / System Config", () => {
    const r = review([row(2, { "Lab Name": "Synthetic   Lab  A", "Potential ID": "PID-TEST-001" })]);
    expect(r.report.fixed.filter((c) => c.rule === "text.trim").map((c) => [c.header, c.healed])).toEqual([["Lab Name", "Synthetic Lab A"]]);
  });

  it("H11 rule table and version are pinned (changing them is a reviewed change)", () => {
    expect(HEALER_VERSION).toBe("1.1.0");
    expect([...HEALER_RULES]).toEqual(["date.reorder_to_iso", "customer.match_existing", "provider.alias", "price.blank_to_zero", "price.invalid_to_zero", "text.trim"]);
  });
});

describe("Healer building blocks", () => {
  it("detectDateOrder counts proving cells only", () => {
    expect(detectDateOrder(["13-01-2026", "01-02-2026", "2026-01-01", null])).toEqual({ order: "DMY", dayFirstCells: 1, monthFirstCells: 0 });
    expect(detectDateOrder(["01-13-2026"])).toMatchObject({ order: "MDY" });
    expect(detectDateOrder(["01-02-2026"])).toMatchObject({ order: "UNKNOWN" });
  });

  it("healDate: equal day and month need no order; blanks are blank", () => {
    expect(healDate("04-04-2026", "UNKNOWN")).toEqual({ kind: "ok", iso: "2026-04-04", changed: true });
    expect(healDate("  ", "DMY")).toEqual({ kind: "blank" });
    expect(healDate("2026-02-30", "DMY")).toMatchObject({ kind: "flag", code: "date.impossible" });
  });

  it("customerMatcher: exact, normalized, space-insensitive", () => {
    const m = customerMatcher([{ customer_name: "Acme Test Co" }]);
    expect(m("Acme Test Co")).toEqual({ kind: "exact", name: "Acme Test Co" });
    expect(m("acme test co")).toMatchObject({ kind: "matched", via: "normalized" });
    expect(m("AcmeTest Co")).toMatchObject({ kind: "matched", via: "space-insensitive" });
    expect(m("Other")).toEqual({ kind: "new", name: "Other" });
  });
});

describe("required fields line up (Peter's REQUIRED_TRANSACTION_FIELDS)", () => {
  it("import blockers = REQUIRED_TRANSACTION_FIELDS (identity fields + Cloud Provider), and every one is a template column", async () => {
    const { REQUIRED_TRANSACTION_FIELDS } = await import("@/lib/transaction-completeness");
    const { IDENTITY_FIELDS, REQUIRED_HEADER_FIELDS } = await import("../validate");
    const { PROPOSED_RULES } = await import("../template");
    expect([...REQUIRED_HEADER_FIELDS]).toEqual([...REQUIRED_TRANSACTION_FIELDS]);
    expect([...IDENTITY_FIELDS, "cloud_provider"].sort()).toEqual([...REQUIRED_TRANSACTION_FIELDS].sort());
    const templateFields = PROPOSED_RULES.columns.filter((c) => !c.optional).map((c) => c.field);
    for (const f of REQUIRED_TRANSACTION_FIELDS) expect(templateFields).toContain(f);
  });
});
