/**
 * SCRUM-129: cloud type and provider for the Cost & ADR agent's Master ADR field map.
 *
 * The provider decides the cloud type (src/lib/cloud-provider.ts). Nothing is defaulted:
 * - no "public_cloud" when the requisition has no lab_type,
 * - no "AWS" when a public requisition has no provider,
 * - private is no longer forced to MakeMyLabs (Oracle and SAP are kept),
 * - no invented system config.
 * A missing, unknown or conflicting provider leaves cloud_provider and lab_type null and adds
 * a note, so the human who saves the Master ADR entry must choose one (the ADR form and the
 * DB guard both refuse a row without a valid provider).
 */
import {
  CLOUD_TYPE_LABEL,
  checkProviderRow,
  type CanonicalProvider,
  type CloudType,
} from "@/lib/cloud-provider";

export interface AdrProviderFields {
  lab_type: CloudType | null;
  cloud_provider: CanonicalProvider | null;
  system_config: string | null;
  /** true when the provider resolved to one of the six and agrees with any lab_type given. */
  provider_ok: boolean;
  /** Notes for the field-map proposal (shown to the reviewer). */
  notes: string[];
}

function text(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function adrProviderFields(requisition: Record<string, unknown>): AdrProviderFields {
  const rawProvider = requisition["cloud_provider"];
  const rawType = requisition["lab_type"];
  const rawConfig = text(requisition["system_config"]);
  const check = checkProviderRow(rawProvider, rawType);

  if (!check.ok) {
    return {
      lab_type: null,
      cloud_provider: null,
      system_config: null,
      provider_ok: false,
      notes: [
        `Cloud Provider needs a decision: ${check.errors.join(" ")}`,
        "Cloud type and provider were left blank on purpose (no default). Choose MakeMyLabs Private Cloud, Oracle or SAP (Private cloud) or AWS, Azure or GCP (Public cloud) when saving.",
      ],
    };
  }

  const notes: string[] = [];
  if (check.aliasApplied) notes.push(`Cloud Provider '${check.raw}' mapped to ${check.provider}.`);
  notes.push(`Cloud type ${CLOUD_TYPE_LABEL[check.cloudType]} comes from provider ${check.provider}.`);

  let system_config: string | null = null;
  if (check.cloudType === "private_cloud") {
    system_config = rawConfig === "" ? null : rawConfig;
    if (system_config === null) notes.push("System config was not in the requisition; fill it in when saving.");
  } else if (rawConfig !== "") {
    notes.push("System config is only kept for Private cloud rows, so it was dropped.");
  }

  return {
    lab_type: check.cloudType,
    cloud_provider: check.provider,
    system_config,
    provider_ok: true,
    notes,
  };
}
