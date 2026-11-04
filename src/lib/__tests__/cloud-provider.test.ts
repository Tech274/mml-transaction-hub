import { describe, expect, it } from "vitest";
import {
  CANONICAL_PROVIDERS,
  MAKEMYLABS_PROVIDER,
  ACTIVE_ALIAS_ENTRIES,
  NEVER_ALIASES,
  PENDING_ALIASES,
  PENDING_ALIAS_ENTRIES,
  isNeverAlias,
  PROVIDER_CLOUD_TYPE,
  PROVIDER_GROUPS,
  checkProviderRow,
  healerFixLabel,
  cloudTypeConflict,
  cloudTypeLabel,
  isProviderAllowedForCloudType,
  normalizeProvider,
  parseCloudTypeValue,
  providerCloudType,
  providersForCloudType,
} from "@/lib/cloud-provider";

describe("cloud-provider: Chief's rule", () => {
  it("has exactly six canonical providers, private then public", () => {
    expect(CANONICAL_PROVIDERS).toEqual([
      "MakeMyLabs Private Cloud",
      "Oracle",
      "SAP",
      "AWS",
      "Azure",
      "GCP",
    ]);
    expect(MAKEMYLABS_PROVIDER).toBe("MakeMyLabs Private Cloud");
  });

  it("maps MakeMyLabs, Oracle, SAP to private and AWS, Azure, GCP to public", () => {
    expect(PROVIDER_CLOUD_TYPE).toEqual({
      "MakeMyLabs Private Cloud": "private_cloud",
      Oracle: "private_cloud",
      SAP: "private_cloud",
      AWS: "public_cloud",
      Azure: "public_cloud",
      GCP: "public_cloud",
    });
    expect(providersForCloudType("private_cloud")).toEqual([
      "MakeMyLabs Private Cloud",
      "Oracle",
      "SAP",
    ]);
    expect(providersForCloudType("public_cloud")).toEqual(["AWS", "Azure", "GCP"]);
    expect(PROVIDER_GROUPS.map((g) => g.label)).toEqual(["Private cloud", "Public cloud"]);
  });

  it.each([
    ["MakeMyLabs", "MakeMyLabs Private Cloud", "private_cloud"],
    ["MakeMyLabs Private Cloud", "MakeMyLabs Private Cloud", "private_cloud"],
    ["  makemylabs  ", "MakeMyLabs Private Cloud", "private_cloud"],
    ["MAKEMYLABS   PRIVATE   CLOUD", "MakeMyLabs Private Cloud", "private_cloud"],
    ["Oracle", "Oracle", "private_cloud"],
    ["oracle", "Oracle", "private_cloud"],
    ["Oracle Cloud", "Oracle", "private_cloud"],
    ["OCI", "Oracle", "private_cloud"],
    ["oci", "Oracle", "private_cloud"],
    [" SAP ", "SAP", "private_cloud"],
    ["sap", "SAP", "private_cloud"],
    ["aws", "AWS", "public_cloud"],
    ["AZURE", "Azure", "public_cloud"],
    ["gcp", "GCP", "public_cloud"],
    ["Make My Labs", "MakeMyLabs Private Cloud", "private_cloud"],
    ["make my labs private cloud", "MakeMyLabs Private Cloud", "private_cloud"],
    ["MakeMyLabs Cloud", "MakeMyLabs Private Cloud", "private_cloud"],
    ["MML", "MakeMyLabs Private Cloud", "private_cloud"],
    ["mml private cloud", "MakeMyLabs Private Cloud", "private_cloud"],
    ["Oracle Cloud Infrastructure", "Oracle", "private_cloud"],
    ["SAP Cloud", "SAP", "private_cloud"],
    ["SAP BTP", "SAP", "private_cloud"],
    ["SAP Business Technology Platform", "SAP", "private_cloud"],
    ["SAP HANA Enterprise Cloud", "SAP", "private_cloud"],
    ["SAP HEC", "SAP", "private_cloud"],
    ["RISE with SAP", "SAP", "private_cloud"],
    ["SAP RISE", "SAP", "private_cloud"],
    ["Amazon Web Services", "AWS", "public_cloud"],
    ["Amazon AWS", "AWS", "public_cloud"],
    ["Microsoft Azure", "Azure", "public_cloud"],
    ["Azure Cloud", "Azure", "public_cloud"],
    ["MS Azure", "Azure", "public_cloud"],
    ["Google Cloud", "GCP", "public_cloud"],
    ["Google Cloud Platform", "GCP", "public_cloud"],
  ])("normalises %j to %s (%s)", (raw, provider, cloudType) => {
    const r = normalizeProvider(raw);
    expect(r).toMatchObject({ ok: true, provider, canonical: provider, cloudType });
    if (r.ok) expect(r.aliasApplied).toBe(raw.trim() !== provider);
  });

  it("reports aliasApplied for Healer fixes (raw differs from canonical)", () => {
    expect(normalizeProvider("OCI")).toMatchObject({
      aliasApplied: true,
      raw: "OCI",
      canonical: "Oracle",
    });
    expect(normalizeProvider(" Oracle ")).toMatchObject({ aliasApplied: false, raw: "Oracle" });
    expect(normalizeProvider("oracle")).toMatchObject({ aliasApplied: true });
    expect(normalizeProvider("MakeMyLabs")).toMatchObject({
      aliasApplied: true,
      canonical: "MakeMyLabs Private Cloud",
    });
    expect(normalizeProvider("MakeMyLabs Private Cloud")).toMatchObject({ aliasApplied: false });
    expect(healerFixLabel("OCI")).toBe("OCI → Oracle");
    expect(healerFixLabel("MS Azure")).toBe("MS Azure → Azure");
    expect(healerFixLabel("AWS")).toBeNull();
    expect(healerFixLabel("IBM")).toBeNull();
  });

  it.each([undefined, null, "", "   ", "\t"])(
    "blocks a blank provider (%j) and never defaults it",
    (raw) => {
      const r = normalizeProvider(raw);
      expect(r.ok).toBe(false);
      expect(r.cloudType).toBeNull();
      expect(r.provider).toBeNull();
      if (!r.ok) {
        expect(r.code).toBe("blank");
        expect(r.message).toBe("Cloud Provider is required");
      }
    },
  );

  it.each(["Hybrid", "hybrid", "IBM", "Oracle DB", "SAP ERP", "Azure Stack", "VMware", "Alibaba"])(
    "blocks an unknown provider %j with the six-provider message",
    (raw) => {
      const r = normalizeProvider(raw);
      expect(r.ok).toBe(false);
      expect(r.cloudType).toBeNull();
      if (!r.ok) {
        expect(r.code).toBe("unknown");
        expect(r.message).toContain(`'${raw}' is not allowed`);
        expect(r.message).toContain("MakeMyLabs, Oracle or SAP (Private cloud)");
        expect(r.message).toContain("AWS, Azure or GCP (Public cloud)");
      }
    },
  );

  it("PENDING_ALIASES is empty after John's 06:11 decision", () => {
    expect(PENDING_ALIAS_ENTRIES).toEqual([]);
    expect(PENDING_ALIASES).toEqual({});
  });

  it("active aliases are the whole spec 129.3a table (30 entries incl. the canonical names)", () => {
    const names = new Set(ACTIVE_ALIAS_ENTRIES.map(([a]) => a.toLowerCase()));
    expect(names.size).toBe(29);
    for (const [alias, canonical] of ACTIVE_ALIAS_ENTRIES) {
      expect(normalizeProvider(alias)).toMatchObject({ ok: true, canonical });
    }
  });

  it.each(NEVER_ALIASES.map((v) => [v]))("never-alias %j returns a null cloud type", (raw) => {
    const r = normalizeProvider(raw);
    expect(r.ok).toBe(false);
    expect(r.cloudType).toBeNull();
    expect(providerCloudType(raw)).toBeNull();
    expect(isNeverAlias(raw)).toBe(true);
    expect(isNeverAlias(`  ${raw.toUpperCase()}  `)).toBe(true);
  });

  it("the never-alias list matches the spec and no active alias is on it", () => {
    expect(NEVER_ALIASES).toEqual([
      "Hybrid",
      "Private",
      "Public",
      "Private cloud",
      "Public cloud",
      "On-prem",
      "IBM",
      "IBM Cloud",
      "Alibaba",
      "Other",
      "N/A",
      "-",
      "0",
      "",
      "Amazon",
      "Microsoft",
      "Google",
    ]);
    for (const [alias] of [...ACTIVE_ALIAS_ENTRIES, ...PENDING_ALIAS_ENTRIES])
      expect(isNeverAlias(alias)).toBe(false);
  });

  it("providerCloudType returns null outside the six (never public)", () => {
    expect(providerCloudType("Oracle")).toBe("private_cloud");
    expect(providerCloudType("Hybrid")).toBeNull();
    expect(providerCloudType(null)).toBeNull();
    expect(isProviderAllowedForCloudType("SAP", "public_cloud")).toBe(false);
    expect(isProviderAllowedForCloudType("SAP", "private_cloud")).toBe(true);
  });

  it("labels: sentence case, unknown is 'Not set'", () => {
    expect(cloudTypeLabel("private_cloud")).toBe("Private cloud");
    expect(cloudTypeLabel("public_cloud")).toBe("Public cloud");
    expect(cloudTypeLabel("hybrid")).toBe("Not set");
    expect(cloudTypeLabel(null)).toBe("Not set");
  });
});

describe("cloud-provider: Cloud Type column", () => {
  it.each([
    ["Private cloud", "private_cloud"],
    ["private", "private_cloud"],
    ["private_cloud", "private_cloud"],
    [" PUBLIC CLOUD ", "public_cloud"],
    ["Public", "public_cloud"],
    ["", null],
    [undefined, null],
    ["Hybrid", "invalid"],
  ])("parses %j as %j", (raw, expected) => {
    expect(parseCloudTypeValue(raw)).toBe(expected);
  });

  it("a Cloud Type that conflicts with the provider is a row error", () => {
    const r = checkProviderRow("SAP", "Public cloud");
    expect(r.ok).toBe(false);
    expect(r.cloudType).toBeNull();
    if (!r.ok) expect(r.errors[0]).toMatch(/conflicts with provider SAP, which is Private cloud/);
    expect(cloudTypeConflict("AWS", "Private")).toMatch(/provider AWS, which is Public cloud/);
  });

  it("an agreeing or absent Cloud Type passes", () => {
    expect(checkProviderRow("oracle", "Private cloud")).toEqual({
      ok: true,
      provider: "Oracle",
      cloudType: "private_cloud",
      aliasApplied: true,
      raw: "oracle",
    });
    expect(checkProviderRow("Azure")).toEqual({
      ok: true,
      provider: "Azure",
      cloudType: "public_cloud",
      aliasApplied: false,
      raw: "Azure",
    });
    expect(cloudTypeConflict("Azure", "")).toBeNull();
    expect(cloudTypeConflict("", "Public")).toBeNull();
  });

  it("an invalid Cloud Type value or a blank provider is a row error", () => {
    const a = checkProviderRow("AWS", "Hybrid");
    expect(a.ok).toBe(false);
    const b = checkProviderRow("", "Private cloud");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors).toEqual(["Cloud Provider is required"]);
  });
});

describe("cloud-provider: Chief's 6 Oct file shape (synthetic rows)", () => {
  // Same shape as Chief's file: 334 MakeMyLabs Private Cloud + 2 Oracle + 6 Azure = 342.
  // Synthetic: provider values only, no customer data.
  const rows = [
    ...Array.from({ length: 334 }, () => "MakeMyLabs Private Cloud"),
    ...Array.from({ length: 2 }, () => "Oracle"),
    ...Array.from({ length: 6 }, () => "Azure"),
  ];

  it("imports in one go: 336 private, 6 public, 0 blanked, 0 errors", () => {
    const results = rows.map((p) => checkProviderRow(p));
    const ok = results.filter((r) => r.ok);
    expect(rows).toHaveLength(342);
    expect(results.filter((r) => !r.ok)).toHaveLength(0);
    expect(ok.filter((r) => r.cloudType === "private_cloud")).toHaveLength(336);
    expect(ok.filter((r) => r.cloudType === "public_cloud")).toHaveLength(6);
    expect(ok.filter((r) => !r.provider)).toHaveLength(0);
    expect(ok.filter((r) => r.provider === "Oracle")).toHaveLength(2);
  });

  it("adding one SAP row and one unknown row: SAP is private, unknown blocks", () => {
    const results = [...rows, "SAP", "IBM"].map((p) => checkProviderRow(p));
    expect(results.filter((r) => r.cloudType === "private_cloud")).toHaveLength(337);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
});

describe("spec 129.6 T7 / T9", () => {
  it.each([
    ["Amazon Web Services", "AWS", "public_cloud"],
    ["MS Azure", "Azure", "public_cloud"],
    ["Google Cloud Platform", "GCP", "public_cloud"],
    ["SAP BTP", "SAP", "private_cloud"],
    ["RISE with SAP", "SAP", "private_cloud"],
    ["MML", "MakeMyLabs Private Cloud", "private_cloud"],
    ["Make My Labs", "MakeMyLabs Private Cloud", "private_cloud"],
  ])("T7: %s -> %s (%s)", (raw, canonical, cloudType) => {
    const r = normalizeProvider(raw);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe(canonical);
    expect(r.cloudType).toBe(cloudType);
    expect(r.ok && r.aliasApplied).toBe(true);
  });

  it.each([
    [" oracle ", "Oracle"],
    ["AZURE", "Azure"],
    ["makemylabs  private  cloud", "MakeMyLabs Private Cloud"],
  ])("T9: %j is stored as %s", (raw, canonical) => {
    expect(normalizeProvider(raw).provider).toBe(canonical);
  });
});
