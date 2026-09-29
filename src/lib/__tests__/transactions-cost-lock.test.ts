import { describe, expect, it } from "vitest";
import { adrEditSchema, toTransactionUpdate } from "@/lib/adr-entry";
import { adminCostCorrectionSchema, stripLockedCostFields } from "@/lib/transactions.functions";

describe("transaction cost lock safeguards", () => {
  const blankEdit = {
    potential_id: "",
    month: "",
    year: "",
    customer_id: "",
    customer_name: "",
    lab_name: "",
    lab_type: "public_cloud" as const,
    cloud_provider: "",
    system_config: "",
    line_of_business: "",
    start_date: "",
    end_date: "",
    total_users: "",
    input_cost: "",
    selling_cost: "",
  };

  it("strips locked costs from standard edit updates", () => {
    const parsed = adrEditSchema.parse({
      ...blankEdit,
      potential_id: "POT-LOCK-001",
      input_cost: "2200",
      selling_cost: "3000",
    });
    const patch = toTransactionUpdate(parsed);
    const unlockedPatch = stripLockedCostFields(patch);

    expect(patch.input_cost).toBe(2200);
    expect(patch.selling_cost).toBe(3000);
    expect("input_cost" in unlockedPatch).toBe(false);
    expect("selling_cost" in unlockedPatch).toBe(false);
    expect(unlockedPatch.potential_id).toBe("POT-LOCK-001");
  });

  it("requires an explicit reason for admin cost correction", () => {
    const bad = adminCostCorrectionSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      input_cost: 900,
      selling_cost: 1400,
      reason: " ",
    });
    expect(bad.success).toBe(false);

    const good = adminCostCorrectionSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      input_cost: 900,
      selling_cost: 1400,
      reason: "Adjusted against corrected vendor invoice.",
    });
    expect(good.success).toBe(true);
  });
});
