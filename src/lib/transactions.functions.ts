import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { AppError, dbError } from "@/lib/app-error";
import {
  adrEditSchema,
  adrEntrySchema,
  fieldErrors,
  toTransactionInsert,
  toTransactionUpdate,
} from "@/lib/adr-entry";
import { hasAnyRole } from "@/lib/require-role";
import { cleanCustomerName, normalizeName } from "@/lib/customer-normalize";

export const checkPotentialIdUnique = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { potentialId: string; excludeId?: string }) =>
    z.object({ potentialId: z.string().min(1), excludeId: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("transactions")
      .select("id")
      .eq("potential_id", data.potentialId)
      .limit(1);
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
    const display = cleanCustomerName(data.customerName);
    if (!display) throw new AppError("Customer name is blank", "validation");
    const normalized = normalizeName(display);
    const { data: existing } = await context.supabase
      .from("customers")
      .select("id, customer_name, is_active")
      .eq("normalized_name", normalized)
      .maybeSingle();
    if (existing) return existing;
    const { data: created, error } = await context.supabase
      .from("customers")
      .insert({ customer_name: display, normalized_name: normalized, created_by: context.userId })
      .select("id, customer_name, is_active")
      .single();
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
      throw new AppError(
        `${field === "_" ? "" : `${field.replace(/_/g, " ")}: `}${msg}`,
        "validation",
      );
    }
    const insert = toTransactionInsert(parsed.data, context.userId);
    if (insert.customer_name) {
      const display = cleanCustomerName(insert.customer_name);
      const normalized = normalizeName(display);
      const { data: existing } = await context.supabase
        .from("customers")
        .select("id, customer_name")
        .eq("normalized_name", normalized)
        .maybeSingle();
      if (existing) {
        insert.customer_id = existing.id;
        insert.customer_name = existing.customer_name;
      } else if (display) {
        const { data: created, error } = await context.supabase
          .from("customers")
          .insert({
            customer_name: display,
            normalized_name: normalized,
            created_by: context.userId,
          })
          .select("id, customer_name")
          .single();
        if (error) throw dbError(error, "transactions.createAdrTransaction.customer");
        insert.customer_id = created.id;
        insert.customer_name = created.customer_name;
      } else {
        insert.customer_id = null;
        insert.customer_name = null;
      }
    } else {
      insert.customer_id = null;
    }
    const { data: row, error } = await context.supabase
      .from("transactions")
      .insert(insert as never)
      .select("id")
      .single();
    if (error) throw dbError(error, "transactions.createAdrTransaction");
    await syncHybridTag(context, row.id as string, parsed.data.is_hybrid === true);
    if (insert.lab_batch_id) await recomputeBatch(context, insert.lab_batch_id);
    return { id: row.id as string };
  });

/**
 * SCRUM-103: save an existing transaction with blanks still blank.
 * Does not re-apply required-field or input<=selling rules. NULL is written
 * for an empty field, never 0.
 */
export const updateAdrTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d)
  .handler(async ({ data, context }) => {
    const idParsed = z.object({ id: z.string().uuid() }).safeParse(data);
    if (!idParsed.success) throw new AppError("Transaction id is missing", "validation");
    const parsed = adrEditSchema.safeParse(data);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      const [field, msg] = Object.entries(errs)[0] ?? ["_", "Invalid entry"];
      throw new AppError(
        `${field === "_" ? "" : `${field.replace(/_/g, " ")}: `}${msg}`,
        "validation",
      );
    }
    const patch = toTransactionUpdate(parsed.data);
    if (patch.customer_name) {
      const display = cleanCustomerName(patch.customer_name);
      const normalized = normalizeName(display);
      const { data: existing } = await context.supabase
        .from("customers")
        .select("id, customer_name")
        .eq("normalized_name", normalized)
        .maybeSingle();
      if (existing) {
        patch.customer_id = existing.id;
        patch.customer_name = existing.customer_name;
      } else if (display) {
        const { data: created, error } = await context.supabase
          .from("customers")
          .insert({
            customer_name: display,
            normalized_name: normalized,
            created_by: context.userId,
          })
          .select("id, customer_name")
          .single();
        if (error) throw dbError(error, "transactions.updateAdrTransaction.customer");
        patch.customer_id = created.id;
        patch.customer_name = created.customer_name;
      }
    }
    const { error } = await context.supabase
      .from("transactions")
      .update(patch as never)
      .eq("id", idParsed.data.id);
    if (error) throw dbError(error, "transactions.updateAdrTransaction");
    await syncHybridTag(context, idParsed.data.id, parsed.data.is_hybrid === true);
    if (patch.lab_batch_id) await recomputeBatch(context, patch.lab_batch_id);
    return { id: idParsed.data.id };
  });

async function syncHybridTag(
  context: { supabase: SupabaseClient<Database>; userId: string },
  transactionId: string,
  wanted: boolean,
) {
  const admin = await hasAnyRole(context, ["admin"]);
  if (!admin) return;
  if (wanted) {
    const { error } = await context.supabase
      .from("transaction_tags")
      .upsert(
        { transaction_id: transactionId, tag: "hybrid", created_by: context.userId },
        { onConflict: "transaction_id,tag" },
      );
    if (error) throw dbError(error, "transactions.hybridTag");
  } else {
    const { error } = await context.supabase
      .from("transaction_tags")
      .delete()
      .eq("transaction_id", transactionId)
      .eq("tag", "hybrid");
    if (error) throw dbError(error, "transactions.hybridTag");
  }
}

async function recomputeBatch(context: { supabase: SupabaseClient<Database> }, batchId: string) {
  const { error } = await context.supabase.rpc("request_lab_batch_recompute", {
    p_batch_id: batchId,
  });
  if (error) throw dbError(error, "transactions.recomputeBatch");
}
