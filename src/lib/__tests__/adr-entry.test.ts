import { describe, it, expect } from "vitest";
import { adrEditSchema, adrEntrySchema, dateOrderNote, fieldErrors, marginNote, toTransactionInsert, toTransactionUpdate, PRIVATE_CLOUD_PROVIDER } from "../adr-entry";

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

const blankEntry = {
  potential_id: "",
  month: "",
  year: "",
  customer_id: "",
  customer_name: "",
  lab_name: "",
  lab_type: "public_cloud" as const,
  // SCRUM-129: Cloud Provider is the one required business field (it decides the cloud type).
  cloud_provider: "Azure",
  system_config: "",
  line_of_business: "",
  start_date: "",
  end_date: "",
  total_users: "",
  input_cost: "",
  selling_cost: "",
};

describe("ADR entry rules (shared by form and server)", () => {
  it("accepts a valid public-cloud entry, including string numbers from inputs", () => {
    expect(errs(valid)).toEqual({});
    expect(errs({ ...valid, month: "9", total_users: "25", input_cost: "1000.50", selling_cost: "1500" })).toEqual({});
  });
  it("accepts a valid private-cloud entry", () => {
    expect(errs({ ...valid, lab_type: "private_cloud", cloud_provider: PRIVATE_CLOUD_PROVIDER, system_config: "16GB 4vCPUs" })).toEqual({});
  });
  it("saves a new entry with only one field filled; the rest stay null", () => {
    const parsed = adrEntrySchema.parse({ ...blankEntry, lab_name: "Only Lab" });
    const row = toTransactionInsert(parsed, "u1");
    expect(row.lab_name).toBe("Only Lab");
    expect(row.potential_id).toBeNull();
    expect(row.customer_name).toBeNull();
    expect(row.customer_id).toBeNull();
    expect(row.month).toBeNull();
    expect(row.year).toBeNull();
    expect(row.start_date).toBeNull();
    expect(row.end_date).toBeNull();
    expect(row.input_cost).toBeNull();
    expect(row.selling_cost).toBeNull();
    expect(row.total_users).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/"input_cost":0/);
    expect(JSON.stringify(row)).not.toMatch(/"selling_cost":0/);
  });
  it("saves an end date before the start date and only notes it", () => {
    const parsed = adrEntrySchema.parse({ ...valid, start_date: "2026-09-30", end_date: "2026-08-31" });
    const row = toTransactionInsert(parsed, "u1");
    expect(row.start_date).toBe("2026-09-30");
    expect(row.end_date).toBe("2026-08-31");
    expect(dateOrderNote(row.start_date, row.end_date)).toMatch(/allowed/);
    expect(errs({ ...valid, end_date: "2026-08-31" })).toEqual({});
  });
  it.each([
    ["potential_id", { potential_id: "x".repeat(201) }],
    ["month", { month: 13 }],
    ["year", { year: 1999 }],
    ["customer_id", { customer_id: "not-a-uuid" }],
    ["line_of_business", { line_of_business: "Retail" }],
    ["start_date", { start_date: "01/09/2026" }],
    ["start_date", { start_date: "2026-02-30" }],
    ["total_users", { total_users: 0 }],
    ["total_users", { total_users: 2.5 }],
    ["input_cost", { input_cost: -1 }],
    ["selling_cost", { selling_cost: "abc" }],
    ["selling_cost", { selling_cost: 2_000_000_000, input_cost: 0 }],
  ])("rejects a value that cannot be stored in %s", (field, patch) => {
    expect(Object.keys(errs({ ...valid, ...patch }))).toContain(field);
  });
  it("accepts selling below cost on a new entry", () => {
    expect(errs({ ...valid, input_cost: 2000, selling_cost: 1500 })).toEqual({});
    expect(marginNote(2000, 1500)).toMatch(/allowed/);
  });
});

describe("edit form save with blanks", () => {
  const blank = {
    potential_id: "",
    month: "",
    year: "",
    customer_id: "",
    customer_name: "",
    lab_name: "",
    lab_type: "public_cloud" as const,
    cloud_provider: "gcp",
    system_config: "",
    line_of_business: "",
    start_date: "",
    end_date: "",
    total_users: "",
    input_cost: "",
    selling_cost: "",
  };
  it("saves a row that is blank except cloud type and provider, with nulls and not zeros", () => {
    const parsed = adrEditSchema.parse(blank);
    const row = toTransactionUpdate(parsed);
    expect(row.potential_id).toBeNull();
    expect(row.customer_name).toBeNull();
    expect(row.customer_id).toBeNull();
    expect(row.month).toBeNull();
    expect(row.year).toBeNull();
    expect(row.start_date).toBeNull();
    expect(row.end_date).toBeNull();
    expect(row.cloud_provider).toBe("GCP");
    expect(row.total_users).toBeNull();
    expect(row.input_cost).toBeNull();
    expect(row.selling_cost).toBeNull();
    expect(row.lab_type).toBe("public_cloud");
    expect(JSON.stringify(row)).not.toMatch(/"input_cost":0/);
    expect(JSON.stringify(row)).not.toMatch(/"selling_cost":0/);
  });
  it("accepts input cost above selling cost", () => {
    const parsed = adrEditSchema.parse({ ...blank, input_cost: "2000", selling_cost: "1500", potential_id: "PID-EDIT" });
    expect(toTransactionUpdate(parsed)).toMatchObject({ potential_id: "PID-EDIT", input_cost: 2000, selling_cost: 1500 });
  });
  it("does not turn a cleared cost into 0 when the other cost is filled", () => {
    const parsed = adrEditSchema.parse({ ...blank, selling_cost: "10", input_cost: "" });
    expect(toTransactionUpdate(parsed).input_cost).toBeNull();
    expect(toTransactionUpdate(parsed).selling_cost).toBe(10);
  });
});

describe("toTransactionInsert", () => {
  it("public cloud keeps the provider and drops system_config; created_by is the caller", () => {
    const row = toTransactionInsert(adrEntrySchema.parse(valid), "u1");
    expect(row).toMatchObject({ cloud_provider: "AWS", system_config: null, repository_type: "public_cloud", created_by: "u1" });
  });
  it("SCRUM-129: private cloud keeps Oracle and SAP (no MakeMyLabs lock) and stores the canonical name", () => {
    const priv = (cloud_provider: string) =>
      toTransactionInsert(adrEntrySchema.parse({ ...valid, lab_type: "private_cloud", cloud_provider, system_config: "8GB 2vCPUs" }), "u1");
    expect(priv("Oracle")).toMatchObject({ cloud_provider: "Oracle", lab_type: "private_cloud", system_config: "8GB 2vCPUs" });
    expect(priv("SAP").cloud_provider).toBe("SAP");
    expect(priv("oci").cloud_provider).toBe("Oracle");
    expect(priv("MakeMyLabs").cloud_provider).toBe(PRIVATE_CLOUD_PROVIDER);
  });
});

describe("SCRUM-129 provider rule (form and server)", () => {
  it.each([
    ["private_cloud", "MakeMyLabs Private Cloud"],
    ["private_cloud", "Oracle"],
    ["private_cloud", "SAP"],
    ["public_cloud", "AWS"],
    ["public_cloud", "Microsoft Azure"],
    ["public_cloud", "Google Cloud"],
  ])("accepts %s with %s", (lab_type, cloud_provider) => {
    expect(errs({ ...valid, lab_type, cloud_provider })).toEqual({});
  });
  it.each([
    ["private_cloud", "", /required/],
    ["public_cloud", "   ", /required/],
    ["private_cloud", "AWS", /AWS is Public cloud/],
    ["public_cloud", "SAP", /SAP is Private cloud/],
    ["public_cloud", "Oracle", /Oracle is Private cloud/],
    ["public_cloud", "MakeMyLabs", /Private cloud/],
    ["public_cloud", "IBM", /not allowed/],
    ["private_cloud", "Hybrid", /not allowed/],
  ])("rejects %s with %j (never defaulted)", (lab_type, cloud_provider, msg) => {
    const e = errs({ ...valid, lab_type, cloud_provider });
    expect(Object.keys(e)).toEqual(["cloud_provider"]);
    expect(e.cloud_provider).toMatch(msg);
  });
  it("the edit schema applies the same rule", () => {
    expect(adrEditSchema.safeParse({ ...valid, lab_type: "public_cloud", cloud_provider: "SAP" }).success).toBe(false);
  });
  it("toTransactionInsert / toTransactionUpdate refuse to build a row that skipped the schema", () => {
    const bad = { ...adrEntrySchema.parse(valid), cloud_provider: null };
    expect(() => toTransactionInsert(bad, "u1")).toThrow(/required/);
    expect(() => toTransactionUpdate({ ...bad, cloud_provider: "SAP" })).toThrow(/Private cloud/);
  });
});
