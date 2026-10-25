import { AppError, dbError } from "@/lib/app-error";
import { audienceMaySeeMoney, roleMaySeeMoney } from "./money-visibility";
import { decideRun, limitsFrom, shouldTripBreaker } from "./limits";
import { findModel, type ModelProviderId } from "./model-catalog";
import { resolveProvider } from "./providers/index.server";
import { demoMockEnabled, providerFlags } from "./providers/env.server";
import { runModelLoop } from "./engine";
import { accessFromSupabase } from "./tools/user-access";
import { audienceAllowsTools, toolByKey } from "./tool-catalog";
import { APP_ROLES, type AppRole } from "@/lib/require-role";

type Row = Record<string, any>;
type Db = { from: (table: string) => any };

const DECIDE: AppRole[] = ["admin", "ops_lead", "ops_user", "leadership", "finance"];

function monthStart(): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function hourAgo(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

function tenMinutesAgo(): string {
  return new Date(Date.now() - 10 * 60 * 1000).toISOString();
}

export async function adminDb(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

async function audit(db: Db, row: { actor_id: string; actor_email: string | null; agent_key: string | null; action: string; detail?: Row; run_id?: string | null; agent_version_id?: string | null }) {
  await db.from("ai_cc_audit").insert({
    actor_id: row.actor_id,
    actor_email: row.actor_email,
    agent_key: row.agent_key,
    action: row.action,
    detail: row.detail ?? {},
    run_id: row.run_id ?? null,
    agent_version_id: row.agent_version_id ?? null,
  });
}

export async function loadSettings(db: Db): Promise<Row> {
  const { data, error } = await db.from("ai_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw dbError(error, "ai-agents.settings");
  return data ?? { agents_enabled: true, monthly_cap_usd: 10, per_run_cap_usd: 0.1, per_agent_month_cap_usd: 5 };
}

async function recentRuns(db: Db): Promise<Row[]> {
  const { data, error } = await db.from("ai_agent_runs").select("agent_id, status, cost_usd_est, started_at, invoked_by, finished_at").gte("started_at", monthStart()).limit(5000);
  if (error) throw dbError(error, "ai-agents.runs");
  return (data ?? []) as Row[];
}

export interface LoadedAgent {
  agent: Row;
  version: Row;
  toolKeys: string[];
}

export async function loadAgent(db: Db, key: string, versionId?: string): Promise<LoadedAgent> {
  const { data: agent, error } = await db.from("ai_agents").select("*").eq("key", key).maybeSingle();
  if (error) throw dbError(error, "ai-agents.load");
  if (!agent) throw new AppError("That agent does not exist.", "not_found");
  const versionQuery = db.from("ai_agent_versions").select("*").eq("agent_id", agent.id);
  const { data: version, error: versionError } = versionId
    ? await versionQuery.eq("id", versionId).maybeSingle()
    : await versionQuery.eq("id", agent.current_version_id).maybeSingle();
  if (versionError) throw dbError(versionError, "ai-agents.version");
  if (!version) throw new AppError("That agent has no saved version.", "not_found");
  const { data: tools, error: toolError } = await db.from("ai_agent_tools").select("tool_key").eq("version_id", version.id);
  if (toolError) throw dbError(toolError, "ai-agents.tools");
  return { agent, version, toolKeys: ((tools ?? []) as Row[]).map((tool) => String(tool.tool_key)) };
}

export async function executeConfiguredRun(opts: {
  db: Db;
  userClient: { from: (table: string) => any };
  userId: string;
  email: string | null;
  roles: AppRole[];
  agentKey: string;
  versionId?: string;
  hint: string;
  isTest: boolean;
}): Promise<{ run_id: string | null; status: string; output: Row | null; steps: Row[]; error: string | null; inbox: number }> {
  const loaded = await loadAgent(opts.db, opts.agentKey, opts.versionId);
  if (loaded.agent.engine !== "model") throw new AppError("This agent uses the rules engine.", "rules_engine");
  if (!opts.isTest && loaded.agent.status !== "active") {
    throw new AppError(`This agent is ${loaded.agent.status}. An admin has to activate it before it can run.`, "agent_inactive");
  }
  const runRoles = (loaded.version.run_roles ?? []) as string[];
  if (!opts.isTest && !runRoles.some((role) => opts.roles.includes(role as AppRole))) {
    throw new AppError("You do not have permission to run this agent.", "forbidden");
  }
  const settings = await loadSettings(opts.db);
  const limits = limitsFrom(loaded.version.limits);
  const runs = await recentRuns(opts.db);
  const agentRuns = runs.filter((run) => run.agent_id === loaded.agent.id);
  const decision = decideRun({
    agentsEnabled: settings.agents_enabled !== false,
    perRunCapUsd: Number(settings.per_run_cap_usd ?? limits.perRunUsd),
    monthlyCapUsd: Number(settings.monthly_cap_usd ?? 10),
    perAgentMonthCapUsd: Math.min(Number(settings.per_agent_month_cap_usd ?? limits.perMonthUsd), limits.perMonthUsd),
    monthSpendUsd: runs.reduce((sum, run) => sum + Number(run.cost_usd_est ?? 0), 0),
    agentMonthSpendUsd: agentRuns.reduce((sum, run) => sum + Number(run.cost_usd_est ?? 0), 0),
    agentDayRuns: agentRuns.filter((run) => Date.now() - new Date(run.started_at).getTime() < 24 * 60 * 60 * 1000).length,
    agentDayCap: limits.perDayRuns,
    userHourRuns: runs.filter((run) => run.invoked_by === opts.userId && run.started_at >= hourAgo()).length,
    userHourCap: 30,
    runningNow: runs.filter((run) => run.status === "running").length,
    maxConcurrent: 3,
    estimatedRunUsd: 0.02,
  });

  const providerId = loaded.version.model_provider as ModelProviderId;
  const model = findModel(providerId, String(loaded.version.model_id ?? ""));
  const viewRoles = (loaded.version.view_roles ?? []) as string[];
  const allowMoney = roleMaySeeMoney(opts.roles) && audienceMaySeeMoney(viewRoles);
  const insertBase = {
    agent_id: loaded.agent.id,
    version_id: loaded.version.id,
    trigger_kind: opts.isTest ? "test" : "manual",
    trigger_ref: { hint: opts.hint.slice(0, 500) },
    invoked_by: opts.userId,
    run_as: "user",
    view_roles: viewRoles,
    model_id: loaded.version.model_id,
    input: { hint: opts.hint.slice(0, 2000) },
  };

  if (!decision.ok) {
    const { data, error } = await opts.db.from("ai_agent_runs").insert({ ...insertBase, status: decision.status, error: decision.reason, finished_at: new Date().toISOString() }).select("id").single();
    if (error) throw dbError(error, "ai-agents.run");
    await audit(opts.db, { actor_id: opts.userId, actor_email: opts.email, agent_key: opts.agentKey, action: decision.status === "budget_blocked" ? "budget_block" : "run", detail: { reason: decision.reason }, agent_version_id: loaded.version.id });
    return { run_id: data.id, status: decision.status, output: null, steps: [], error: decision.reason, inbox: 0 };
  }

  const provider = resolveProvider(providerId);
  if (!provider || !model) {
    throw new AppError("That model's provider is not configured on the server. An admin adds the key as a secret. Nothing was sent.", "provider_unconfigured");
  }

  const { data: created, error: createError } = await opts.db.from("ai_agent_runs").insert({ ...insertBase, status: "running" }).select("id").single();
  if (createError) throw dbError(createError, "ai-agents.run");
  const runId = created.id as string;

  let enabled = settings.agents_enabled !== false;
  const recentErrors = runs.filter((run) => run.status === "error" && run.started_at >= tenMinutesAgo()).length;
  const ops = ["admin", "ops_lead", "ops_user"].some((role) => opts.roles.includes(role as AppRole));
  const result = await runModelLoop({
    provider,
    agentKey: opts.agentKey,
    purpose: String(loaded.version.purpose ?? ""),
    instructions: String(loaded.version.instructions ?? ""),
    model: String(loaded.version.model_id),
    temperature: Number(loaded.version.temperature ?? 0.2),
    maxOutputTokens: Number(loaded.version.max_output_tokens ?? 2000),
    outputTypes: (loaded.version.output_types ?? []) as string[],
    toolKeys: loaded.toolKeys,
    userText: opts.hint,
    price: { inputPerMtokUsd: model.inputPerMtokUsd, outputPerMtokUsd: model.outputPerMtokUsd },
    perRunCapUsd: Number(settings.per_run_cap_usd ?? limits.perRunUsd),
    maxToolCalls: limits.maxToolCalls,
    maxTurns: limits.maxTurns,
    isEnabled: async () => {
      const current = await loadSettings(opts.db);
      enabled = current.agents_enabled !== false;
      return enabled;
    },
    allowMoney,
    toolContext: {
      access: accessFromSupabase(opts.userClient),
      roles: opts.roles,
      moneyVisible: allowMoney,
      pinnedCompany: null,
      fetchConversations: ops
        ? async (ticketId: number) => {
            const { fetchTicketConversations } = await import("@/lib/freshdesk.server");
            const rows = await fetchTicketConversations(ticketId);
            return rows.map((row) => ({ body_text: row.body_text, from_email: row.from_email }));
          }
        : undefined,
    },
  });

  if (result.steps.length) {
    await opts.db.from("ai_agent_run_steps").insert(result.steps.map((step, seq) => ({
      run_id: runId,
      seq,
      kind: step.kind,
      name: step.name,
      input_redacted: step.inputRedacted ?? {},
      output_redacted: step.outputRedacted ?? {},
      tokens_in: step.tokensIn,
      tokens_out: step.tokensOut,
      cost_usd_est: step.costUsd,
      duration_ms: step.durationMs,
      status: step.status,
      error: step.error,
    })));
  }

  let inboxCount = 0;
  if (result.status === "done" && !opts.isTest) {
    const { data: items, error: inboxError } = await opts.db.from("ai_cc_inbox").insert(result.inbox.map((item) => ({
      agent_key: opts.agentKey,
      item_type: item.item_type,
      title: item.title,
      summary: item.summary,
      payload: item.payload,
      status: "pending",
      contains_money: item.contains_money,
      agent_run_id: runId,
      agent_version_id: loaded.version.id,
      view_roles: viewRoles,
      approve_roles: loaded.version.approve_roles,
      model_id: loaded.version.model_id,
      ai_generated: true,
    }))).select("id");
    if (inboxError) throw dbError(inboxError, "ai-agents.inbox");
    inboxCount = (items ?? []).length;
    for (const item of (items ?? []) as Row[]) {
      await audit(opts.db, { actor_id: opts.userId, actor_email: opts.email, agent_key: opts.agentKey, action: "propose", run_id: null, detail: { inbox_id: item.id, ai_generated: true }, agent_version_id: loaded.version.id });
    }
  }

  const trip = result.tripBreaker || (result.status === "error" && shouldTripBreaker({ recentProviderErrors: recentErrors + 1 }));
  if (trip && enabled) {
    await opts.db.from("ai_settings").update({ agents_enabled: false, updated_by: opts.userId, updated_at: new Date().toISOString() }).eq("id", 1);
    await audit(opts.db, { actor_id: opts.userId, actor_email: opts.email, agent_key: opts.agentKey, action: "kill_switch", detail: { reason: "provider errors tripped the kill switch" } });
  }

  await opts.db.from("ai_agent_runs").update({
    status: result.status,
    finished_at: new Date().toISOString(),
    tokens_in: result.tokensIn,
    tokens_out: result.tokensOut,
    cost_usd_est: result.costUsd,
    error: result.error,
  }).eq("id", runId);

  await audit(opts.db, {
    actor_id: opts.userId,
    actor_email: opts.email,
    agent_key: opts.agentKey,
    action: opts.isTest ? "test_run" : "run",
    detail: { status: result.status, inbox: inboxCount, cost_usd_est: result.costUsd },
    agent_version_id: loaded.version.id,
  });

  return {
    run_id: runId,
    status: result.status,
    output: result.output,
    steps: result.steps.map((step) => ({ kind: step.kind, name: step.name, status: step.status, message: (step.outputRedacted as Row | null)?.message ?? null })),
    error: result.error,
    inbox: inboxCount,
  };
}

export function assertVersionInput(input: {
  modelProvider: string;
  modelId: string;
  premiumApproved: boolean;
  toolKeys: string[];
  viewRoles: string[];
  runRoles: string[];
  instructions: string;
}) {
  if (input.instructions.length > 8000) throw new AppError("Instructions are longer than 8,000 characters.", "invalid");
  if (input.runRoles.includes("viewer")) throw new AppError("Viewers cannot run agents.", "invalid");
  for (const role of [...input.runRoles, ...input.viewRoles]) {
    if (!(APP_ROLES as readonly string[]).includes(role)) throw new AppError("Unknown role.", "invalid");
  }
  for (const role of input.runRoles) {
    if (!DECIDE.includes(role as AppRole)) throw new AppError("Run roles must be inside the existing decide roles.", "invalid");
  }
  const model = findModel(input.modelProvider, input.modelId);
  if (!model) throw new AppError("Choose a model from the approved list.", "invalid");
  if (model.premium && !input.premiumApproved) throw new AppError("That premium model needs a recorded approval before it can be saved.", "premium");
  const flags = providerFlags();
  const configured = flags[input.modelProvider as keyof typeof flags];
  if (!configured && !demoMockEnabled()) throw new AppError("That provider is not configured. Add its key on the server first.", "provider_unconfigured");
  for (const key of input.toolKeys) {
    const tool = toolByKey(key);
    if (!tool || tool.phase !== 1) throw new AppError(`The tool ${key} is not available.`, "invalid");
  }
  const audience = audienceAllowsTools(input.toolKeys, input.viewRoles);
  if (audience) throw new AppError(audience, "audience");
}

export async function insertVersion(db: Db, agentId: string, fields: Row, toolKeys: string[], userId: string): Promise<string> {
  const { data: existing, error } = await db.from("ai_agent_versions").select("version").eq("agent_id", agentId).order("version", { ascending: false }).limit(1);
  if (error) throw dbError(error, "ai-agents.version");
  const version = Number(existing?.[0]?.version ?? 0) + 1;
  const { data, error: insertError } = await db.from("ai_agent_versions").insert({ ...fields, agent_id: agentId, version, created_by: userId }).select("id").single();
  if (insertError) throw dbError(insertError, "ai-agents.version");
  if (toolKeys.length) {
    const { error: toolError } = await db.from("ai_agent_tools").insert(toolKeys.map((tool_key) => ({ version_id: data.id, tool_key })));
    if (toolError) throw dbError(toolError, "ai-agents.tools");
  }
  return data.id as string;
}
