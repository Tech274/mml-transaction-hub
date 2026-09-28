import { describe, it, expect } from "vitest";
import { canCommit, formatCents, needsAcknowledgement, pendingApprovals, strictTemplateCsv, strictTemplateFilename } from "../ui-state";
import { parseCsvText } from "../parse";
import { matchHeaders } from "../validate";
import type { PreviewResult } from "../service";

const preview = (over: Partial<PreviewResult> = {}): PreviewResult => ({
  templateVersion: "2.0.0-proposed",
  templateStatus: "PENDING_VIVEK_CONFIRMATION",
  fileSha256: "a".repeat(64),
  sheetName: null,
  summary: { rowsInFile: 1, blankRowsIgnored: 0, rowsToImport: 1, errorCount: 0, warningCount: 0, totalSellingCents: 100, totalInputCents: 50, distinctCustomers: 1 },
  headerErrors: [],
  rowErrors: [],
  warnings: [],
  customers: { newCustomers: ["Beta Test Ltd"], matchedWithDifferentSpelling: [], inFileVariants: [] },
  alreadyImported: false,
  blockers: [],
  ...over,
});

describe("strict import screen state", () => {
  it("needs every new customer approved", () => {
    expect(pendingApprovals(preview(), new Set())).toEqual(["Beta Test Ltd"]);
    expect(canCommit(preview(), new Set(), false)).toBe(false);
    expect(canCommit(preview(), new Set(["Beta Test Ltd"]), false)).toBe(true);
  });
  it("notes about cost do not block; customer name variants still need acknowledgement", () => {
    const notes = preview({ warnings: [{ line: 2, column: "J", header: "Input Cost", value: "2.00", message: "Input Cost is higher than Selling Cost" }] });
    expect(needsAcknowledgement(notes)).toBe(false);
    expect(canCommit(notes, new Set(["Beta Test Ltd"]), false)).toBe(true);
    const variants = preview({ customers: { newCustomers: ["Beta Test Ltd"], matchedWithDifferentSpelling: [{ fileName: "beta", existingName: "Beta Test Ltd", lines: [2] }], inFileVariants: [] } });
    expect(needsAcknowledgement(variants)).toBe(true);
    expect(canCommit(variants, new Set(["Beta Test Ltd"]), false)).toBe(false);
    expect(canCommit(variants, new Set(["Beta Test Ltd"]), true)).toBe(true);
  });
  it("any server blocker disables commit", () => {
    expect(canCommit(preview({ blockers: ["x"] }), new Set(["Beta Test Ltd"]), true)).toBe(false);
  });
  it("formats money exactly from cents", () => {
    expect(formatCents(0)).toBe("₹0.00");
    expect(formatCents(150050)).toBe("₹1,500.50");
    expect(formatCents(1234567890)).toBe("₹1,23,45,678.90");
  });
  it("template CSV has exactly the strict headers and parses back cleanly", () => {
    const sheet = parseCsvText(strictTemplateCsv());
    expect(matchHeaders(sheet.header).errors).toEqual([]);
    expect(sheet.rows).toEqual([]);
    expect(strictTemplateFilename()).toBe("strict-import-template-2.0.0-proposed.csv");
  });
});
