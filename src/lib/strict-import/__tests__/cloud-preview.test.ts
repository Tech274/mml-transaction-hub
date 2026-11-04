import { describe, expect, it } from "vitest";
import {
  BULK_UPLOAD_HELP_TEXT,
  cloudPreviewSummary,
  cloudPreviewSummaryLine,
  importFootnote,
  importedTitle,
} from "../cloud-preview";

describe("Bulk Upload copy (spec §129.3)", () => {
  const c = { privateCount: 336, publicCount: 6 };
  it("summary lines", () => {
    expect(cloudPreviewSummary(c)).toBe("336 Private cloud · 6 Public cloud");
    expect(cloudPreviewSummaryLine(c, 0)).toBe("336 Private cloud · 6 Public cloud · 0 errors");
    expect(cloudPreviewSummaryLine(c, 1)).toBe("336 Private cloud · 6 Public cloud · 1 error");
  });
  it("footnote and imported title", () => {
    expect(importFootnote(c)).toBe(
      "All or nothing: 336 Private cloud and 6 Public cloud rows will be saved.",
    );
    expect(importedTitle(342, c)).toBe("342 rows imported: 336 Private cloud · 6 Public cloud");
    expect(importedTitle(5, null)).toBe("5 rows imported");
  });
  it("help text states the rule and no public default", () => {
    expect(BULK_UPLOAD_HELP_TEXT).toContain("Private cloud: MakeMyLabs, Oracle or SAP");
    expect(BULK_UPLOAD_HELP_TEXT).toContain("Public cloud: AWS, Azure or GCP");
    expect(BULK_UPLOAD_HELP_TEXT).toContain("Nothing is saved as public by default");
  });
});
