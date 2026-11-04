import { describe, expect, it } from "vitest";
import { labTypeLabel, labTypeSplit } from "@/lib/lab-type-label";

describe("lab catalog lab type (D4)", () => {
  it("labels", () => {
    expect(labTypeLabel("private_cloud")).toBe("Private cloud");
    expect(labTypeLabel("public_cloud")).toBe("Public cloud");
    expect(labTypeLabel("hybrid")).toBe("Hybrid");
    expect(labTypeLabel("")).toBe("Not set");
  });
  it("Hybrid stays out of both Private and Public totals", () => {
    const types = ["private_cloud", "hybrid", "public_cloud", "hybrid", null];
    const priv = types.filter((t) => labTypeSplit(t) === "private_cloud").length;
    const pub = types.filter((t) => labTypeSplit(t) === "public_cloud").length;
    expect([priv, pub]).toEqual([1, 1]);
    expect(labTypeSplit("hybrid")).toBeNull();
  });
});
