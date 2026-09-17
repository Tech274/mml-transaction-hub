import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const { data, error } = await sb
      .from("freshdesk_tickets")
      .select("*")
      .order("ticket_created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as TicketRow[]).map((r) => ({ ...r, tags: r.tags ?? [] }));

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
  .inputValidator((d?: { sinceDays?: number }) =>
    z.object({ sinceDays: z.number().int().min(1).max(730).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["admin", "ops_lead"],
    } as never);
    if (!allowed) throw new Error("Only admins and ops leads can sync Freshdesk tickets");
    const { runFreshdeskSync } = await import("@/lib/freshdesk.server");
    return runFreshdeskSync({ sinceDays: data.sinceDays });
  });
