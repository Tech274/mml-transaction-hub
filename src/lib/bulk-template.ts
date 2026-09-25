// Shared, client-safe descriptors for the bulk-import CSV template.
// Both the browser UI (template download + row validation) and the server
// validation function import from this file to stay in sync.

export const TEMPLATE_VERSION = "1.1.0" as const;
export const TEMPLATE_VERSION_COMMENT_PREFIX = "# template_version:" as const;

export const LINE_OF_BUSINESS_OPTIONS = ["VILT", "Standalone", "Integrated"] as const;
export type LineOfBusiness = (typeof LINE_OF_BUSINESS_OPTIONS)[number];

export const COMMON_HEADERS = [
  "potential_id",
  "month",
  "year",
  "customer_name",
  "lab_name",
  "line_of_business",
  "start_date",
  "end_date",
  "total_users",
  "input_cost",
  "selling_cost",
] as const;

export const PUBLIC_HEADERS = [...COMMON_HEADERS, "cloud_provider"] as const;
export const PRIVATE_HEADERS = [...COMMON_HEADERS, "system_config"] as const;

/**
 * Enrich a Postgres error into a human-friendly message that names the
 * offending constraint and lists the allowed values, so the UI can display
 * the exact reason without exposing raw SQL text.
 *
 * Returns the original message when the error is not one we recognize.
 */
export function enrichPgConstraintError(
  message: string,
  code?: string | null,
): { message: string; column?: string; allowed?: readonly string[] } {
  const raw = message || "";
  if (code !== "23514") return { message: raw };
  if (raw.includes("transactions_line_of_business_check")) {
    return {
      message: `line_of_business must be one of ${LINE_OF_BUSINESS_OPTIONS.join(", ")}. Value was rejected by the database constraint transactions_line_of_business_check.`,
      column: "line_of_business",
      allowed: LINE_OF_BUSINESS_OPTIONS,
    };
  }
  return { message: raw };
}

/** Public schema descriptor returned to the client + used by the server fn. */
export function getBulkTemplateSchema() {
  return {
    version: TEMPLATE_VERSION,
    line_of_business: {
      allowed: LINE_OF_BUSINESS_OPTIONS,
      case_sensitive: true,
      trim: false,
    },
    headers: {
      public_cloud: PUBLIC_HEADERS,
      private_cloud: PRIVATE_HEADERS,
    },
  } as const;
}
