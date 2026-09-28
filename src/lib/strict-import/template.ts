// SCRUM-103: "what you upload is what you get" import — template definition.
//
// Owner direction, 28 Sep 2026: nothing on upload is a strict rule. Blank cells
// are stored as NULL (never 0). A value that cannot be stored becomes NULL and
// a preview warning. Selling below cost is allowed. Repeated Potential IDs are
// normal. Header matching stays tolerant of case and surrounding spaces.

import { LINE_OF_BUSINESS_OPTIONS } from "@/lib/bulk-template";

export const STRICT_TEMPLATE_VERSION = "2.0.0-proposed" as const;
export const STRICT_TEMPLATE_STATUS = "LENIENT_2026-09-28" as const;

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
  /** Kept for the column list. Blanks are never rejected (28 Sep). */
  required: boolean;
  allowed?: readonly string[];
  min?: number;
  max?: number;
}

/** Known public providers. Anything else is stored as NULL and listed as a warning. */
export const PUBLIC_PROVIDERS = ["AWS", "Azure", "GCP"] as const;

/** Column order in the sheet. No column is required. */
export const PUBLIC_STRICT_COLUMNS: readonly StrictColumn[] = [
  { header: "Potential ID", field: "potential_id", type: "text", required: false },
  { header: "Month", field: "month", type: "int", required: false, min: 1, max: 12 },
  { header: "Year", field: "year", type: "int", required: false, min: 2000, max: 2100 },
  { header: "Customer Name", field: "customer_name", type: "text", required: false },
  { header: "Lab Name", field: "lab_name", type: "text", required: false },
  { header: "Line of Business", field: "line_of_business", type: "enum", required: false, allowed: LINE_OF_BUSINESS_OPTIONS },
  { header: "Start Date", field: "start_date", type: "date", required: false },
  { header: "End Date", field: "end_date", type: "date", required: false },
  { header: "Total Users", field: "total_users", type: "int", required: false, min: 1 },
  { header: "Input Cost", field: "input_cost", type: "decimal", required: false, min: 0 },
  { header: "Selling Cost", field: "selling_cost", type: "decimal", required: false, min: 0 },
  { header: "Cloud Provider", field: "cloud_provider", type: "enum", required: false, allowed: PUBLIC_PROVIDERS },
];

/** Extra columns that may be present and are ignored (e.g. "S.No"). Empty until Vivek confirms. */
export const IGNORED_HEADERS: readonly string[] = [];

/**
 * Import decisions after the 28 Sep owner direction.
 * Blanks and unstorable cells never block. Selling below cost is a note only.
 */
export interface StrictRules {
  /** D1: headers compared ignoring case and surrounding spaces. */
  columns: readonly StrictColumn[];
  ignoredHeaders: readonly string[];
  /** D2: blank Input/Selling Cost is NULL. Never 0. */
  blankCost: "null";
  /** D3: providers outside this list are stored as NULL and warned. */
  allowedProviders: readonly string[];
  /** D4: input_cost > selling_cost is a non-blocking note. */
  inputAboveSelling: "warning";
  /** D5: a blank Potential ID is NULL, not an error. */
  blankPotentialId: "null";
  /** D6: customer name variants. Keep exactly as typed; case/spacing variants are confirmed at preview. */
  customerVariants: "confirm";
  /** D7: re-upload policy. Append-only batches; the same file (SHA-256) cannot be committed twice. */
  reupload: "append-only";
}

export const PROPOSED_RULES: StrictRules = {
  columns: PUBLIC_STRICT_COLUMNS,
  ignoredHeaders: IGNORED_HEADERS,
  blankCost: "null",
  allowedProviders: PUBLIC_PROVIDERS,
  inputAboveSelling: "warning",
  blankPotentialId: "null",
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
