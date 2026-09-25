// Freshdesk sync: pulls tickets from the Freshdesk API into public.freshdesk_tickets.
// Server-only (service-role client + API credentials) — never import from a component.
import { DEFAULT_FRESHDESK_SCOPE, freshdeskScopeFromEnv } from "@/lib/app-config";
import { decideSyncWindow, fullSyncHourFromEnv, runOutcome, type CursorDecision, type SyncMode } from "@/lib/freshdesk-cursor";

export interface FreshdeskSyncResult {
  /** sync_runs row for this run (SCRUM-74); null if the run could not be recorded. */
  run_id: string | null;
  status: "success" | "error";
  /** SCRUM-92: "incremental" (since last success) or "full" (from FRESHDESK_TICKETS_FROM). */
  mode?: SyncMode;
  updated_since?: string;
  fetched: number;
  upserted: number;
  duration_ms: number;
  error_message?: string;
}

const STATUS_MAP: Record<number, string> = {
  2: "Open",
  3: "Pending",
  4: "Resolved",
  5: "Closed",
  6: "Waiting on Customer",
  7: "Waiting on Third Party",
};

const PRIORITY_MAP: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

const SOURCE_MAP: Record<number, string> = {
  1: "Email",
  2: "Portal",
  3: "Phone",
  7: "Chat",
  9: "Feedback widget",
  10: "Outbound email",
};

interface FreshdeskTicket {
  id: number;
  subject?: string | null;
  description_text?: string | null;
  status?: number | null;
  priority?: number | null;
  type?: string | null;
  source?: number | null;
  tags?: string[] | null;
  due_by?: string | null;
  fr_due_by?: string | null;
  is_escalated?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  requester?: { name?: string | null; email?: string | null } | null;
  company?: { name?: string | null } | null;
  stats?: unknown;
  responder_id?: number | null;
  group_id?: number | null;
}

function credentials() {
  const rawDomain = process.env.FRESHDESK_DOMAIN;
  const apiKey = process.env.FRESHDESK_API_KEY;
  if (!rawDomain || !apiKey) {
    throw new Error(
      "Freshdesk is not configured yet. The helpdesk address and API key still need to be saved.",
    );
  }
  const domain = rawDomain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return { domain, apiKey };
}

async function fdFetch(path: string, init?: RequestInit, attempt = 0): Promise<Response> {
  const { domain, apiKey } = credentials();
  const auth = Buffer.from(`${apiKey}:X`).toString("base64");
  const res = await fetch(`https://${domain}/api/v2${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  // Freshdesk throttles per minute; wait out the advertised cool-down and retry.
  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "") || 30;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 60) * 1000));
    return fdFetch(path, init, attempt + 1);
  }
  return res;
}


async function readError(res: Response, what: string): Promise<string> {
  const body = await res.text();
  if (res.status === 401 || res.status === 403) {
    return `Freshdesk rejected the credentials (${res.status}). Check the API key and helpdesk address.`;
  }
  return `Freshdesk ${what} failed [${res.status}]: ${body.slice(0, 500)}`;
}

/** Lightweight credential check used by the settings card. */
export async function checkFreshdeskConnection(): Promise<{ ok: boolean; message: string; domain?: string }> {
  try {
    const { domain } = credentials();
    const res = await fdFetch("/tickets?per_page=1");
    if (!res.ok) return { ok: false, message: await readError(res, "connection test"), domain };
    return { ok: true, message: "Connected", domain };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function loadLookup(path: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const res = await fdFetch(path);
    if (!res.ok) return map;
    const rows = (await res.json()) as { id: number; name?: string; contact?: { name?: string } }[];
    for (const r of rows) {
      const name = r.name ?? r.contact?.name;
      if (name) map.set(r.id, name);
    }
  } catch {
    /* lookups are best-effort */
  }
  return map;
}

/**
 * SCRUM-101 (G-24): scope now comes from env (FRESHDESK_GROUP_ID, FRESHDESK_GROUP_NAME,
 * FRESHDESK_TICKETS_FROM). These exports keep the previous defaults for existing imports.
 */
export const CLOUD_LABS_GROUP_ID = DEFAULT_FRESHDESK_SCOPE.groupId;
export const CLOUD_LABS_GROUP_NAME = DEFAULT_FRESHDESK_SCOPE.groupName;
export const TICKETS_FROM = DEFAULT_FRESHDESK_SCOPE.ticketsFrom;

/** started_at of the newest successful freshdesk run (null if none or unreadable → full pass). */
async function lastSuccessfulFreshdeskStart(db: { from: (t: string) => any }): Promise<string | null> {
  const { data, error } = await db
    .from("sync_runs")
    .select("started_at")
    .eq("kind", "freshdesk")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[freshdesk-sync] could not read last successful run, doing a full pass:", error.message);
    return null;
  }
  return (data?.[0]?.started_at as string | undefined) ?? null;
}

/**
 * Pull tickets of the configured group (default Cloud Labs) created on/after the configured date and upsert them.
 * SCRUM-74 (G-07): every run (cron or manual) is recorded in sync_runs with kind = 'freshdesk'.
 */
export async function runFreshdeskSync(opts?: {
  maxPages?: number;
  /** SCRUM-92: force a full pass instead of the incremental window. */
  full?: boolean;
  trigger_source?: "cron" | "manual";
  triggered_by?: string | null;
  triggered_by_email?: string | null;
}): Promise<FreshdeskSyncResult> {
  const startedAt = Date.now();
  const maxPages = opts?.maxPages ?? 60;
  const { startRun, finishRun } = await import("@/lib/sync-run-log");
  type Db = { from: (t: string) => any };
  let logDb: Db | null = null;
  let runId: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    logDb = supabaseAdmin as unknown as Db;
    runId = await startRun(logDb, {
      kind: "freshdesk",
      trigger_source: opts?.trigger_source ?? "cron",
      triggered_by: opts?.triggered_by ?? null,
      triggered_by_email: opts?.triggered_by_email ?? null,
    });
  } catch (e) {
    console.error("[freshdesk-sync] could not record run start:", e instanceof Error ? e.message : String(e));
  }
  let syncWindow: CursorDecision | null = null;

  try {
    const [agents, groups] = await Promise.all([loadLookup("/agents?per_page=100"), loadLookup("/groups?per_page=100")]);

    // Read inside the try: an invalid setting fails (and is recorded as) this run.
    const scope = freshdeskScopeFromEnv(process.env);
    const cutoffMs = new Date(scope.ticketsFrom).getTime();
    // SCRUM-92: only ask for tickets updated since the last successful run (daily full pass).
    syncWindow = decideSyncWindow({
      now: new Date(startedAt),
      lastSuccessStartedAt: logDb ? await lastSuccessfulFreshdeskStart(logDb) : null,
      ticketsFrom: scope.ticketsFrom,
      fullSyncHourUtc: fullSyncHourFromEnv(process.env),
      forceFull: opts?.full === true,
    });
    console.log(`[freshdesk-sync] ${syncWindow.mode} sync, updated_since=${syncWindow.updatedSince} (${syncWindow.reason})`);
    const tickets: FreshdeskTicket[] = [];
    // Newest first. Incremental runs usually need one page; the daily full pass walks all pages.
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const res = await fdFetch(
        `/tickets?updated_since=${encodeURIComponent(syncWindow.updatedSince)}&include=requester,company&order_by=updated_at&order_type=desc&per_page=100&page=${page}`,
      );
      if (!res.ok) throw new Error(await readError(res, "ticket list"));
      const batch = (await res.json()) as FreshdeskTicket[];
      // Cloud Labs group only, created on/after the cutoff — everything else is ignored.
      tickets.push(
        ...batch.filter(
          (t) => t.group_id === scope.groupId && !!t.created_at && new Date(t.created_at).getTime() >= cutoffMs,
        ),
      );
      const oldest = batch.at(-1)?.updated_at;
      if (batch.length < 100 || (oldest && new Date(oldest).getTime() < cutoffMs)) {
        complete = true;
        break;
      }
    }

    const rows = tickets.map((t) => ({
      id: t.id,
      subject: t.subject ?? null,
      description_text: t.description_text ?? null,
      status_id: t.status ?? null,
      status: t.status ? (STATUS_MAP[t.status] ?? `Status ${t.status}`) : null,
      priority_id: t.priority ?? null,
      priority: t.priority ? (PRIORITY_MAP[t.priority] ?? `Priority ${t.priority}`) : null,
      type: t.type ?? null,
      source: t.source ? (SOURCE_MAP[t.source] ?? `Source ${t.source}`) : null,
      requester_name: t.requester?.name ?? null,
      requester_email: t.requester?.email ?? null,
      company_name: t.company?.name ?? null,
      agent_name: t.responder_id ? (agents.get(t.responder_id) ?? null) : null,
      group_name: t.group_id ? (groups.get(t.group_id) ?? null) : null,
      tags: t.tags ?? [],
      due_by: t.due_by ?? null,
      fr_due_by: t.fr_due_by ?? null,
      is_escalated: !!t.is_escalated,
      ticket_created_at: t.created_at ?? null,
      ticket_updated_at: t.updated_at ?? null,
      synced_at: new Date().toISOString(),
    }));

    const admin: Db =
      logDb ?? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Db);

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("freshdesk_tickets").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(error.message);
      upserted += chunk.length;
    }

    // SCRUM-92: an incomplete incremental run fails (cursor must not skip unread pages);
    // an incomplete full pass stays a success with a visible note.
    const outcome = runOutcome(syncWindow.mode, complete, maxPages, upserted);
    if (outcome.failure) throw new Error(outcome.failure);
    const note = outcome.note;
    if (note) console.warn(`[freshdesk-sync] ${note}`);

    const duration_ms = Date.now() - startedAt;
    if (logDb) await finishRun(logDb, runId, { status: "success", duration_ms, error_message: note, fetched_count: tickets.length, upserted_count: upserted });
    return {
      run_id: runId,
      status: "success",
      mode: syncWindow.mode,
      updated_since: syncWindow.updatedSince,
      fetched: tickets.length,
      upserted,
      duration_ms,
    };
  } catch (e) {
    const duration_ms = Date.now() - startedAt;
    const error_message = e instanceof Error ? e.message : String(e);
    console.error("[freshdesk-sync] run failed:", error_message);
    if (logDb) await finishRun(logDb, runId, { status: "error", duration_ms, error_message, fetched_count: 0, upserted_count: 0 });
    return {
      run_id: runId,
      status: "error",
      ...(syncWindow ? { mode: syncWindow.mode, updated_since: syncWindow.updatedSince } : {}),
      fetched: 0,
      upserted: 0,
      duration_ms,
      error_message,
    };
  }
}

/** Agents in the helpdesk, used for assignment and identity matching. */
export interface FreshdeskAgent {
  id: number;
  name: string;
  email: string | null;
  group_ids: number[];
}

export async function listFreshdeskAgents(): Promise<FreshdeskAgent[]> {
  const res = await fdFetch("/agents?per_page=100");
  if (!res.ok) throw new Error(await readError(res, "agent list"));
  const rows = (await res.json()) as {
    id: number;
    contact?: { name?: string | null; email?: string | null } | null;
    group_ids?: number[] | null;
  }[];
  return rows
    .map((r) => ({
      id: r.id,
      name: r.contact?.name ?? `Agent ${r.id}`,
      email: r.contact?.email ?? null,
      group_ids: r.group_ids ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const STATUS_IDS: Record<string, number> = {
  Open: 2,
  Pending: 3,
  Resolved: 4,
  Closed: 5,
  "Waiting on Customer": 6,
  "Waiting on Third Party": 7,
};

export function statusLabel(id: number): string {
  return STATUS_MAP[id] ?? `Status ${id}`;
}

/** Apply an update in Freshdesk, then mirror the fresh ticket back into the table. */
export async function updateFreshdeskTicket(
  ticketId: number,
  payload: { status?: number; responder_id?: number | null; priority?: number },
): Promise<{ status: string | null; agent_name: string | null; priority: string | null }> {
  const res = await fdFetch(`/tickets/${ticketId}`, { method: "PUT", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await readError(res, `ticket #${ticketId} update`));
  const t = (await res.json()) as FreshdeskTicket;

  const agents = await loadLookup("/agents?per_page=100");
  const row = {
    status_id: t.status ?? null,
    status: t.status ? statusLabel(t.status) : null,
    priority_id: t.priority ?? null,
    priority: t.priority ? (PRIORITY_MAP[t.priority] ?? `Priority ${t.priority}`) : null,
    agent_name: t.responder_id ? (agents.get(t.responder_id) ?? null) : null,
    ticket_updated_at: t.updated_at ?? null,
    synced_at: new Date().toISOString(),
  };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as { from: (t: string) => any };
  const { error } = await admin.from("freshdesk_tickets").update(row).eq("id", ticketId);
  if (error) throw new Error(error.message);

  return { status: row.status, agent_name: row.agent_name, priority: row.priority };
}

/** Private note on the ticket (used for resolution notes). */
export async function addFreshdeskNote(ticketId: number, body: string): Promise<void> {
  const res = await fdFetch(`/tickets/${ticketId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: body.replace(/\n/g, "<br/>"), private: true }),
  });
  if (!res.ok) throw new Error(await readError(res, `ticket #${ticketId} note`));
}

export interface TicketConversation {
  id: number;
  body_text: string | null;
  private: boolean;
  incoming: boolean;
  from_email: string | null;
  created_at: string | null;
}

export async function fetchTicketConversations(ticketId: number): Promise<TicketConversation[]> {
  const res = await fdFetch(`/tickets/${ticketId}/conversations?per_page=50`);
  if (!res.ok) throw new Error(await readError(res, `ticket #${ticketId} history`));
  const rows = (await res.json()) as {
    id: number;
    body_text?: string | null;
    private?: boolean;
    incoming?: boolean;
    from_email?: string | null;
    created_at?: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    body_text: r.body_text ?? null,
    private: !!r.private,
    incoming: !!r.incoming,
    from_email: r.from_email ?? null,
    created_at: r.created_at ?? null,
  }));
}
