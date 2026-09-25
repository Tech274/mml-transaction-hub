// SCRUM-103: strict "what you upload is what you get" import — template definition.
//
// ⚠️ PENDING VIVEK CONFIRMATION ⚠️
// The headers, their order and the rules in PROPOSED_RULES are *proposed defaults*
// taken from IMPORT_FIX_PLAN §3 (the 17 Sep public-cloud file). They must be
// confirmed against Vivek's real Excel sample and his answers to the 7 import
// decisions before any live data is loaded. Nothing here loads data.

import { LINE_OF_BUSINESS_OPTIONS } from "@/lib/bulk-template";

export const STRICT_TEMPLATE_VERSION = "2.0.0-proposed" as const;
export const STRICT_TEMPLATE_STATUS = "PENDING_VIVEK_CONFIRMATION" as const;

export type StrictField =
  | "potential_id"
  | "month"
  | "year"
  | "customer_name"
  | "lab_name"
  | "line_of_business"
  | "start_date"
  | "end_date"
  | "total_users"
  | "input_cost"
  | "selling_cost"
  | "cloud_provider";

export type ColumnType = "text" | "int" | "decimal" | "date" | "enum";

export interface StrictColumn {
  /** Header exactly as in the Excel sheet (compared ignoring case and surrounding spaces). */
  header: string;
  field: StrictField;
  type: ColumnType;
  /** A blank cell in a required column is an error. Blank never becomes 0. */
  required: boolean;
  allowed?: readonly string[];
  min?: number;
  max?: number;
}

/** Decision 3 (PENDING): "OpenAI" is not allowed until Vivek decides (needs app + DB change). */
export const PUBLIC_PROVIDERS = ["AWS", "Azure", "GCP"] as const;

/** Provisional mapping (IMPORT_FIX_PLAN §3.1). Order = column order in the sheet. */
export const PUBLIC_STRICT_COLUMNS: readonly StrictColumn[] = [
  { header: "Potential ID", field: "potential_id", type: "text", required: true },
  { header: "Month", field: "month", type: "int", required: true, min: 1, max: 12 },
  { header: "Year", field: "year", type: "int", required: true, min: 2000, max: 2100 },
  { header: "Customer Name", field: "customer_name", type: "text", required: true },
  { header: "Lab Name", field: "lab_name", type: "text", required: true },
  { header: "Line of Business", field: "line_of_business", type: "enum", required: true, allowed: LINE_OF_BUSINESS_OPTIONS },
  { header: "Start Date", field: "start_date", type: "date", required: true },
  { header: "End Date", field: "end_date", type: "date", required: true },
  { header: "Total Users", field: "total_users", type: "int", required: true, min: 1 },
  { header: "Input Cost", field: "input_cost", type: "decimal", required: true, min: 0 },
  { header: "Selling Cost", field: "selling_cost", type: "decimal", required: true, min: 0 },
  { header: "Cloud Provider", field: "cloud_provider", type: "enum", required: true, allowed: PUBLIC_PROVIDERS },
];

/** Extra columns that may be present and are ignored (e.g. "S.No"). Empty until Vivek confirms. */
export const IGNORED_HEADERS: readonly string[] = [];

/**
 * The 7 import decisions (IMPORT_FIX_PLAN §3 "Decisions needed from Vivek").
 * Every value below is a PROPOSED DEFAULT, not a confirmed rule.
 */
export interface StrictRules {
  /** D1: exact headers/order — see PUBLIC_STRICT_COLUMNS / IGNORED_HEADERS. */
  columns: readonly StrictColumn[];
  ignoredHeaders: readonly string[];
  /** D2: blank Input/Selling Cost. Proposed: "error" (never silently 0). */
  blankCost: "error" | "null";
  /** D3: allowed cloud providers. Proposed: AWS/Azure/GCP only (OpenAI rejected). */
  allowedProviders: readonly string[];
  /** D4: input_cost > selling_cost. Proposed: "warning" that must be acknowledged. */
  inputAboveSelling: "error" | "warning";
  /** D5: rows without a Potential ID. Proposed: "error". */
  blankPotentialId: "error";
  /** D6: customer name variants. Proposed: keep exactly as typed; case/spacing variants need explicit confirmation at preview. */
  customerVariants: "confirm";
  /** D7: re-upload policy. Proposed: append-only batches; the same file (SHA-256) cannot be committed twice. */
  reupload: "append-only";
}

export const PROPOSED_RULES: StrictRules = {
  columns: PUBLIC_STRICT_COLUMNS,
  ignoredHeaders: IGNORED_HEADERS,
  blankCost: "error",
  allowedProviders: PUBLIC_PROVIDERS,
  inputAboveSelling: "warning",
  blankPotentialId: "error",
  customerVariants: "confirm",
  reupload: "append-only",
};

/** 0 -> "A", 25 -> "Z", 26 -> "AA" (Excel column letters for error messages). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}
