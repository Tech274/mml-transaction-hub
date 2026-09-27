// SCRUM-66: the ADR (manual transaction) entry rules in ONE place.
// Used by the form (react-hook-form + zodResolver) and re-checked on the server by
// createAdrTransaction, so the browser cannot skip them. Documented in
// docs/adr-entry-rules.md. Keep the three in step.
// No rule here may be stricter than what the form accepted before SCRUM-66 unless
// the database already rejects it (existing valid workflows must keep working).
import { z } from "zod";

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

/** A real calendar date written as YYYY-MM-DD (what <input type="date"> produces). */
const isoDate = z
  .string()
  .min(1, "Required")
  .refine((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Enter a valid date");

const amount = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} is required` })
    .finite("Enter a valid number")
    .nonnegative(`${label} cannot be negative`)
    .max(MAX_AMOUNT, `${label} is unrealistically high`);

export const adrEntrySchema = z
  .object({
    potential_id: z.string().trim().min(1, "Required").max(50, "At most 50 characters"),
    month: z.coerce.number().int().min(1, "Month must be 1–12").max(12, "Month must be 1–12"),
    year: z.coerce.number().int().min(2000, "Year must be 2000–2100").max(2100, "Year must be 2000–2100"),
    customer_id: z.string().uuid("Select a customer"),
    customer_name: z.string().trim().min(1, "Select a customer"),
    lab_name: z.string().trim().min(1, "Required").max(200, "At most 200 characters"),
    lab_type: z.enum(["public_cloud", "private_cloud"], { errorMap: () => ({ message: "Choose Public or Private Cloud" }) }),
    cloud_provider: z.string().optional(),
    system_config: z.string().optional(),
    line_of_business: z.string().min(1, "Required"),
    start_date: isoDate,
    end_date: isoDate,
    total_users: z.coerce.number({ invalid_type_error: "Total users is required" }).int("Whole numbers only").positive("Must be greater than zero"),
    input_cost: amount("Input cost"),
    selling_cost: amount("Selling cost"),
  })
  .superRefine((v, ctx) => {
    if (v.end_date && v.start_date && v.end_date < v.start_date) {
      ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date cannot be before start date" });
    }
    if (v.lab_type === "public_cloud" && !(PUBLIC_CLOUD_PROVIDERS as readonly string[]).includes(v.cloud_provider ?? "")) {
      ctx.addIssue({ code: "custom", path: ["cloud_provider"], message: "Required for Public Cloud (AWS, Azure, GCP)" });
    }
    if (v.lab_type === "private_cloud" && !(SYSTEM_CONFIG_OPTIONS as readonly string[]).includes(v.system_config ?? "")) {
      ctx.addIssue({ code: "custom", path: ["system_config"], message: "Required for Private Cloud" });
    }
    if (!(LINES_OF_BUSINESS as readonly string[]).includes(v.line_of_business)) {
      ctx.addIssue({ code: "custom", path: ["line_of_business"], message: "Choose VILT, Standalone or Integrated" });
    }
    if (v.input_cost > v.selling_cost) {
      ctx.addIssue({ code: "custom", path: ["input_cost"], message: "Input cost should not exceed selling cost (negative margin)" });
    }
  });

export type AdrEntry = z.infer<typeof adrEntrySchema>;

/** The row written to public.transactions (created_by is the signed-in user). */
export function toTransactionInsert(v: AdrEntry, userId: string) {
  const isPrivate = v.lab_type === "private_cloud";
  return {
    potential_id: v.potential_id,
    month: v.month,
    year: v.year,
    customer_id: v.customer_id,
    customer_name: v.customer_name,
    lab_name: v.lab_name,
    lab_type: v.lab_type,
    repository_type: v.lab_type, // trigger normalizes
    cloud_provider: isPrivate ? PRIVATE_CLOUD_PROVIDER : (v.cloud_provider ?? ""),
    system_config: isPrivate ? (v.system_config ?? null) : null,
    line_of_business: v.line_of_business,
    start_date: v.start_date,
    end_date: v.end_date,
    total_users: v.total_users,
    input_cost: v.input_cost,
    selling_cost: v.selling_cost,
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
