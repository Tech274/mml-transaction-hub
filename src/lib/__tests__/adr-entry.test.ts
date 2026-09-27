import { describe, it, expect } from "vitest";
import { adrEntrySchema, fieldErrors, toTransactionInsert, PRIVATE_CLOUD_PROVIDER } from "../adr-entry";

// Synthetic entry only.
const valid = {
  potential_id: "POT-TEST-001",
  month: 9,
  year: 2026,
  customer_id: "11111111-1111-4111-8111-111111111111",
  customer_name: "Synthetic Customer",
  lab_name: "Synthetic Lab",
  lab_type: "public_cloud" as const,
  cloud_provider: "AWS",
  system_config: "",
  line_of_business: "VILT",
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  total_users: 25,
  input_cost: 1000,
  selling_cost: 1500,
};
const errs = (v: unknown) => {
  const r = adrEntrySchema.safeParse(v);
  return r.success ? {} : fieldErrors(r.error);
};

describe("ADR entry rules (shared by form and server)", () => {
  it("accepts a valid public-cloud entry, including string numbers from inputs", () => {
    expect(errs(valid)).toEqual({});
    expect(errs({ ...valid, month: "9", total_users: "25", input_cost: "1000.50", selling_cost: "1500" })).toEqual({});
  });
  it("accepts a valid private-cloud entry", () => {
    expect(errs({ ...valid, lab_type: "private_cloud", cloud_provider: PRIVATE_CLOUD_PROVIDER, system_config: "16GB 4vCPUs" })).toEqual({});
  });
  it.each([
    ["potential_id", { potential_id: "  " }],
    ["potential_id", { potential_id: "x".repeat(51) }],
    ["month", { month: 13 }],
    ["year", { year: 1999 }],
    ["customer_id", { customer_id: "not-a-uuid" }],
    ["lab_name", { lab_name: "" }],
    ["cloud_provider", { cloud_provider: "Oracle" }],
    ["system_config", { lab_type: "private_cloud", system_config: "" }],
    ["line_of_business", { line_of_business: "Retail" }],
    ["start_date", { start_date: "01/09/2026" }],
    ["start_date", { start_date: "2026-02-30" }],
    ["end_date", { end_date: "2026-08-31" }],
    ["total_users", { total_users: 0 }],
    ["total_users", { total_users: 2.5 }],
    ["input_cost", { input_cost: -1 }],
    ["selling_cost", { selling_cost: "abc" }],
    ["selling_cost", { selling_cost: 2_000_000_000, input_cost: 0 }],
    ["input_cost", { input_cost: 2000, selling_cost: 1500 }],
  ])("rejects bad %s", (field, patch) => {
    expect(Object.keys(errs({ ...valid, ...patch }))).toContain(field);
  });
  it("messages are written for users", () => {
    expect(errs({ ...valid, end_date: "2026-08-31" }).end_date).toBe("End date cannot be before start date");
    expect(errs({ ...valid, cloud_provider: "" }).cloud_provider).toBe("Required for Public Cloud (AWS, Azure, GCP)");
  });
});

describe("toTransactionInsert", () => {
  it("public cloud keeps the provider and drops system_config; created_by is the caller", () => {
    const row = toTransactionInsert(adrEntrySchema.parse(valid), "u1");
    expect(row).toMatchObject({ cloud_provider: "AWS", system_config: null, repository_type: "public_cloud", created_by: "u1" });
  });
  it("private cloud always uses the MakeMyLabs provider", () => {
    const row = toTransactionInsert(adrEntrySchema.parse({ ...valid, lab_type: "private_cloud", cloud_provider: "AWS", system_config: "8GB 2vCPUs" }), "u1");
    expect(row).toMatchObject({ cloud_provider: PRIVATE_CLOUD_PROVIDER, system_config: "8GB 2vCPUs" });
  });
});
