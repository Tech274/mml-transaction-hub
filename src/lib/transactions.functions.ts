import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError, dbError } from "@/lib/app-error";
import { adrEntrySchema, fieldErrors, toTransactionInsert } from "@/lib/adr-entry";

export const checkPotentialIdUnique = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { potentialId: string; excludeId?: string }) =>
    z.object({ potentialId: z.string().min(1), excludeId: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("transactions").select("id").eq("potential_id", data.potentialId).limit(1);
    if (data.excludeId) q = q.neq("id", data.excludeId);
    const { data: rows, error } = await q;
    if (error) throw dbError(error, "transactions.checkPotentialIdUnique");
    return { unique: (rows ?? []).length === 0 };
  });

export const findOrCreateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerName: string }) =>
    z.object({ customerName: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const normalized = data.customerName.trim().replace(/\s+/g, " ").toLowerCase();
    const { data: existing } = await context.supabase
      .from("customers").select("id, customer_name, is_active")
      .eq("normalized_name", normalized).maybeSingle();
    if (existing) return existing;
    const { data: created, error } = await context.supabase
      .from("customers")
      .insert({ customer_name: data.customerName.trim(), normalized_name: normalized, created_by: context.userId })
      .select("id, customer_name, is_active").single();
    if (error) throw dbError(error, "transactions.findOrCreateCustomer");
    return created;
  });

/**
 * SCRUM-66: create one ADR transaction. The same rules as the form are checked
 * again here (the browser can be bypassed); RLS still decides who may insert.
 */
export const createAdrTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(async ({ data, context }) => {
    const parsed = adrEntrySchema.safeParse(data);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      const [field, msg] = Object.entries(errs)[0] ?? ["_", "Invalid entry"];
      throw new AppError(`${field === "_" ? "" : `${field.replace(/_/g, " ")}: `}${msg}`, "validation");
    }
    const { data: row, error } = await context.supabase
      .from("transactions")
      .insert(toTransactionInsert(parsed.data, context.userId))
      .select("id")
      .single();
    if (error) throw dbError(error, "transactions.createAdrTransaction");
    return { id: row.id as string };
  });
