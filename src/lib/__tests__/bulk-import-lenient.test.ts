import { describe, it, expect } from "vitest";
import { parseLenientBulkRow, parseLenientBulkRows } from "../bulk-import-lenient";

const full = {
  potential_id: "PID-SYN-1",
  month: "3",
  year: "2026",
  customer_name: "Synthetic Customer",
  lab_name: "Lab A",
  line_of_business: "VILT",
  start_date: "2026-03-01",
  end_date: "2026-03-31",
  total_users: "5",
  input_cost: "100.00",
  selling_cost: "250.00",
  cloud_provider: "AWS",
};

describe("legacy bulk import is lenient (production path)", () => {
  it("a row with every field blank except one becomes one record", () => {
    const raw = Object.fromEntries(Object.keys(full).map((k) => [k, ""]));
    raw.lab_name = "Only Lab";
    const r = parseLenientBulkRow(raw, "public_cloud", 4);
    expect(r.blank).toBe(false);
    expect(r.values).toMatchObject({
      lab_name: "Only Lab",
      potential_id: null,
      customer_name: null,
      month: null,
      year: null,
      start_date: null,
      end_date: null,
      total_users: null,
      input_cost: null,
      selling_cost: null,
      cloud_provider: null,
    });
    expect(r.warnings).toEqual([]);
  });

  it("blank costs are null, not 0", () => {
    const r = parseLenientBulkRow({ ...full, input_cost: "", selling_cost: "   " }, "public_cloud", 2);
    expect(r.values?.input_cost).toBeNull();
    expect(r.values?.selling_cost).toBeNull();
    expect(r.warnings).toEqual([]);
  });

  it("input cost above selling cost is accepted as a note", () => {
    const r = parseLenientBulkRow({ ...full, input_cost: "500", selling_cost: "100" }, "public_cloud", 2);
    expect(r.values?.input_cost).toBe(500);
    expect(r.values?.selling_cost).toBe(100);
    expect(r.notes.map((n) => n.message).join(" ")).toMatch(/allowed/);
    expect(r.warnings).toEqual([]);
  });

  it("an unparseable number is null plus a warning and does not drop the row", () => {
    const r = parseLenientBulkRow({ ...full, total_users: "ten", input_cost: "₹100" }, "public_cloud", 8);
    expect(r.blank).toBe(false);
    expect(r.values?.total_users).toBeNull();
    expect(r.values?.input_cost).toBeNull();
    expect(r.values?.selling_cost).toBe(250);
    expect(r.warnings).toEqual([
      expect.objectContaining({ line: 8, column: "total_users", value: "ten" }),
      expect.objectContaining({ line: 8, column: "input_cost", value: "₹100" }),
    ]);
  });

  it("an unknown provider does not block", () => {
    const r = parseLenientBulkRow({ ...full, cloud_provider: "OpenAI" }, "public_cloud", 3);
    expect(r.values?.cloud_provider).toBeNull();
    expect(r.warnings[0]).toMatchObject({ line: 3, column: "cloud_provider", value: "OpenAI" });
  });

  it("N non-blank rows in give N records out; fully blank rows are counted", () => {
    const blank = Object.fromEntries(Object.keys(full).map((k) => [k, ""]));
    const batch = parseLenientBulkRows(
      [full, blank, { ...full, potential_id: "PID-SYN-1", lab_name: "Lab B" }, { ...full, potential_id: "PID-SYN-2" }],
      "public_cloud",
    );
    expect(batch.blankRowsIgnored).toBe(1);
    expect(batch.rowsToImport).toBe(3);
    expect(batch.rows.filter((r) => !r.blank).map((r) => r.values?.potential_id)).toEqual(["PID-SYN-1", "PID-SYN-1", "PID-SYN-2"]);
  });

  it("identical non-blank rows are not merged: N rows give N records", () => {
    const blank = Object.fromEntries(Object.keys(full).map((k) => [k, ""]));
    const batch = parseLenientBulkRows([full, full, blank, full], "public_cloud");
    const kept = batch.rows.filter((r) => !r.blank);
    expect(batch.blankRowsIgnored).toBe(1);
    expect(batch.rowsToImport).toBe(3);
    expect(kept).toHaveLength(3);
    expect(kept.every((r) => r.values?.lab_name === full.lab_name && r.values?.potential_id === full.potential_id)).toBe(true);
  });
});
