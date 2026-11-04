import { describe, expect, it } from "vitest";
import { incompleteNote, incompleteNoteProps, incompleteNoteTitle } from "@/lib/kpi-note";
import { fmtCurrencyCompact, fmtSigned } from "@/lib/format";

describe("SCRUM-131 KPI note", () => {
  it("is hidden when there are no incomplete rows", () => {
    expect(incompleteNote(0, 0)).toBeNull();
    expect(incompleteNoteTitle(0, 500)).toBeNull();
    expect(incompleteNoteProps(0, 1)).toEqual({ note: null, noteTitle: null });
  });
  it("short form '12 incomplete · ₹1.2L', long form as title", () => {
    expect(incompleteNote(12, 120000)).toBe("12 incomplete · ₹1.2L");
    expect(incompleteNoteTitle(12, 120000)).toBe("Includes 12 incomplete rows · ₹1,20,000");
    expect(incompleteNoteTitle(1, 0)).toBe("Includes 1 incomplete row · ₹0");
    expect(incompleteNote(3, null)).toBe("3 incomplete");
    expect(incompleteNoteTitle(3, null)).toBe("Includes 3 incomplete rows");
  });
});

describe("fmtCurrencyCompact (Indian units)", () => {
  it.each([
    [0, "₹0"],
    [999, "₹999"],
    [85000, "₹85K"],
    [120000, "₹1.2L"],
    [100000, "₹1L"],
    [34000000, "₹3.4Cr"],
    [-250000, "−₹2.5L"],
    [null, "—"],
  ])("%j -> %s", (n, out) => {
    expect(fmtCurrencyCompact(n as number | null)).toBe(out);
  });
});

describe("fmtSigned", () => {
  it("uses + and a proper minus sign", () => {
    expect(fmtSigned(12)).toBe("+12");
    expect(fmtSigned(-12)).toBe("−12");
    expect(fmtSigned(0)).toBe("0");
  });
});
