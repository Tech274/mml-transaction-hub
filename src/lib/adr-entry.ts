// SCRUM-66: the ADR (manual transaction) entry rules in ONE place.
// Used by the form (react-hook-form + zodResolver) and re-checked on the server by
// createAdrTransaction, so the browser cannot skip them. Documented in
// docs/adr-entry-rules.md. Keep the three in step.
// No rule here may be stricter than what the form accepted before SCRUM-66 unless
// the database already rejects it (existing valid workflows must keep working).
import { z } from "zod";
import { looksLikeSecret } from "@/lib/cost-calculator";

export const PUBLIC_CLOUD_PROVIDERS = ["AWS", "Azure", "GCP"] as const;
export const PRIVATE_CLOUD_PROVIDER = "MakeMyLabs Private Cloud";
/** Same list as the database check transactions_line_of_business_check. */
export const LINES_OF_BUSINESS = ["VILT", "Standalone", "Integrated"] as const;
export const SYSTEM_CONFIG_OPTIONS = [
  "8GB 2vCPUs",
  "8GB 4vCPUs",
  "12GB 4vCPUs",
  "16GB 4vCPUs",
  "24GB 6vCPUs",
  "32GB 8vCPUs",
] as const;
export const MAX_AMOUNT = 1_000_000_000;
export const API_UNIT_LABELS = ["calls", "tokens", "credits"] as const;

/** Fields added for the MML Lab demo. Both forms render this set. */
export const ADR_EXTRA_FIELD_NAMES = [
  "lab_batch_id",
  "license_name",
  "api_key_service",
  "selling_price_per_user",
  "vm_price_per_user",
  "license_price_per_user",
  "api_key_price_per_user",
  "input_cost_per_user",
  "input_cost_pct",
  "vm_hours_consumed",
  "license_seats_used",
  "api_units_consumed",
  "api_unit_label",
  "is_hybrid",
] as const;

const secretText = (max: number, label: string) =>
  optionalText(max).superRefine((v, ctx) => {
    if (typeof v === "string" && looksLikeSecret(v)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Don't paste secret keys here (${label})`,
      });
    }
  });

const blankToNull = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
};

const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.union([z.null(), z.string().trim().max(max)]));

const optionalInt = (min: number, max: number, label: string) =>
  z.preprocess(
    blankToNull,
    z.union([
      z.null(),
      z.coerce
        .number()
        .int(`${label} must be a whole number`)
        .min(min, `${label} is out of range`)
        .max(max, `${label} is out of range`),
    ]),
  );

const optionalMoney = (label: string) =>
  z.preprocess(
    blankToNull,
    z.union([
      z.null(),
      z.coerce
        .number({ invalid_type_error: `${label} must be a number` })
        .finite("Enter a valid number")
        .nonnegative(`${label} cannot be negative`)
        .max(MAX_AMOUNT, `${label} is unrealistically high`),
    ]),
  );

const optionalDate = z.preprocess(
  blankToNull,
  z.union([
    z.null(),
    z.string().refine((s) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, "Enter a valid date"),
  ]),
);

/**
 * SCRUM-103: new entry and editing share this schema. No business field is
 * required. Blanks become NULL. lab_type stays required because a transaction
 * is either public or private cloud (the column is NOT NULL).
 * End before start and selling below cost are notes, not errors.
 */
export const adrEntrySchema = z.object({
  potential_id: optionalText(200),
  month: optionalInt(1, 12, "Month"),
  year: optionalInt(2000, 2100, "Year"),
  customer_id: z.preprocess(blankToNull, z.union([z.null(), z.string().uuid()])),
  customer_name: optionalText(200),
  lab_name: optionalText(200),
  lab_type: z.enum(["public_cloud", "private_cloud"], {
    errorMap: () => ({ message: "Choose Public or Private Cloud" }),
  }),
  cloud_provider: optionalText(200),
  system_config: optionalText(200),
  line_of_business: z.preprocess(
    blankToNull,
    z.union([
      z.null(),
      z
        .string()
        .refine(
          (s) => (LINES_OF_BUSINESS as readonly string[]).includes(s),
          "Choose VILT, Standalone or Integrated",
        ),
    ]),
  ),
  start_date: optionalDate,
  end_date: optionalDate,
  total_users: optionalInt(1, 1_000_000_000, "Total users"),
  input_cost: optionalMoney("Input cost"),
  selling_cost: optionalMoney("Selling cost"),
  lab_batch_id: z.preprocess(blankToNull, z.union([z.null(), z.string().uuid("Choose a batch")])),
  license_name: secretText(200, "subscription"),
  api_key_service: secretText(200, "API key service"),
  selling_price_per_user: optionalMoney("Selling price per user"),
  vm_price_per_user: optionalMoney("VM price per user"),
  license_price_per_user: optionalMoney("Licence price per user"),
  api_key_price_per_user: optionalMoney("API key price per user"),
  input_cost_per_user: optionalMoney("Input cost per user"),
  input_cost_pct: z.preprocess(
    blankToNull,
    z.union([
      z.null(),
      z.coerce.number().min(0, "Percent is out of range").max(100, "Percent is out of range"),
    ]),
  ),
  vm_hours_consumed: optionalMoney("VM hours"),
  license_seats_used: optionalInt(0, 1_000_000_000, "Licence seats"),
  api_units_consumed: optionalMoney("API units"),
  api_unit_label: z.preprocess(
    blankToNull,
    z.union([
      z.null(),
      z
        .string()
        .refine(
          (s) => (API_UNIT_LABELS as readonly string[]).includes(s),
          "Choose calls, tokens or credits",
        ),
    ]),
  ),
  is_hybrid: z.preprocess((v) => v === true || v === "true", z.boolean()),
});

export type AdrEntry = z.infer<typeof adrEntrySchema>;
/** Same rules as a new entry. */
export const adrEditSchema = adrEntrySchema;
export type AdrEdit = AdrEntry;

/** Non-blocking note when selling is below cost. Never a validation error. */
export function marginNote(
  input: number | null | undefined,
  selling: number | null | undefined,
): string | null {
  if (input == null || selling == null) return null;
  if (input > selling)
    return "Input cost is higher than selling cost. This is allowed and will be saved.";
  return null;
}

/** Non-blocking note when the end date is before the start date. Both dates are kept. */
export function dateOrderNote(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start || !end) return null;
  if (end < start) return "End date is before the start date. This is allowed and will be saved.";
  return null;
}

function privateExtras(v: AdrEntry) {
  const isPrivate = v.lab_type === "private_cloud";
  if (!isPrivate) {
    return {
      license_name: null,
      api_key_service: null,
      selling_price_per_user: null,
      vm_price_per_user: null,
      license_price_per_user: null,
      api_key_price_per_user: null,
      input_cost_per_user: null,
      input_cost_pct: null,
      vm_hours_consumed: null,
      license_seats_used: null,
      api_units_consumed: null,
      api_unit_label: null,
    };
  }
  return {
    license_name: v.license_name,
    api_key_service: v.api_key_service,
    selling_price_per_user: v.selling_price_per_user,
    vm_price_per_user: v.vm_price_per_user,
    license_price_per_user: v.license_name ? v.license_price_per_user : null,
    api_key_price_per_user: v.api_key_service ? v.api_key_price_per_user : null,
    input_cost_per_user: v.input_cost_per_user,
    input_cost_pct: v.input_cost_pct,
    vm_hours_consumed: v.vm_hours_consumed,
    license_seats_used: v.license_seats_used,
    api_units_consumed: v.api_units_consumed,
    api_unit_label: v.api_unit_label,
  };
}

/** Update payload. Blank fields are NULL, never 0. Public cloud clears the private-only columns. */
export function toTransactionUpdate(v: AdrEdit) {
  return {
    potential_id: v.potential_id,
    month: v.month,
    year: v.year,
    customer_id: null as string | null,
    customer_name: v.customer_name,
    lab_name: v.lab_name,
    lab_type: v.lab_type,
    repository_type: v.lab_type,
    cloud_provider: v.cloud_provider,
    system_config: v.lab_type === "private_cloud" ? v.system_config : null,
    line_of_business: v.line_of_business,
    start_date: v.start_date,
    end_date: v.end_date,
    total_users: v.total_users,
    input_cost: v.input_cost,
    selling_cost: v.selling_cost,
    lab_batch_id: v.lab_batch_id,
    ...privateExtras(v),
  };
}

/** The row written to public.transactions (created_by is the signed-in user). Blank fields are NULL, never 0. */
export function toTransactionInsert(v: AdrEntry, userId: string) {
  const isPrivate = v.lab_type === "private_cloud";
  const provider = v.cloud_provider && v.cloud_provider.trim() !== "" ? v.cloud_provider : null;
  return {
    potential_id: v.potential_id,
    month: v.month,
    year: v.year,
    customer_id: v.customer_id,
    customer_name: v.customer_name,
    lab_name: v.lab_name,
    lab_type: v.lab_type,
    repository_type: v.lab_type, // trigger normalizes
    cloud_provider: isPrivate ? (provider ?? PRIVATE_CLOUD_PROVIDER) : provider,
    system_config: isPrivate ? v.system_config : null,
    line_of_business: v.line_of_business,
    start_date: v.start_date,
    end_date: v.end_date,
    total_users: v.total_users,
    input_cost: v.input_cost,
    selling_cost: v.selling_cost,
    lab_batch_id: v.lab_batch_id,
    ...privateExtras(v),
    created_by: userId,
  };
}

/** Field → first message, for showing server-side rejections next to fields. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "_");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
