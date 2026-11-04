// SCRUM-128 plan §7.3 (C4): compact INR in Indian units and the signed-number helper.
import { describe, expect, it } from "vitest";
import { fmtCurrencyCompact, fmtSigned } from "@/lib/format";

describe("fmtCurrencyCompact", () => {
  it.each<[number | string | null | undefined, string]>([
    [0, "₹0"],
    [850, "₹850"],
    [85_000, "₹85K"],
    [1_20_000, "₹1.2L"],
    [1_00_000, "₹1L"],
    [7_43_100, "₹7.4L"],
    [3_40_00_000, "₹3.4Cr"],
    [-1_20_000, "−₹1.2L"],
    ["85000", "₹85K"],
    [null, "—"],
    [undefined, "—"],
    ["", "—"],
    [Number.NaN, "—"],
  ])("%s → %s", (n, out) => {
    expect(fmtCurrencyCompact(n)).toBe(out);
  });

  it("negatives use U+2212, not a hyphen", () => {
    expect(fmtCurrencyCompact(-85_000)).toBe("\u2212₹85K");
    expect(fmtCurrencyCompact(-85_000)).not.toContain("-");
  });
});

describe("fmtSigned", () => {
  it("+ for a rise, U+2212 for a fall, plain 0", () => {
    expect(fmtSigned(17)).toBe("+17");
    expect(fmtSigned(-17)).toBe("\u221217");
    expect(fmtSigned(0)).toBe("0");
  });
});
