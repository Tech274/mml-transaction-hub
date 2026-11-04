import { describe, expect, it } from "vitest";
import { correctionsSummary, fieldHeader, incompleteLine, originalText, repeatLine, ruleLabel, splitLine, statusVariant } from "../approval-view";
import { HEALER_RULES } from "../healer";

describe("approval view helpers", () => {
  it("labels every Healer rule", () => {
    for (const r of HEALER_RULES) expect(ruleLabel(r)).not.toBe(r);
    expect(ruleLabel("unknown.rule")).toBe("unknown.rule");
  });

  it("formats the counts lines", () => {
    expect(splitLine({ row_count: 342, private_count: 336, public_count: 6 })).toBe("342 rows · 336 Private cloud · 6 Public cloud");
    expect(incompleteLine({ incomplete_count: 248, row_count: 342 })).toMatch(/^248 of 342 rows are Incomplete/);
    expect(incompleteLine({ incomplete_count: 0, row_count: 342 })).toBeNull();
  });

  it("repeat-file warning", () => {
    expect(repeatLine({ repeat_of: null })).toBeNull();
    const U = "00000000-0000-4000-8000-0000000c0003";
    expect(
      repeatLine({
        repeat_of: { source: "batch", at: "2026-09-01T06:00:00Z", id: "1a2b3c4d-0000-4000-8000-000000000001" },
        uploaded_by: U,
        repeat_acknowledged_by: U,
        repeat_acknowledged_at: "2026-10-06T07:05:00Z",
      }),
    ).toBe("Repeat of batch 1a2b3c4d (imported 2026-09-01), acknowledged by the uploader on 2026-10-06 07:05. Approving imports its rows again.");
    // QC S4: with the uploader's name (approve dialog and banner): who, when, which earlier batch.
    expect(
      repeatLine(
        {
          repeat_of: { source: "batch", at: "2026-09-01T06:00:00Z", id: "1a2b3c4d-0000-4000-8000-000000000001" },
          uploaded_by: U,
          repeat_acknowledged_by: U,
          repeat_acknowledged_at: "2026-10-06T07:05:00Z",
        },
        { [U]: "Synthetic Uploader" },
      ),
    ).toBe(
      "Repeat of batch 1a2b3c4d (imported 2026-09-01), acknowledged by the uploader (Synthetic Uploader) on 2026-10-06 07:05. Approving imports its rows again.",
    );
    expect(repeatLine({ repeat_of: { source: "stage", id: "y" } })).toMatch(/^Repeat of an upload already waiting for sign-off \(y\)\. Not acknowledged by the uploader\./);
  });

  it("fields, blanks, status, summary order", () => {
    expect(fieldHeader("customer_name")).toBe("Customer Name");
    expect(fieldHeader("x")).toBe("x");
    expect(originalText(null)).toBe("(blank)");
    expect(originalText(" ")).toBe("(blank)");
    expect(originalText("15-03-2026")).toBe("15-03-2026");
    expect(statusVariant("rejected")).toBe("destructive");
    expect(correctionsSummary([{ rule: "customer.match_existing" }, { rule: "date.reorder_to_iso" }, { rule: "date.reorder_to_iso" }])).toEqual([
      { rule: "date.reorder_to_iso", label: "Date to YYYY-MM-DD", count: 2 },
      { rule: "customer.match_existing", label: "Customer name matched to existing record", count: 1 },
    ]);
  });
});
