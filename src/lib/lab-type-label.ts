// SCRUM-129 (D4): lab catalog lab_type labels. "Hybrid" is a catalog-only third type:
// labelled "Hybrid" and never counted as Private cloud or Public cloud.
import { cloudTypeLabel, isCloudType } from "@/lib/cloud-provider";

export const LAB_TYPE_OPTIONS = ["private_cloud", "public_cloud", "hybrid"] as const;
export type LabType = (typeof LAB_TYPE_OPTIONS)[number];

export function labTypeLabel(value: string | null | undefined): string {
  if (value === "hybrid") return "Hybrid";
  return cloudTypeLabel(value);
}

/** Which KPI split a lab type counts in. Hybrid and unknown count in neither. */
export function labTypeSplit(
  value: string | null | undefined,
): "private_cloud" | "public_cloud" | null {
  return isCloudType(value) ? value : null;
}
