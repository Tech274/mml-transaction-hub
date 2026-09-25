import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { TICKET_OPS_ROLES, canClaimAgent } from "@/lib/ticket-access";

export interface TicketRow {
  id: number;
  subject: string | null;
  status: string | null;
  priority: string | null;
  type: string | null;
  source: string | null;
  requester_name: string | null;
  requester_email: string | null;
  company_name: string | null;
  agent_name: string | null;
  group_name: string | null;
  tags: string[];
  due_by: string | null;
  is_escalated: boolean;
  description_text: string | null;
  ticket_created_at: string | null;
  ticket_updated_at: string | null;
  synced_at: string;
}

export interface TicketsOverview {
  tickets: TicketRow[];
  total: number;
  counts: {
    open: number;
    pending: number;
    resolved: number;
    closed: number;
    escalated: number;
    overdue: number;
  };
  by_status: { name: string; value: number }[];
  by_priority: { name: string; value: number }[];
  by_agent: { name: string; value: number }[];
  by_group: { name: string; value: number }[];
  by_month: { month: string; value: number }[];
  last_synced_at: string | null;
  connection: { ok: boolean; message: string; domain?: string };
}

const OPEN_LIKE = ["Open", "Waiting on Customer", "Waiting on Third Party"];

function tally(rows: TicketRow[], pick: (r: TicketRow) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = pick(r) || "Unassigned";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export const getTicketsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TicketsOverview> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    // PostgREST caps a single response at 1000 rows, so page through.
    const PAGE = 1000;
    const all: TicketRow[] = [];
    for (let from = 0; from < 5000; from += PAGE) {
      const { data, error } = await sb
        .from("freshdesk_tickets")
        .select("*")
        .order("ticket_created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as TicketRow[];
      all.push(...page);
      if (page.length < PAGE) break;
    }
    const rows = all.map((r) => ({ ...r, tags: r.tags ?? [] }));


    const now = Date.now();
    const counts = {
      open: rows.filter((r) => OPEN_LIKE.includes(r.status ?? "")).length,
      pending: rows.filter((r) => r.status === "Pending").length,
      resolved: rows.filter((r) => r.status === "Resolved").length,
      closed: rows.filter((r) => r.status === "Closed").length,
      escalated: rows.filter((r) => r.is_escalated).length,
      overdue: rows.filter(
        (r) =>
          r.due_by &&
          new Date(r.due_by).getTime() < now &&
          !["Resolved", "Closed"].includes(r.status ?? ""),
      ).length,
    };

    const monthMap = new Map<string, number>();
    for (const r of rows) {
      if (!r.ticket_created_at) continue;
      const d = new Date(r.ticket_created_at);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
    }

    const { checkFreshdeskConnection } = await import("@/lib/freshdesk.server");
    const connection = await checkFreshdeskConnection();

    return {
      tickets: rows,
      total: rows.length,
      counts,
      by_status: tally(rows, (r) => r.status),
      by_priority: tally(rows, (r) => r.priority),
      by_agent: tally(rows, (r) => r.agent_name).slice(0, 10),
      by_group: tally(rows, (r) => r.group_name).slice(0, 10),
      by_month: [...monthMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([month, value]) => ({ month, value })),
      last_synced_at: rows.reduce<string | null>(
        (acc, r) => (!acc || r.synced_at > acc ? r.synced_at : acc),
        null,
      ),
      connection,
    };
  });

/** Manual sync — admins and ops leads. */
export const syncFreshdeskNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { maxPages?: number }) =>
    z.object({ maxPages: z.number().int().min(1).max(300).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["admin", "ops_lead"],
    } as never);
    if (!allowed) throw new Error("Only admins and ops leads can sync Freshdesk tickets");
    const { runFreshdeskSync } = await import("@/lib/freshdesk.server");
    return runFreshdeskSync({
      ...(data.maxPages ? { maxPages: data.maxPages } : {}),
      trigger_source: "manual",
      triggered_by: context.userId,
      triggered_by_email: (context.claims as { email?: string } | null)?.email ?? null,
    });

  });

/* ---------------------------------------------------------------------------
 * Agent identity, ticket history and the resolution flow
 * ------------------------------------------------------------------------- */

export interface AgentOption {
  id: number;
  name: string;
  email: string | null;
}

export interface AgentIdentity {
  agent_name: string;
  agent_id: number | null;
  auto_matched: boolean;
}

export interface TicketActionEntry {
  id: string;
  ticket_id: number;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  resolution_note: string | null;
  actor_email: string | null;
  created_at: string;
}

async function isTicketOps(context: { supabase: any; userId: string }): Promise<boolean> {
  const { data: allowed, error } = await context.supabase.rpc("has_any_role", {
    _user_id: context.userId,
    _roles: [...TICKET_OPS_ROLES],
  } as never);
  if (error) throw new Error("Could not check your permissions. Please try again.");
  return allowed === true;
}

async function isAdmin(context: { supabase: any; userId: string }): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  } as never);
  if (error) throw new Error("Could not check your permissions. Please try again.");
  return data === true;
}

async function assertTicketActor(context: { supabase: any; userId: string }) {
  if (!(await isTicketOps(context))) throw new Error("You do not have permission to update support tickets");
}

/** Helpdesk agents plus the caller's saved (or auto-matched) identity. */
export const getAgentDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ agents: AgentOption[]; identity: AgentIdentity | null }> => {
    const sbUser = context.supabase as unknown as { from: (t: string) => any };
    // SCRUM-91 (G-06): the Freshdesk agent directory (names + emails) is for ops roles only.
    if (!(await isTicketOps(context as never))) {
      const { data: savedOnly } = await sbUser
        .from("agent_identities")
        .select("agent_name, agent_id, auto_matched")
        .eq("user_id", context.userId)
        .maybeSingle();
      return { agents: [], identity: (savedOnly as AgentIdentity | null) ?? null };
    }
    const { listFreshdeskAgents } = await import("@/lib/freshdesk.server");
    let agents: AgentOption[] = [];
    try {
      agents = (await listFreshdeskAgents()).map((a) => ({ id: a.id, name: a.name, email: a.email }));
    } catch {
      agents = [];
    }

    const sb = context.supabase as unknown as { from: (t: string) => any };
    const { data: saved } = await sb
      .from("agent_identities")
      .select("agent_name, agent_id, auto_matched")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (saved) return { agents, identity: saved as AgentIdentity };

    // Nothing saved yet — try matching the signed-in email to an agent.
    const email = (context.claims as { email?: string } | undefined)?.email?.toLowerCase();
    const match = email ? agents.find((a) => a.email?.toLowerCase() === email) : undefined;
    if (!match) return { agents, identity: null };

    await sb
      .from("agent_identities")
      .upsert({ user_id: context.userId, agent_name: match.name, agent_id: match.id, auto_matched: true });
    return { agents, identity: { agent_name: match.name, agent_id: match.id, auto_matched: true } };
  });

/**
 * Manually choose which helpdesk agent the signed-in user is.
 * SCRUM-102 (G-25): the agent must exist in Freshdesk and its email must match
 * the caller's sign-in email (admins may choose any existing agent). The stored
 * name always comes from Freshdesk, never from the caller.
 */
export const setMyAgentIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { agentName: string; agentId?: number | null }) =>
    z.object({ agentName: z.string().min(1), agentId: z.number().int().nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await isTicketOps(context as never))) {
      throw new Error("Only ops roles can link a helpdesk agent identity");
    }
    if (data.agentId == null) throw new Error("Pick an agent from the Freshdesk list");

    const { listFreshdeskAgents } = await import("@/lib/freshdesk.server");
    let agents: AgentOption[];
    try {
      agents = (await listFreshdeskAgents()).map((a) => ({ id: a.id, name: a.name, email: a.email }));
    } catch {
      throw new Error("The Freshdesk agent list is unavailable right now. Please try again later.");
    }
    const agent = agents.find((a) => a.id === data.agentId);
    const callerEmail = (context.claims as { email?: string } | undefined)?.email ?? null;
    const verdict = canClaimAgent({ callerEmail, isAdmin: await isAdmin(context as never), agent });
    if (!verdict.ok) throw new Error(verdict.reason);

    const sb = context.supabase as unknown as { from: (t: string) => any };
    const { error } = await sb.from("agent_identities").upsert({
      user_id: context.userId,
      agent_name: agent!.name,
      agent_id: agent!.id,
      auto_matched: false,
    });
    if (error) throw new Error("Could not save your agent identity. Please try again.");
    return { ok: true };
  });

/** Conversation trail from Freshdesk merged with in-app actions. */
export const getTicketHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ticketId: number }) => z.object({ ticketId: z.number().int().positive() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as { from: (t: string) => any };

    // SCRUM-91 (G-06): only tickets that were synced into this app (the Cloud Labs
    // group) can be looked up. The check uses the caller's own client, so the
    // tickets RLS policy applies too.
    const { data: known, error: knownErr } = await sb
      .from("freshdesk_tickets")
      .select("id")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (knownErr) throw new Error("Could not load this ticket. Please try again.");
    if (!known) throw new Error(`Ticket #${data.ticketId} is not in this app`);

    const { data: actions, error } = await sb
      .from("ticket_action_log")
      .select("*")
      .eq("ticket_id", data.ticketId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load the ticket history. Please try again.");

    // Freshdesk conversation text (customer emails, internal notes) is for ops roles only.
    if (!(await isTicketOps(context as never))) {
      return {
        actions: (actions ?? []) as TicketActionEntry[],
        conversations: [] as Awaited<ReturnType<typeof import("@/lib/freshdesk.server").fetchTicketConversations>>,
        conversations_error: "Conversation history is available to ops roles only." as string | null,
      };
    }

    const { fetchTicketConversations } = await import("@/lib/freshdesk.server");
    let conversations: Awaited<ReturnType<typeof fetchTicketConversations>> = [];
    let conversationsError: string | null = null;
    try {
      conversations = await fetchTicketConversations(data.ticketId);
    } catch (e) {
      conversationsError = e instanceof Error ? e.message : String(e);
    }

    return {
      actions: (actions ?? []) as TicketActionEntry[],
      conversations,
      conversations_error: conversationsError,
    };
  });

/** Assign, change status and/or close with a resolution note — pushed to Freshdesk and logged. */
export const resolveTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { ticketId: number; agentId?: number | null; agentName?: string | null; status?: string; resolutionNote?: string }) =>
      z
        .object({
          ticketId: z.number().int().positive(),
          agentId: z.number().int().nullable().optional(),
          agentName: z.string().nullable().optional(),
          status: z.string().optional(),
          resolutionNote: z.string().max(5000).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertTicketActor(context as never);
    const sb = context.supabase as unknown as { from: (t: string) => any };
    const actorEmail = (context.claims as { email?: string } | undefined)?.email ?? null;

    const { data: before, error: beforeErr } = await sb
      .from("freshdesk_tickets")
      .select("id, status, agent_name")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error(`Ticket #${data.ticketId} is not in this app yet`);

    const { STATUS_IDS, updateFreshdeskTicket, addFreshdeskNote } = await import("@/lib/freshdesk.server");

    const payload: { status?: number; responder_id?: number | null } = {};
    if (data.status) {
      const id = STATUS_IDS[data.status];
      if (!id) throw new Error(`Unknown status "${data.status}"`);
      payload.status = id;
    }
    if (data.agentId !== undefined) payload.responder_id = data.agentId;

    if (data.resolutionNote?.trim()) {
      await addFreshdeskNote(data.ticketId, data.resolutionNote.trim());
    }

    let result = { status: before.status as string | null, agent_name: before.agent_name as string | null };
    if (Object.keys(payload).length > 0) {
      result = await updateFreshdeskTicket(data.ticketId, payload);
    }

    const entries: Record<string, unknown>[] = [];
    const base = { ticket_id: data.ticketId, actor_id: context.userId, actor_email: actorEmail };
    if (data.agentId !== undefined && (data.agentName ?? null) !== before.agent_name) {
      entries.push({
        ...base,
        action: "assign",
        field_name: "agent_name",
        old_value: before.agent_name,
        new_value: data.agentName ?? null,
      });
    }
    if (data.status && data.status !== before.status) {
      entries.push({
        ...base,
        action: data.status === "Closed" || data.status === "Resolved" ? "close" : "status_change",
        field_name: "status",
        old_value: before.status,
        new_value: data.status,
        resolution_note: data.resolutionNote?.trim() || null,
      });
    }
    if (data.resolutionNote?.trim() && entries.every((e) => !e.resolution_note)) {
      entries.push({ ...base, action: "note", resolution_note: data.resolutionNote.trim() });
    }
    if (entries.length > 0) {
      const { error: logErr } = await sb.from("ticket_action_log").insert(entries);
      if (logErr) throw new Error(logErr.message);
    }

    return { ok: true, status: result.status, agent_name: result.agent_name };
  });

/* ---------------------------------------------------------------------------
 * Agent-specific KPIs for the dashboard
 * ------------------------------------------------------------------------- */

export interface AgentKpis {
  agent_name: string | null;
  closed: number;
  open_queue: number;
  overdue: number;
  avg_resolution_hours: number | null;
  resolved_sample: number;
  by_month: { month: string; total: number; closed: number }[];
  this_month: number;
}

/**
 * Tickets closed, average resolution time and tickets-per-month for the
 * signed-in user's helpdesk agent identity. Returns agent_name = null when the
 * user is not mapped to a helpdesk agent yet.
 */
export const getMyAgentKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgentKpis> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    const empty: AgentKpis = {
      agent_name: null, closed: 0, open_queue: 0, overdue: 0,
      avg_resolution_hours: null, resolved_sample: 0, by_month: [], this_month: 0,
    };

    const { data: saved } = await sb
      .from("agent_identities")
      .select("agent_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    const agentName = (saved as { agent_name?: string } | null)?.agent_name ?? null;
    if (!agentName) return empty;

    const PAGE = 1000;
    const rows: TicketRow[] = [];
    for (let from = 0; from < 5000; from += PAGE) {
      const { data, error } = await sb
        .from("freshdesk_tickets")
        .select("id, status, priority, due_by, ticket_created_at, ticket_updated_at")
        .eq("agent_name", agentName)
        .order("ticket_created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as TicketRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }

    const now = Date.now();
    const doneStatuses = ["Resolved", "Closed"];
    const done = rows.filter((r) => doneStatuses.includes(r.status ?? ""));

    let hoursSum = 0;
    let sample = 0;
    for (const r of done) {
      if (!r.ticket_created_at || !r.ticket_updated_at) continue;
      const start = new Date(r.ticket_created_at).getTime();
      const end = new Date(r.ticket_updated_at).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      hoursSum += (end - start) / 3_600_000;
      sample += 1;
    }

    const months = new Map<string, { total: number; closed: number }>();
    for (const r of rows) {
      if (!r.ticket_created_at) continue;
      const d = new Date(r.ticket_created_at);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const e = months.get(key) ?? { total: 0, closed: 0 };
      e.total += 1;
      if (doneStatuses.includes(r.status ?? "")) e.closed += 1;
      months.set(key, e);
    }
    const nowD = new Date();
    const thisKey = `${nowD.getUTCFullYear()}-${String(nowD.getUTCMonth() + 1).padStart(2, "0")}`;

    return {
      agent_name: agentName,
      closed: done.length,
      open_queue: rows.filter((r) => !doneStatuses.includes(r.status ?? "")).length,
      overdue: rows.filter(
        (r) => r.due_by && new Date(r.due_by).getTime() < now && !doneStatuses.includes(r.status ?? ""),
      ).length,
      avg_resolution_hours: sample > 0 ? hoursSum / sample : null,
      resolved_sample: sample,
      by_month: [...months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-12)
        .map(([month, v]) => ({ month, ...v })),
      this_month: months.get(thisKey)?.total ?? 0,
    };
  });
