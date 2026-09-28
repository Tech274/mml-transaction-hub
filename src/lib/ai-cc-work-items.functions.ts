import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { AppError, dbError, logIfError } from "@/lib/app-error";
import { requireRole } from "@/lib/require-role";
import { DECIDE_ROLES } from "@/lib/ai-cc-policy";
import {
  isAiCcAutoAssignEnabled,
  pickWorkerForAssignment,
  requiresHumanApproval,
  statusAfterPreparation,
  type AiCcWorkType,
  type AiCcWorker,
} from "@/lib/ai-cc-auto-assignment";

const AGENT_KEYS = ["generalist", "support", "cost_adr"] as const;
const WORK_TYPES = ["publish", "deploy", "live_write", "task_create", "task_update", "analysis", "other"] as const;

type AgentKey = (typeof AGENT_KEYS)[number];
type Ctx = { supabase: SupabaseClient<Database>; userId: string; claims?: unknown };

const workerRowSchema = z.object({
  id: z.string().uuid(),
  agent_key: z.enum(AGENT_KEYS),
  is_active: z.boolean(),
  current_load: z.number().int().nonnegative(),
  last_assigned_at: z.string().datetime().nullable(),
});

function actorEmail(context: Ctx): string | null {
  const claims = context.claims as { email?: unknown } | undefined;
  return typeof claims?.email === "string" ? claims.email : null;
}

async function admin(): Promise<SupabaseClient<Database>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function toWorkType(v: string): AiCcWorkType {
  return v as AiCcWorkType;
}

export const enqueueAiWorkItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().trim().min(5).max(200),
        work_type: z.enum(WORK_TYPES),
        payload: z.record(z.string(), z.unknown()).optional(),
        requested_agent_key: z.enum(AGENT_KEYS).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireRole(ctx, DECIDE_ROLES, "You do not have permission to queue AI work");
    const sb = await admin();
    const email = actorEmail(ctx);
    const approvalRequired = requiresHumanApproval(toWorkType(data.work_type));

    const { data: inserted, error: insertErr } = await sb
      .from("ai_cc_work_items")
      .insert({
        title: data.title,
        work_type: data.work_type,
        payload: (data.payload ?? {}) as Json,
        status: "queued",
        requested_agent_key: data.requested_agent_key ?? null,
        requires_approval: approvalRequired,
        created_by: ctx.userId,
        created_by_email: email,
      })
      .select("id, status, requires_approval")
      .single();
    if (insertErr) throw dbError(insertErr, "ai-cc-work-items.enqueue");

    const workItemId = String(inserted.id);

    if (!isAiCcAutoAssignEnabled(process.env)) {
      return {
        id: workItemId,
        status: "queued",
        auto_assigned: false,
        feature_flag: false,
        approval_required: approvalRequired,
      };
    }

    const { data: workerRows, error: workerErr } = await sb
      .from("ai_cc_agent_workers")
      .select("id, agent_key, is_active, current_load, last_assigned_at")
      .eq("is_active", true);
    if (workerErr) throw dbError(workerErr, "ai-cc-work-items.workers");
    const workers = z.array(workerRowSchema).parse(workerRows ?? []) as AiCcWorker[];
    const picked = pickWorkerForAssignment(workers, data.requested_agent_key ?? null);
    if (!picked) {
      return {
        id: workItemId,
        status: "queued",
        auto_assigned: false,
        feature_flag: true,
        approval_required: approvalRequired,
      };
    }

    const nextStatus = statusAfterPreparation(toWorkType(data.work_type));
    const nowIso = new Date().toISOString();

    const updateItem = await sb
      .from("ai_cc_work_items")
      .update({
        assigned_worker_id: picked.id,
        assigned_agent_key: picked.agent_key,
        status: nextStatus,
        updated_at: nowIso,
      })
      .eq("id", workItemId);
    if (updateItem.error) throw dbError(updateItem.error, "ai-cc-work-items.assign");

    const updateWorker = await sb
      .from("ai_cc_agent_workers")
      .update({
        current_load: picked.current_load + 1,
        last_assigned_at: nowIso,
      })
      .eq("id", picked.id);
    if (updateWorker.error) throw dbError(updateWorker.error, "ai-cc-work-items.worker-load");

    const audit = await sb.from("ai_cc_audit").insert({
      actor_id: ctx.userId,
      actor_email: email,
      agent_key: picked.agent_key,
      action: "run",
      detail: {
        work_item_id: workItemId,
        work_type: data.work_type,
        assigned_worker_id: picked.id,
        status: nextStatus,
        approval_required: approvalRequired,
      },
    });
    logIfError(audit, "ai-cc-work-items.audit-assignment");

    return {
      id: workItemId,
      status: nextStatus,
      auto_assigned: true,
      feature_flag: true,
      approval_required: approvalRequired,
      assigned_agent_key: picked.agent_key,
    };
  });

export const approveAiWorkItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireRole(ctx, ["admin"], "Only admin can approve live AI work");
    const sb = await admin();
    const email = actorEmail(ctx);

    const { data: row, error: rowErr } = await sb
      .from("ai_cc_work_items")
      .select("id, status, work_type, assigned_agent_key")
      .eq("id", data.id)
      .maybeSingle();
    if (rowErr) throw dbError(rowErr, "ai-cc-work-items.approve");
    if (!row) throw new AppError("Work item not found", "not_found");
    if (String(row.status) !== "needs_approval") {
      throw new AppError(`Work item is ${String(row.status)}, not waiting for admin approval`, "invalid_state");
    }

    const approvedAt = new Date().toISOString();
    const up = await sb
      .from("ai_cc_work_items")
      .update({
        status: "approved",
        approved_by: ctx.userId,
        approved_at: approvedAt,
        approval_note: data.note ?? null,
        updated_at: approvedAt,
      })
      .eq("id", data.id);
    if (up.error) throw dbError(up.error, "ai-cc-work-items.approve-update");

    const audit = await sb.from("ai_cc_audit").insert({
      actor_id: ctx.userId,
      actor_email: email,
      agent_key: row.assigned_agent_key,
      action: "confirm",
      detail: {
        work_item_id: data.id,
        work_type: row.work_type,
        approval_note: data.note ?? null,
      },
    });
    logIfError(audit, "ai-cc-work-items.audit-approve");

    return { ok: true, status: "approved" };
  });
