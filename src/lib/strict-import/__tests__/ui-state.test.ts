import { describe, it, expect } from "vitest";
import { canCommit, duplicateFileMessage, formatCents, needsAcknowledgement, strictTemplateCsv, strictTemplateFilename } from "../ui-state";
import { parseCsvText } from "../parse";
import { matchHeaders } from "../validate";
import type { PreviewResult } from "../service";

const preview = (over: Partial<PreviewResult> = {}): PreviewResult => ({
  templateVersion: "2.0.0-proposed",
  templateStatus: "PENDING_VIVEK_CONFIRMATION",
  fileSha256: "a".repeat(64),
  sheetName: null,
  summary: { rowsInFile: 1, blankRowsIgnored: 0, rowsToImport: 1, errorCount: 0, warningCount: 0, totalSellingCents: 100, totalInputCents: 50, distinctCustomers: 1 },
  rowErrors: [],
  warnings: [],
  customers: { newCustomers: ["Beta Test Ltd"], matchedWithDifferentSpelling: [], inFileVariants: [] },
  priorImport: null,
  blockers: [],
  ...over,
});

describe("strict import screen state", () => {
  it("new customers do not block commit", () => {
    expect(canCommit(preview(), false)).toBe(true);
  });
  it("notes and customer name variants do not block", () => {
    const notes = preview({ warnings: [{ line: 2, column: "J", header: "Input Cost", value: "2.00", message: "Input Cost is higher than Selling Cost" }] });
    expect(needsAcknowledgement(notes)).toBe(false);
    expect(canCommit(notes, false)).toBe(true);
    const variants = preview({ customers: { newCustomers: ["Beta Test Ltd"], matchedWithDifferentSpelling: [{ fileName: "beta", existingName: "Beta Test Ltd", lines: [2] }], inFileVariants: [] } });
    expect(needsAcknowledgement(variants)).toBe(false);
    expect(canCommit(variants, false)).toBe(true);
  });
  it("a repeated file needs one Import anyway confirmation", () => {
    const prior = { id: "batch-1", importedOn: "2026-09-01" };
    const p = preview({ priorImport: prior });
    expect(duplicateFileMessage(prior)).toBe("This exact file was already imported on 2026-09-01 (batch batch-1)");
    expect(canCommit(p, false)).toBe(false);
    expect(canCommit(p, true)).toBe(true);
  });
  it("any server blocker disables commit", () => {
    expect(canCommit(preview({ blockers: ["x"] }), true)).toBe(false);
  });
  it("formats money exactly from cents", () => {
    expect(formatCents(0)).toBe("₹0.00");
    expect(formatCents(150050)).toBe("₹1,500.50");
    expect(formatCents(1234567890)).toBe("₹1,23,45,678.90");
  });
  it("template CSV has exactly the strict headers and parses back cleanly", () => {
    const sheet = parseCsvText(strictTemplateCsv());
    expect(matchHeaders(sheet.header).warnings).toEqual([]);
    expect(sheet.rows).toEqual([]);
    expect(strictTemplateFilename()).toBe("strict-import-template-2.0.0-proposed.csv");
  });
});
