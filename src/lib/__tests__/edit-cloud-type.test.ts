import { describe, expect, it } from "vitest";
import { adrEditSchema } from "@/lib/adr-entry";
import {
  cloudTypeChanges,
  cloudTypeFromProvider,
  withCloudTypeFromProvider,
} from "@/lib/edit-cloud-type";

// Synthetic edit-form values (what react-hook-form holds; blanks are "").
const storedPublicRow = {
  potential_id: "SYN-EDIT-1",
  month: 9,
  year: 2026,
  customer_id: "",
  customer_name: "Synthetic Customer",
  lab_name: "Synthetic Lab",
  lab_type: "public_cloud",
  cloud_provider: "Azure",
  system_config: "",
  line_of_business: "",
  start_date: "",
  end_date: "",
  total_users: 10,
  input_cost: 100,
  selling_cost: 200,
  lab_batch_id: "",
  is_hybrid: false,
};

describe("edit form: the provider decides the cloud type (QC fix 3)", () => {
  it("derives the type from the provider via the shared module", () => {
    expect(cloudTypeFromProvider("Oracle")).toBe("private_cloud");
    expect(cloudTypeFromProvider("OCI")).toBe("private_cloud");
    expect(cloudTypeFromProvider("GCP")).toBe("public_cloud");
    expect(cloudTypeFromProvider("")).toBeNull();
    expect(cloudTypeFromProvider("Hybrid")).toBeNull();
  });

  it("changing only the provider is refused by the server schema", () => {
    const providerOnly = { ...storedPublicRow, cloud_provider: "Oracle" };
    expect(adrEditSchema.safeParse(providerOnly).success).toBe(false);
  });

  it("the form sends lab_type and provider together, and the schema accepts it", () => {
    const sent = withCloudTypeFromProvider({ ...storedPublicRow, cloud_provider: "Oracle" });
    expect(sent.lab_type).toBe("private_cloud");
    expect(sent.cloud_provider).toBe("Oracle");
    const parsed = adrEditSchema.safeParse(sent);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.lab_type).toBe("private_cloud");
  });

  it("works the other way (private row corrected to public)", () => {
    const sent = withCloudTypeFromProvider({
      ...storedPublicRow,
      lab_type: "private_cloud",
      cloud_provider: "AWS",
    });
    expect(sent.lab_type).toBe("public_cloud");
    expect(adrEditSchema.safeParse(sent).success).toBe(true);
  });

  it("a blank or unknown provider is not defaulted; the schema reports it", () => {
    const blank = withCloudTypeFromProvider({ ...storedPublicRow, cloud_provider: "" });
    expect(blank.lab_type).toBe("public_cloud");
    expect(adrEditSchema.safeParse(blank).success).toBe(false);
    const unknown = withCloudTypeFromProvider({ ...storedPublicRow, cloud_provider: "IBM Cloud" });
    expect(adrEditSchema.safeParse(unknown).success).toBe(false);
  });

  it("flags a cross-type change", () => {
    expect(cloudTypeChanges("public_cloud", "SAP")).toBe(true);
    expect(cloudTypeChanges("public_cloud", "AWS")).toBe(false);
    expect(cloudTypeChanges("public_cloud", "")).toBe(false);
  });
});
