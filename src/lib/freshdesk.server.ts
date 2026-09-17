// Freshdesk sync: pulls tickets from the Freshdesk API into public.freshdesk_tickets.
// Server-only (service-role client + API credentials) — never import from a component.

export interface FreshdeskSyncResult {
  status: "success" | "error";
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

/** Only the Cloud Labs group is synced into this app. */
export const CLOUD_LABS_GROUP_ID = 1060000391179;
export const CLOUD_LABS_GROUP_NAME = "Cloud Labs";
/** Nothing created before this date is synced. */
export const TICKETS_FROM = "2026-04-01T00:00:00Z";

/** Pull Cloud Labs tickets created on/after TICKETS_FROM and upsert them. */
export async function runFreshdeskSync(opts?: { maxPages?: number }): Promise<FreshdeskSyncResult> {
  const startedAt = Date.now();
  const maxPages = opts?.maxPages ?? 60;

  try {
    const [agents, groups] = await Promise.all([loadLookup("/agents?per_page=100"), loadLookup("/groups?per_page=100")]);

    const cutoffMs = new Date(TICKETS_FROM).getTime();
    const tickets: FreshdeskTicket[] = [];
    // Newest first, so an hourly run touches only the first page or two.
    for (let page = 1; page <= maxPages; page++) {
      const res = await fdFetch(
        `/tickets?updated_since=${encodeURIComponent(TICKETS_FROM)}&include=requester,company&order_by=updated_at&order_type=desc&per_page=100&page=${page}`,
      );
      if (!res.ok) throw new Error(await readError(res, "ticket list"));
      const batch = (await res.json()) as FreshdeskTicket[];
      // Cloud Labs group only, created on/after the cutoff — everything else is ignored.
      tickets.push(
        ...batch.filter(
          (t) => t.group_id === CLOUD_LABS_GROUP_ID && !!t.created_at && new Date(t.created_at).getTime() >= cutoffMs,
        ),
      );
      const oldest = batch.at(-1)?.updated_at;
      if (batch.length < 100 || (oldest && new Date(oldest).getTime() < cutoffMs)) break;
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as { from: (t: string) => any };

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin.from("freshdesk_tickets").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(error.message);
      upserted += chunk.length;
    }

    return {
      status: "success",
      fetched: tickets.length,
      upserted,
      duration_ms: Date.now() - startedAt,
    };
  } catch (e) {
    return {
      status: "error",
      fetched: 0,
      upserted: 0,
      duration_ms: Date.now() - startedAt,
      error_message: e instanceof Error ? e.message : String(e),
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
