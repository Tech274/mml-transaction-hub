import { describe, expect, it } from "vitest";
import { adrProviderFields } from "@/lib/ai-cc-adr-provider";
import { MAKEMYLABS_PROVIDER } from "@/lib/cloud-provider";

const src = import.meta.glob(["/src/lib/ai-command-center.functions.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const code = src["/src/lib/ai-command-center.functions.ts"];

const req = (requisition: Record<string, unknown>) => ({
  id: "00000000-0000-0000-0000-000000000001",
  request_code: "LR-2026-001",
  customer_name: "Example Customer",
  lab_name: "Example Lab",
  status: "CONFIRMED",
  requisition: { input_cost: 100, selling_cost: 150, start_date: "2026-10-01", total_users: 10, ...requisition },
  confirmed_at: null,
  created_at: "2026-10-01T00:00:00Z",
});

describe("SCRUM-129: Cost & ADR agent field map provider rule", () => {
  it.each([
    [{ cloud_provider: "Oracle", lab_type: "private_cloud", system_config: "8GB 2vCPUs" }, "Oracle", "private_cloud", "8GB 2vCPUs"],
    [{ cloud_provider: "SAP" }, "SAP", "private_cloud", null],
    [{ cloud_provider: "oci" }, "Oracle", "private_cloud", null],
    [{ cloud_provider: "MakeMyLabs" }, MAKEMYLABS_PROVIDER, "private_cloud", null],
    [{ cloud_provider: "Azure", system_config: "16GB" }, "Azure", "public_cloud", null],
    [{ cloud_provider: "aws", lab_type: "public_cloud" }, "AWS", "public_cloud", null],
  ])("%j -> %s / %s", (r, provider, type, config) => {
    const f = adrProviderFields(r);
    expect(f).toMatchObject({ provider_ok: true, cloud_provider: provider, lab_type: type, system_config: config });
  });

  it.each([
    [{}],
    [{ lab_type: "public_cloud" }],
    [{ lab_type: "private_cloud" }],
    [{ cloud_provider: "  " }],
    [{ cloud_provider: "IBM Cloud" }],
    [{ cloud_provider: "Hybrid" }],
    [{ cloud_provider: "AWS", lab_type: "private_cloud" }],
    [{ cloud_provider: "SAP", lab_type: "public_cloud" }],
  ])("%j -> nothing defaulted, needs a decision", (r) => {
    const f = adrProviderFields(r);
    expect(f).toMatchObject({ provider_ok: false, cloud_provider: null, lab_type: null, system_config: null });
    expect(f.notes.join(" ")).toMatch(/needs a decision/);
  });

  it("private is not forced to MakeMyLabs and public is not defaulted to AWS in the proposal", async () => {
    const { costAdrBrain } = await import("../ai-command-center.functions");
    const [oracle] = costAdrBrain(req({ lab_type: "private_cloud", cloud_provider: "Oracle" }));
    expect(oracle.payload.field_map).toMatchObject({ lab_type: "private_cloud", cloud_provider: "Oracle", system_config: null });
    expect(oracle.payload.provider_ok).toBe(true);

    const [missing] = costAdrBrain(req({}));
    expect(missing.payload.field_map).toMatchObject({ lab_type: null, cloud_provider: null });
    expect(missing.payload.provider_ok).toBe(false);
    expect(missing.title).toMatch(/needs Cloud Provider/);
    expect((missing.payload.extraction_notes as string[]).join(" ")).toMatch(/no default/);
    // Costs and the rest of the map are still proposed; a human saves the entry.
    expect(missing.payload.field_map).toMatchObject({ input_cost: 100, selling_cost: 150, total_users: 10 });
  });

  it("source has no cloud-type or provider defaults left", () => {
    expect(code).not.toMatch(/lab_type \?\? "public_cloud"/);
    expect(code).not.toMatch(/cloud_provider \?\? "AWS"/);
    expect(code).not.toMatch(/"16GB 4vCPUs"\)/);
    expect(code).not.toMatch(/\? "MakeMyLabs Private Cloud" :/);
  });
});
