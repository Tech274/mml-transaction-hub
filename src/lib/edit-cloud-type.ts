// SCRUM-129 (Eng QC fix 3): correcting a mis-typed row from the edit form. The provider
// decides the cloud type through the shared module, so the form derives lab_type from the
// chosen provider and always submits BOTH together. The server (adrEditSchema /
// providerIssue, DB 22023) refuses a provider whose type differs from lab_type.
import { normalizeProvider, type CloudType } from "@/lib/cloud-provider";

/** Cloud type the provider decides, or null for a blank/unknown provider (never defaulted). */
export function cloudTypeFromProvider(provider: string | null | undefined): CloudType | null {
  const r = normalizeProvider(provider ?? "");
  return r.ok ? r.cloudType : null;
}

/**
 * Returns the values with lab_type set from cloud_provider. A blank/unknown provider leaves
 * lab_type as it is, so the schema reports the provider error instead of a silent default.
 */
export function withCloudTypeFromProvider<
  T extends { lab_type?: unknown; cloud_provider?: unknown },
>(values: T): T {
  const derived = cloudTypeFromProvider(
    typeof values.cloud_provider === "string" ? values.cloud_provider : null,
  );
  return derived ? { ...values, lab_type: derived } : values;
}

/** True when saving would move the row to the other cloud type. */
export function cloudTypeChanges(
  storedLabType: string | null | undefined,
  provider: string | null | undefined,
): boolean {
  const derived = cloudTypeFromProvider(provider);
  return derived != null && storedLabType != null && derived !== storedLabType;
}
