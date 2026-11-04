import { describe, expect, it } from "vitest";
import { checkProviderRow } from "@/lib/cloud-provider";
import {
  COMPLETENESS_SELECT_COLUMNS,
  REQUIRED_TRANSACTION_FIELDS,
  incompleteReasons,
  isIncompleteTransaction,
  isTransactionComplete,
  splitByCompleteness,
  transactionKind,
} from "@/lib/transaction-completeness";

// Synthetic rows only: no real customer names or amounts.
function row(overrides: Record<string, unknown> = {}) {
  return {
    lab_type: "private_cloud",
    repository_type: "private_cloud",
    potential_id: "SYN-0001",
    month: 9,
    year: 2026,
    customer_name: "Synthetic Customer A",
    lab_name: "Synthetic Lab",
    line_of_business: "VILT",
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    total_users: 10,
    input_cost: 100,
    selling_cost: 150,
    cloud_provider: "MakeMyLabs Private Cloud",
    system_config: "8GB 2vCPUs",
    ...overrides,
  };
}

describe("SCRUM-129: no public fallback in completeness", () => {
  it("transactionKind returns null when the type is unknown", () => {
    expect(transactionKind({})).toBeNull();
    expect(transactionKind({ lab_type: "hybrid" })).toBeNull();
    expect(transactionKind({ repository_type: "public_cloud" })).toBe("public_cloud");
  });

  it("SCRUM-131: kind no longer decides completeness (lab_type is NOT NULL in the DB); the shared rule does", () => {
    const r = row({ lab_type: null, repository_type: null });
    expect(isTransactionComplete(r)).toBe(!isIncompleteTransaction(r));
  });
});

describe("SCRUM-131: isIncompleteTransaction", () => {
  it("a fully filled row with prices > 0 is Complete", () => {
    expect(isIncompleteTransaction(row())).toBe(false);
    expect(incompleteReasons(row())).toEqual([]);
    expect(
      isIncompleteTransaction(
        row({
          lab_type: "public_cloud",
          repository_type: "public_cloud",
          cloud_provider: "Azure",
          system_config: null,
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ["selling_cost", 0],
    ["selling_cost", null],
    ["input_cost", 0],
    ["input_cost", -5],
    ["input_cost", undefined],
    ["selling_cost", ""],
  ])("%s = %j (0 placeholder / missing price) is Incomplete", (field, value) => {
    const r = row({ [field]: value });
    expect(isIncompleteTransaction(r)).toBe(true);
    expect(incompleteReasons(r)).toContain("price_missing_or_zero");
  });

  it("required fields are the spec 129.4a starting set, mapped to columns", () => {
    expect(REQUIRED_TRANSACTION_FIELDS).toEqual([
      "potential_id",
      "month",
      "year",
      "customer_name",
      "lab_name",
      "cloud_provider",
    ]);
  });

  it.each(["potential_id", "month", "year", "customer_name", "lab_name", "cloud_provider"])(
    "a blank required field %s is Incomplete",
    (field) => {
      expect(
        incompleteReasons(row({ [field]: field === "month" || field === "year" ? null : "  " })),
      ).toEqual(["required_blank"]);
    },
  );

  it.each(["system_config", "line_of_business", "start_date", "end_date", "total_users"])(
    "a non-critical blank %s does NOT make a row Incomplete (D8)",
    (field) => {
      expect(isIncompleteTransaction(row({ [field]: null }))).toBe(false);
    },
  );

  it("a Bulk Upload private row without System Config is Complete when priced and filled", () => {
    const r = row({ system_config: null });
    expect(isIncompleteTransaction(r)).toBe(false);
    expect(isTransactionComplete(r)).toBe(true); // SCRUM-131: isTransactionComplete = !isIncompleteTransaction
  });

  it("both reasons can apply at once", () => {
    expect(incompleteReasons(row({ selling_cost: 0, customer_name: "" }))).toEqual([
      "price_missing_or_zero",
      "required_blank",
    ]);
  });

  it("flips to Complete once the price is edited (derived, not stored)", () => {
    const r = row({ selling_cost: 0 });
    expect(isIncompleteTransaction(r)).toBe(true);
    r.selling_cost = 200;
    expect(isIncompleteTransaction(r)).toBe(false);
  });

  it("select columns cover what the rule reads", () => {
    for (const c of [
      "potential_id",
      "input_cost",
      "selling_cost",
      "cloud_provider",
      "total_users",
    ]) {
      expect(COMPLETENESS_SELECT_COLUMNS).toContain(c);
    }
  });
});

describe("SCRUM-131 + SCRUM-129: Chief's 6 Oct file shape (synthetic)", () => {
  // 334 MakeMyLabs Private Cloud + 2 Oracle + 6 Azure = 342 rows. Synthetic values:
  // 20 private rows and 1 Azure row carry the 0-price placeholder.
  const providers = [
    ...Array.from({ length: 334 }, () => "MakeMyLabs Private Cloud"),
    ...Array.from({ length: 2 }, () => "Oracle"),
    ...Array.from({ length: 6 }, () => "Azure"),
  ];
  const rows = providers.map((p, i) => {
    const check = checkProviderRow(p);
    if (!check.ok) throw new Error("fixture provider must be valid");
    const zeroPrice =
      (check.cloudType === "private_cloud" && i < 20) || (p === "Azure" && i === 336);
    return row({
      potential_id: `SYN-${String(i + 1).padStart(4, "0")}`,
      lab_type: check.cloudType,
      repository_type: check.cloudType,
      cloud_provider: check.provider,
      system_config: check.cloudType === "private_cloud" ? "8GB 2vCPUs" : null,
      total_users: 2,
      input_cost: 10,
      selling_cost: zeroPrice ? 0 : 20,
    });
  });

  it("splits private and public views into Complete / Incomplete with totals", () => {
    const priv = rows.filter((r) => r.repository_type === "private_cloud");
    const pub = rows.filter((r) => r.repository_type === "public_cloud");
    expect(priv).toHaveLength(336);
    expect(pub).toHaveLength(6);

    const p = splitByCompleteness(priv);
    expect(p.complete).toEqual({ count: 316, users: 632, inputCost: 3160, sellingCost: 6320 });
    expect(p.incomplete).toEqual({ count: 20, users: 40, inputCost: 200, sellingCost: 0 });

    const q = splitByCompleteness(pub);
    expect(q.complete.count).toBe(5);
    expect(q.incomplete.count).toBe(1);
    expect(q.complete.count + q.incomplete.count).toBe(6);
  });

  it("uses the view's own input-cost measure when given", () => {
    const s = splitByCompleteness(rows.slice(0, 2), () => 7);
    expect(s.incomplete.inputCost).toBe(14);
  });
});
