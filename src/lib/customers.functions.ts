import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeName as normalize, normalizeEmail, normalizePhone } from "./customer-normalize";
import { dbError } from "@/lib/app-error";

const emailSchema = z.string().trim().email().max(255).optional().or(z.literal("")).transform((v) => (v ? v : null));
// Permissive international phone: digits, spaces, dashes, parentheses, plus. 7-20 chars.
const phoneSchema = z
  .string().trim().max(40)
  .refine((v) => v === "" || /^[+\d][\d\s\-().]{6,30}$/.test(v), { message: "Enter a valid phone number" })
  .optional().or(z.literal("")).transform((v) => (v ? v : null));

const customerInput = z.object({
  customer_name: z.string().trim().min(1, "Customer name is required").max(200),
  account_manager_id: z.string().uuid().nullable().optional(),
  account_manager_name: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  industry: z.string().trim().max(120).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  contact_email: emailSchema,
  contact_phone: phoneSchema,
  notes: z.string().trim().max(2000).optional().or(z.literal("")).transform((v) => (v ? v : null)),
});

// helpers imported above

async function assertContactUnique(
  supabase: any,
  email: string | null,
  phone: string | null,
  excludeId?: string,
) {
  const ne = normalizeEmail(email);
  const np = normalizePhone(phone);
  if (ne) {
    let q = supabase.from("customers").select("id, customer_name").eq("normalized_email", ne).limit(1);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (data) throw new Error(`Email already used by "${data.customer_name}".`);
  }
  if (np) {
    let q = supabase.from("customers").select("id, customer_name").eq("normalized_phone", np).limit(1);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (data) throw new Error(`Phone number already used by "${data.customer_name}".`);
  }
}

async function resolveAccountManagerName(
  supabase: any,
  amId: string | null | undefined,
  amName: string | null | undefined,
): Promise<string | null> {
  if (amId) {
    const { data, error } = await supabase
      .from("account_managers").select("name, is_active").eq("id", amId).maybeSingle();
    if (error) throw dbError(error, "customers.resolveAccountManagerName");
    if (!data) throw new Error("Selected account manager not found");
    if (!data.is_active) throw new Error("Selected account manager is inactive");
    return data.name;
  }
  return amName ?? null;
}

export const createCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => customerInput.parse(d))
  .handler(async ({ data, context }) => {
    const name = data.customer_name.trim();
    const normalized = normalize(name);
    const { data: dup } = await context.supabase
      .from("customers").select("id, customer_name").eq("normalized_name", normalized).maybeSingle();
    if (dup) throw new Error(`A customer named "${dup.customer_name}" already exists.`);
    await assertContactUnique(context.supabase, data.contact_email, data.contact_phone);
    const amName = await resolveAccountManagerName(context.supabase, data.account_manager_id, data.account_manager_name);
    const { data: created, error } = await context.supabase.from("customers").insert({
      customer_name: name,
      normalized_name: normalized,
      account_manager_name: amName,
      industry: data.industry,
      contact_email: data.contact_email,
      contact_phone: data.contact_phone,
      notes: data.notes,
      created_by: context.userId,
    }).select("id").single();
    if (error) throw dbError(error, "customers.createCustomerFn");
    return created;
  });

export const updateCustomerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid() }).merge(customerInput).parse(d),
  )
  .handler(async ({ data, context }) => {
    const name = data.customer_name.trim();
    const normalized = normalize(name);
    const { data: dup } = await context.supabase
      .from("customers").select("id, customer_name")
      .eq("normalized_name", normalized).neq("id", data.id).maybeSingle();
    if (dup) throw new Error(`Another customer named "${dup.customer_name}" already exists.`);
    await assertContactUnique(context.supabase, data.contact_email, data.contact_phone, data.id);
    const amName = await resolveAccountManagerName(context.supabase, data.account_manager_id, data.account_manager_name);
    const { error } = await context.supabase.from("customers").update({
      customer_name: name,
      normalized_name: normalized,
      account_manager_name: amName,
      industry: data.industry,
      contact_email: data.contact_email,
      contact_phone: data.contact_phone,
      notes: data.notes,
    }).eq("id", data.id);
    if (error) throw dbError(error, "customers.updateCustomerFn");
    return { ok: true };
  });

export const setCustomerActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean; reason?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      active: z.boolean(),
      reason: z.string().trim().min(1, "Reason is required").max(500, "Reason must be 500 characters or fewer")
        .optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Require a non-empty, bounded reason when deactivating — enforced
    // before any update that would trigger the audit log trigger.
    let reason: string | null = null;
    if (!data.active) {
      const r = (data.reason ?? "").trim();
      if (r.length === 0) throw new Error("A deactivation reason is required.");
      if (r.length > 500) throw new Error("Deactivation reason must be 500 characters or fewer.");
      reason = r;
    }
    const { error } = await context.supabase.from("customers").update({
      is_active: data.active,
      deactivation_reason: reason,
    }).eq("id", data.id);
    if (error) throw dbError(error, "customers.setCustomerActiveFn");
    return { ok: true };
  });

export const upsertAccountManagerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; email?: string | null }) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(255).optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const normalized = normalize(data.name);
    const { data: existing } = await context.supabase
      .from("account_managers").select("id, name, is_active").eq("normalized_name", normalized).maybeSingle();
    if (existing) return existing;
    const { data: created, error } = await context.supabase
      .from("account_managers")
      .insert({ name: data.name.trim(), normalized_name: normalized, email: data.email, created_by: context.userId })
      .select("id, name, is_active").single();
    if (error) throw dbError(error, "customers.upsertAccountManagerFn");
    return created;
  });

export const setAccountManagerActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; active: boolean }) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("account_managers").update({ is_active: data.active }).eq("id", data.id);
    if (error) throw dbError(error, "customers.setAccountManagerActiveFn");
    return { ok: true };
  });
