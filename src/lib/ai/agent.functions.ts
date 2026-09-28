import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError, dbError } from "@/lib/app-error";
import { APP_ROLES, requireRole, type AppRole } from "@/lib/require-role";
import { MODEL_CATALOG, PROVIDER_LABEL } from "./model-catalog";
import { providerFlags } from "./providers/env.server";
import { demoMockEnabled } from "./providers/env.server";
import { TOOL_CATALOG } from "./tool-catalog";
import { evalGate, runBuiltinEval } from "./evals";
import { adminDb, assertVersionInput, executeConfiguredRun, insertVersion, loadSettings } from "./run.server";

const roleEnum = z.enum(APP_ROLES);

type Ctx = { supabase: { from: (table: string) => any; rpc: (name: string, args: unknown) => any }; userId: string; claims?: { email?: string } };

async function callerRoles(ctx: Ctx): Promise<AppRole[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw dbError(error, "ai-agents.roles");
  return ((data ?? []) as { role: string }[])
    .map((row) => row.role)
    .filter((role): role is AppRole => (APP_ROLES as readonly string[]).includes(role));
}

function emailOf(ctx: Ctx): string | null {
  return ctx.claims?.email ?? null;
}

const versionShape = z.object({
  agentId: z.string().uuid().optional(),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).optional(),
  name: z.string().min(1).max(120),
  purpose: z.string().max(2000),
  instructions: z.string().max(8000),
  modelProvider: z.enum(["openai", "anthropic", "gemini", "openai_compat"]),
  modelId: z.string().min(1).max(80),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().min(1).max(8000),
  premiumApproved: z.boolean(),
  toolKeys: z.array(z.string()).max(12),
  runRoles: z.array(roleEnum).min(1),
  viewRoles: z.array(roleEnum).min(1),
  approveRoles: z.array(roleEnum).min(1),
  outputTypes: z.array(z.enum(["triage_note", "email_draft", "qa_answer", "report"])).min(1),
  perRunUsd: z.number().min(0).max(10),
  perDayRuns: z.number().int().min(1).max(500),
  perMonthUsd: z.number().min(0).max(100),
  changeNote: z.string().max(500).optional(),
});

export const getAgentAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can open the agent builder");
    const db = await adminDb();
    const [settings, agents, versions, tools] = await Promise.all([
      loadSettings(db),
      db.from("ai_agents").select("*").order("name"),
      db.from("ai_agent_versions").select("*").order("version", { ascending: false }),
      db.from("ai_agent_tools").select("version_id, tool_key"),
    ]);
    for (const result of [agents, versions, tools]) {
      if (result.error) throw dbError(result.error, "ai-agents.admin");
    }
    const flags = providerFlags();
    return {
      settings: {
        agents_enabled: settings.agents_enabled !== false,
        monthly_cap_usd: Number(settings.monthly_cap_usd ?? 10),
        per_run_cap_usd: Number(settings.per_run_cap_usd ?? 0.1),
        per_agent_month_cap_usd: Number(settings.per_agent_month_cap_usd ?? 5),
      },
      providers: flags,
      demo_mock: demoMockEnabled() && !flags.openai && !flags.anthropic && !flags.gemini && !flags.openai_compat,
      provider_labels: PROVIDER_LABEL,
      models: MODEL_CATALOG.map((model) => ({
        provider: model.provider,
        id: model.id,
        label: model.label,
        input_per_mtok_usd: model.inputPerMtokUsd,
        output_per_mtok_usd: model.outputPerMtokUsd,
        premium: model.premium,
        configured: flags[model.provider] || (demoMockEnabled() && !model.premium),
      })),
      tools: TOOL_CATALOG.map((tool) => ({
        key: tool.key,
        title: tool.title,
        description: tool.description,
        returns_money: tool.returnsMoney,
        reads_untrusted: tool.readsUntrusted,
        required_roles: tool.requiredRoles,
      })),
      agents: agents.data ?? [],
      versions: versions.data ?? [],
      version_tools: tools.data ?? [],
    };
  });

export const saveAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => versionShape.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can edit agents");
    assertVersionInput({
      modelProvider: data.modelProvider,
      modelId: data.modelId,
      premiumApproved: data.premiumApproved,
      toolKeys: data.toolKeys,
      viewRoles: data.viewRoles,
      runRoles: data.runRoles,
      instructions: data.instructions,
    });
    const db = await adminDb();
    const fields = {
      purpose: data.purpose,
      instructions: data.instructions,
      model_provider: data.modelProvider,
      model_id: data.modelId,
      temperature: data.temperature,
      max_output_tokens: data.maxOutputTokens,
      premium_approved: data.premiumApproved,
      run_roles: data.runRoles,
      view_roles: data.viewRoles,
      approve_roles: data.approveRoles,
      triggers: { manual: true },
      output_types: data.outputTypes,
      limits: { per_run_usd: data.perRunUsd, per_day_runs: data.perDayRuns, per_month_usd: data.perMonthUsd, max_tool_calls: 6, max_turns: 3 },
      eval_status: "pending",
      change_note: data.changeNote ?? null,
    };
    let agentId = data.agentId;
    let key = data.key ?? "";
    if (!agentId) {
      if (!data.key) throw new AppError("A new agent needs a key.", "invalid");
      const { data: created, error } = await db.from("ai_agents").insert({
        key: data.key,
        name: data.name,
        status: "draft",
        engine: "model",
        is_system: false,
        owner_id: ctx.userId,
      }).select("id, key").single();
      if (error) throw dbError(error, "ai-agents.create");
      agentId = created.id;
      key = created.key;
      await db.from("ai_cc_audit").insert({ actor_id: ctx.userId, actor_email: emailOf(ctx), agent_key: key, action: "config_create", detail: { name: data.name } });
    } else {
      const { data: agent, error } = await db.from("ai_agents").select("id, key, engine").eq("id", agentId).maybeSingle();
      if (error) throw dbError(error, "ai-agents.save");
      if (!agent) throw new AppError("That agent does not exist.", "not_found");
      if (agent.engine !== "model") throw new AppError("Rules agents keep their built-in behaviour. Pause or resume them instead.", "rules_engine");
      key = agent.key;
      await db.from("ai_agents").update({ name: data.name, updated_at: new Date().toISOString() }).eq("id", agentId);
    }
    const versionId = await insertVersion(db, agentId as string, fields, data.toolKeys, ctx.userId);
    if (!data.agentId) await db.from("ai_agents").update({ current_version_id: versionId }).eq("id", agentId);
    await db.from("ai_cc_audit").insert({
      actor_id: ctx.userId,
      actor_email: emailOf(ctx),
      agent_key: key,
      action: "config_version",
      agent_version_id: versionId,
      detail: { model: data.modelId, tools: data.toolKeys },
    });
    return { agent_id: agentId, version_id: versionId, key };
  });

export const setAgentLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    agentId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
    action: z.enum(["activate", "pause", "archive"]),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can change an agent's status");
    const db = await adminDb();
    const { data: agent, error } = await db.from("ai_agents").select("*").eq("id", data.agentId).maybeSingle();
    if (error) throw dbError(error, "ai-agents.lifecycle");
    if (!agent) throw new AppError("That agent does not exist.", "not_found");
    if (data.action === "pause" || data.action === "archive") {
      await db.from("ai_agents").update({ status: data.action === "pause" ? "paused" : "archived", updated_at: new Date().toISOString() }).eq("id", agent.id);
      await db.from("ai_cc_audit").insert({ actor_id: ctx.userId, actor_email: emailOf(ctx), agent_key: agent.key, action: data.action === "pause" ? "pause" : "archive", detail: {} });
      return { status: data.action === "pause" ? "paused" : "archived", eval: null };
    }
    const versionId = data.versionId ?? agent.current_version_id;
    if (!versionId) throw new AppError("Save a version before activating.", "invalid");
    let evalReport: { passRate: number; safetyPass: boolean } | null = null;
    if (agent.engine === "model") {
      if (agent.key !== "ticket_triage" && agent.key !== "dashboard_qa") {
        throw new AppError("Phase 1 can activate the ticket triage and dashboard Q&A agents.", "invalid");
      }
      evalReport = await runBuiltinEval(agent.key);
      await db.from("ai_agent_eval_runs").insert({
        version_id: versionId,
        results: { pass_rate: evalReport.passRate, safety_pass: evalReport.safetyPass },
        pass_rate: evalReport.passRate,
        safety_pass: evalReport.safetyPass,
        created_by: ctx.userId,
      });
      await db.from("ai_cc_audit").insert({ actor_id: ctx.userId, actor_email: emailOf(ctx), agent_key: agent.key, action: "eval_run", agent_version_id: versionId, detail: evalReport });
      if (!evalGate(evalReport)) throw new AppError("The test set did not pass, so the agent stays off.", "eval_failed");
    }
    await db.from("ai_agents").update({ status: "active", current_version_id: versionId, updated_at: new Date().toISOString() }).eq("id", agent.id);
    await db.from("ai_cc_audit").insert({ actor_id: ctx.userId, actor_email: emailOf(ctx), agent_key: agent.key, action: "activate", agent_version_id: versionId, detail: { eval: evalReport } });
    return { status: "active", eval: evalReport };
  });

export const testRunAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    agentKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    versionId: z.string().uuid().optional(),
    sample: z.string().min(1).max(4000),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can test-run an agent");
    const roles = await callerRoles(ctx);
    const db = await adminDb();
    return executeConfiguredRun({
      db,
      userClient: ctx.supabase,
      userId: ctx.userId,
      email: emailOf(ctx),
      roles,
      agentKey: data.agentKey,
      versionId: data.versionId,
      hint: data.sample,
      isTest: true,
    });
  });

export const runModelAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    agentKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    hint: z.string().max(4000).optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin", "ops_lead", "ops_user", "leadership", "finance"], "You do not have permission to run agents");
    const roles = await callerRoles(ctx);
    const db = await adminDb();
    return executeConfiguredRun({
      db,
      userClient: ctx.supabase,
      userId: ctx.userId,
      email: emailOf(ctx),
      roles,
      agentKey: data.agentKey,
      hint: data.hint ?? "",
      isTest: false,
    });
  });

export const getUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can open usage");
    const db = await adminDb();
    const settings = await loadSettings(db);
    const start = new Date();
    const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString();
    const { data: runs, error } = await db.from("ai_agent_runs").select("id, agent_id, status, cost_usd_est, tokens_in, tokens_out, model_id, started_at, error").gte("started_at", from).order("started_at", { ascending: false }).limit(500);
    if (error) throw dbError(error, "ai-agents.usage");
    const { data: agents, error: agentError } = await db.from("ai_agents").select("id, key, name, status");
    if (agentError) throw dbError(agentError, "ai-agents.usage");
    const rows = (runs ?? []) as { agent_id: string; status: string; cost_usd_est: number; tokens_in: number; tokens_out: number; model_id: string | null; error: string | null; started_at: string }[];
    const byAgent = new Map<string, { runs: number; cost: number; errors: number; blocked: number }>();
    for (const run of rows) {
      const bucket = byAgent.get(run.agent_id) ?? { runs: 0, cost: 0, errors: 0, blocked: 0 };
      bucket.runs += 1;
      bucket.cost += Number(run.cost_usd_est ?? 0);
      if (run.status === "error") bucket.errors += 1;
      if (run.status === "budget_blocked") bucket.blocked += 1;
      byAgent.set(run.agent_id, bucket);
    }
    const names = new Map(((agents ?? []) as { id: string; key: string; name: string; status: string }[]).map((agent) => [agent.id, agent]));
    const spent = rows.reduce((sum, run) => sum + Number(run.cost_usd_est ?? 0), 0);
    return {
      settings: {
        agents_enabled: settings.agents_enabled !== false,
        monthly_cap_usd: Number(settings.monthly_cap_usd ?? 10),
        per_run_cap_usd: Number(settings.per_run_cap_usd ?? 0.1),
        per_agent_month_cap_usd: Number(settings.per_agent_month_cap_usd ?? 5),
      },
      spent_usd: spent,
      providers: providerFlags(),
      agents: [...byAgent.entries()].map(([id, bucket]) => ({ ...(names.get(id) ?? { id, key: id, name: id, status: "" }), ...bucket })),
      blocked: rows.filter((run) => run.status === "budget_blocked").slice(0, 20).map((run) => ({
        at: run.started_at,
        model_id: run.model_id,
        error: run.error,
        agent: names.get(run.agent_id)?.name ?? run.agent_id,
      })),
      tokens_in: rows.reduce((sum, run) => sum + Number(run.tokens_in ?? 0), 0),
      tokens_out: rows.reduce((sum, run) => sum + Number(run.tokens_out ?? 0), 0),
    };
  });

export const setKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ enabled: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can change the kill switch");
    const db = await adminDb();
    const { error } = await db.from("ai_settings").update({ agents_enabled: data.enabled, updated_by: ctx.userId, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw dbError(error, "ai-agents.kill-switch");
    await db.from("ai_cc_audit").insert({ actor_id: ctx.userId, actor_email: emailOf(ctx), agent_key: null, action: "kill_switch", detail: { agents_enabled: data.enabled } });
    return { agents_enabled: data.enabled };
  });

export const updateCostSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    monthlyCapUsd: z.number().min(0).max(1000),
    perRunCapUsd: z.number().min(0).max(10),
    perAgentMonthCapUsd: z.number().min(0).max(1000),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireRole(ctx, ["admin"], "Only an admin can change cost caps");
    const db = await adminDb();
    const { error } = await db.from("ai_settings").update({
      monthly_cap_usd: data.monthlyCapUsd,
      per_run_cap_usd: data.perRunCapUsd,
      per_agent_month_cap_usd: data.perAgentMonthCapUsd,
      updated_by: ctx.userId,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) throw dbError(error, "ai-agents.caps");
    await db.from("ai_cc_audit").insert({ actor_id: ctx.userId, actor_email: emailOf(ctx), agent_key: null, action: "config_version", detail: data });
    return { ok: true };
  });

export const getKillSwitchBanner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data, error } = await ctx.supabase.from("ai_settings").select("agents_enabled, monthly_cap_usd").eq("id", 1).maybeSingle();
    if (error) return { agents_enabled: true, monthly_cap_usd: 10 };
    return { agents_enabled: data?.agents_enabled !== false, monthly_cap_usd: Number(data?.monthly_cap_usd ?? 10) };
  });
