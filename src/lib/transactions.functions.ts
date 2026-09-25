import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "@/lib/app-error";

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
