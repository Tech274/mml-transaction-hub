/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError, logIfError } from "@/lib/app-error";
import { requireRole } from "@/lib/require-role";

/* ---------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export type AgentKey = "generalist" | "support" | "cost_adr";
export type InboxType = "solution_guide" | "email_draft" | "ticket_proposal" | "adr_field_map";
export type AgentStatus = "idle" | "running" | "needs confirm";

export interface AgentSummary {
  key: AgentKey;
  name: string;
  blurb: string;
  capabilities: string[];
  status: AgentStatus;
  pending: number;
  last_run_at: string | null;
  owns_email_draft: boolean;
}

export interface InboxItem {
  id: string;
  run_id: string | null;
  agent_key: AgentKey;
  item_type: InboxType;
  title: string;
  summary: string | null;
  payload: Record<string, any>;
  status: "pending" | "confirmed" | "rejected";
  decision_note: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface AuditItem {
  id: string;
  actor_email: string | null;
  agent_key: AgentKey | null;
  action: "run" | "propose" | "confirm" | "reject";
  run_id: string | null;
  inbox_id: string | null;
  detail: Record<string, any>;
  created_at: string;
}

export interface LabRequest {
  id: string;
  request_code: string;
  customer_name: string;
  lab_name: string;
  status: string;
  requisition: Record<string, any>;
  confirmed_at: string | null;
  created_at: string;
}

export const AGENTS: { key: AgentKey; name: string; blurb: string; capabilities: string[]; owns_email_draft: boolean }[] = [
  {
    key: "generalist",
    name: "Generalist (Lab Solution Guide)",
    blurb: "Business-wide assistant that drafts a Lab Solution Guide and a matching email reply for lab or sales questions.",
    capabilities: [
      "Feasibility: open-source vs OEM / licensed",
      "Cost breakdown per learner and per month",
      "Provisioning options and trade-offs",
      "Email draft for a human to send",
    ],
    owns_email_draft: true,
  },
  {
    key: "support",
    name: "Support desk",
    blurb: "Reads synced helpdesk tickets and proposes a reply plus tag, priority, assignee and status. Writes only after you confirm.",
    capabilities: [
      "Reads real synced tickets (never writes on its own)",
      "Draft reply email body",
      "Suggested priority, tag, assignee and status",
      "Helpdesk update happens only on confirm",
    ],
    owns_email_draft: true,
  },
  {
    key: "cost_adr",
    name: "Cost / ADR entry",
    blurb: "Triggers on CONFIRMED lab requests and proposes a Master ADR field map with input and selling cost. Never writes transactions.",
    capabilities: [
      "Watches lab requests with status CONFIRMED",
      "Extracts the requisition into Master ADR fields",
      "Proposes input cost, selling cost, margin",
      "No transaction is ever saved without you",
    ],
    owns_email_draft: false,
  },
];

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

type Ctx = { supabase: { from: (t: string) => any; rpc: (n: string, a: unknown) => any }; userId: string; claims?: unknown };

function actorEmail(context: Ctx) {
  return (context.claims as { email?: string } | undefined)?.email ?? null;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

async function assertActor(context: Ctx) {
  // SCRUM-100: a failed permission lookup used to be treated like "not allowed" silently.
  await requireRole(context, ["admin", "ops_lead", "ops_user", "leadership", "finance"], "You do not have permission to run agents or decide on proposals");
}

async function writeAudit(
  sb: { from: (t: string) => any },
  row: {
    actor_id: string;
    actor_email: string | null;
    agent_key: AgentKey | null;
    action: "run" | "propose" | "confirm" | "reject";
    run_id?: string | null;
    inbox_id?: string | null;
    detail?: Record<string, any>;
  },
) {
  const res = await sb.from("ai_cc_audit").insert({
    actor_id: row.actor_id,
    actor_email: row.actor_email,
    agent_key: row.agent_key,
    action: row.action,
    run_id: row.run_id ?? null,
    inbox_id: row.inbox_id ?? null,
    detail: row.detail ?? {},
  });
  // SCRUM-96: never silent. The user action already happened, so log instead of failing it.
  logIfError(res, `ai-command-center.audit:${row.action}`);
}

const inr = (n: number) => `INR ${n.toLocaleString("en-IN")}`;

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------- */

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AgentSummary[]> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    const [{ data: pending }, { data: runs }] = await Promise.all([
      sb.from("ai_cc_inbox").select("agent_key").eq("status", "pending"),
      sb.from("ai_cc_runs").select("agent_key, status, created_at").order("created_at", { ascending: false }).limit(200),
    ]);

    return AGENTS.map((a) => {
      const pendingCount = (pending ?? []).filter((p: { agent_key: string }) => p.agent_key === a.key).length;
      const agentRuns = (runs ?? []).filter((r: { agent_key: string }) => r.agent_key === a.key);
      const running = agentRuns.some((r: { status: string }) => r.status === "running");
      return {
        ...a,
        pending: pendingCount,
        status: running ? "running" : pendingCount > 0 ? "needs confirm" : "idle",
        last_run_at: (agentRuns[0] as { created_at?: string } | undefined)?.created_at ?? null,
      } as AgentSummary;
    });
  });

export const listInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { status?: string; agent_key?: string }) =>
    z.object({ status: z.string().optional(), agent_key: z.string().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<InboxItem[]> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    let q = sb.from("ai_cc_inbox").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.agent_key && data.agent_key !== "all") q = q.eq("agent_key", data.agent_key);
    const { data: rows, error } = await q;
    if (error) throw dbError(error, "ai-command-center.listInbox");
    return (rows ?? []) as InboxItem[];
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d?: { agent_key?: string }) => z.object({ agent_key: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AuditItem[]> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    let q = sb.from("ai_cc_audit").select("*").order("created_at", { ascending: false }).limit(300);
    if (data.agent_key && data.agent_key !== "all") q = q.eq("agent_key", data.agent_key);
    const { data: rows, error } = await q;
    if (error) throw dbError(error, "ai-command-center.listAudit");
    return (rows ?? []) as AuditItem[];
  });

export const listLabRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LabRequest[]> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    const { data, error } = await sb
      .from("ai_cc_lab_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw dbError(error, "ai-command-center.listLabRequests");
    return (data ?? []) as LabRequest[];
  });

/* ---------------------------------------------------------------------------
 * Deterministic agent "brains"
 * ------------------------------------------------------------------------- */

interface Proposal {
  agent_key: AgentKey;
  item_type: InboxType;
  title: string;
  summary: string;
  payload: Record<string, any>;
}

function generalistBrain(hint: string | null): Proposal[] {
  const lab = hint?.trim() || "Kogito BPMN Automation Lab";
  const learners = 45;
  const months = 3;
  const perLearner = 1350;
  const oemPerLearner = 4200;
  const ossTotal = perLearner * learners * months;
  const oemTotal = oemPerLearner * learners * months;

  const guide = `# Lab Solution Guide — ${lab}

## 1. Feasibility: open source vs OEM / licensed
**Open-source route (recommended)**
- Every core component of "${lab}" has a production-grade OSS distribution, so no per-seat licence is required.
- Effort sits in image building and per-learner isolation, not in procurement.
- Risk: version drift between OSS releases — pin images per cohort.

**OEM / licensed route**
- Needed only when the customer asks for vendor support SLAs, certification vouchers or branded content.
- Adds per-learner licence cost and a 2–3 week procurement lead time.

**Verdict:** start OSS; quote the OEM add-on as an optional line item.

## 2. Cost breakdown (${learners} learners · ${months} months)
| Line | Basis | Amount |
| --- | --- | --- |
| Compute + storage | ${inr(perLearner)} / learner / month | ${inr(ossTotal)} |
| Lab engineering (one-off) | image build, scripts, validation | ${inr(120000)} |
| Support & monitoring | during cohort window | ${inr(45000)} |
| **Total (OSS route)** | | **${inr(ossTotal + 165000)}** |
| OEM licence (optional) | ${inr(oemPerLearner)} / learner / month | ${inr(oemTotal)} |

## 3. Provisioning options
1. **Public cloud, per-learner namespace** — fastest to launch, best for short cohorts, pay-as-you-go.
2. **MakeMyLabs private cloud** — cheaper above ~60 concurrent learners, fixed system configs (e.g. 16GB 4vCPUs).
3. **Hybrid** — private cloud for the steady base load, public cloud burst for peak weeks.

## 4. Recommended next steps
- Confirm concurrency and cohort calendar.
- Approve the OSS route and the optional OEM line.
- Raise the Master ADR entry once commercials are signed off.`;

  const email = `Hi team,

Thanks for the interest in the ${lab}.

We can deliver this fully on open-source components, so there is no per-seat licence cost. For a cohort of ${learners} learners over ${months} months the indicative investment is ${inr(ossTotal + 165000)}, covering compute and storage, one-time lab engineering, and monitoring through the cohort window. If you need vendor support SLAs or certification vouchers, we can add the OEM licence option separately.

On provisioning, we would suggest per-learner isolated environments on public cloud for this cohort size; we can move to our private cloud if concurrency grows.

Happy to walk through the detailed solution guide on a short call this week.

Best regards,
MakeMyLabs Solutions Team`;

  return [
    {
      agent_key: "generalist",
      item_type: "solution_guide",
      title: `Lab Solution Guide — ${lab}`,
      summary: `Feasibility (OSS vs OEM), cost breakdown for ${learners} learners over ${months} months, and three provisioning options.`,
      payload: { lab_name: lab, markdown: guide },
    },
    {
      agent_key: "generalist",
      item_type: "email_draft",
      title: `Email draft — ${lab} solution summary`,
      summary: "Customer-ready reply summarising feasibility, cost and provisioning. Human sends.",
      payload: { subject: `${lab} — solution and indicative costing`, body: email, to: "" },
    },
  ];
}

function supportBrain(ticket: {
  id: number;
  subject: string | null;
  status: string | null;
  priority: string | null;
  requester_name: string | null;
  requester_email: string | null;
  company_name: string | null;
  agent_name: string | null;
  description_text: string | null;
}): Proposal[] {
  const who = ticket.requester_name || "there";
  const subject = ticket.subject || `Ticket #${ticket.id}`;
  const suggestedPriority = /urgent|down|blocked|cannot access|not working/i.test(
    `${subject} ${ticket.description_text ?? ""}`,
  )
    ? "High"
    : (ticket.priority || "Medium");
  const suggestedTag = /access|login|credential/i.test(subject)
    ? "lab-access"
    : /performance|slow|timeout/i.test(subject)
      ? "lab-performance"
      : "cloud-labs";

  const body = `Hi ${who},

Thanks for reaching out about "${subject}".

We have reviewed the lab environment linked to your request and are working on it now. Here is where things stand:

1. We have verified your lab allocation and access permissions.
2. If the environment needs a refresh, we will re-provision it and confirm back to you.
3. You will receive an update from us as soon as the fix is in place.

Could you confirm the lab name and the approximate time you last saw the issue? That helps us pinpoint the exact session.

Best regards,
Cloud Labs Support — MakeMyLabs`;

  return [
    {
      agent_key: "support",
      item_type: "ticket_proposal",
      title: `Ticket #${ticket.id} — proposed update`,
      summary: `Suggest priority ${suggestedPriority}, tag "${suggestedTag}", status Pending${ticket.agent_name ? `, keep ${ticket.agent_name} assigned` : ", assign to Cloud Labs queue"}.`,
      payload: {
        ticket_id: ticket.id,
        ticket_subject: subject,
        current_status: ticket.status,
        current_priority: ticket.priority,
        company_name: ticket.company_name,
        requester_email: ticket.requester_email,
        suggested_status: "Pending",
        suggested_priority: suggestedPriority,
        suggested_tag: suggestedTag,
        suggested_assignee: ticket.agent_name ?? "Cloud Labs queue",
        resolution_note: `AI Command Center proposal: acknowledge, verify lab allocation, re-provision if needed. Priority ${suggestedPriority}, tag ${suggestedTag}.`,
        write_target: "freshdesk",
      },
    },
    {
      agent_key: "support",
      item_type: "email_draft",
      title: `Email draft — reply to ticket #${ticket.id}`,
      summary: `Reply to ${ticket.requester_email ?? "requester"} for "${subject}". Human sends.`,
      payload: {
        subject: `Re: ${subject} (Ticket #${ticket.id})`,
        body,
        to: ticket.requester_email ?? "",
        ticket_id: ticket.id,
      },
    },
  ];
}

function costAdrBrain(req: LabRequest): Proposal[] {
  const r = req.requisition as Record<string, any>;
  const input_cost = Number(r.input_cost ?? 0);
  const selling_cost = Number(r.selling_cost ?? 0);
  const margin = selling_cost > 0 ? ((selling_cost - input_cost) / selling_cost) * 100 : 0;
  const start = String(r.start_date ?? "");
  const month = start ? Number(start.slice(5, 7)) : new Date().getUTCMonth() + 1;
  const year = start ? Number(start.slice(0, 4)) : new Date().getUTCFullYear();
  const lab_type = String(r.lab_type ?? "public_cloud");

  const fieldMap = {
    potential_id: `POT-${req.request_code.replace(/^LR-/, "")}`,
    month,
    year,
    customer_name: req.customer_name,
    lab_name: req.lab_name,
    lab_type,
    cloud_provider: lab_type === "private_cloud" ? "MakeMyLabs Private Cloud" : String(r.cloud_provider ?? "AWS"),
    system_config: lab_type === "private_cloud" ? String(r.system_config ?? "16GB 4vCPUs") : null,
    line_of_business: String(r.line_of_business ?? "Integrated"),
    start_date: start,
    end_date: String(r.end_date ?? ""),
    total_users: Number(r.total_users ?? 0),
    input_cost,
    selling_cost,
  };

  return [
    {
      agent_key: "cost_adr",
      item_type: "adr_field_map",
      title: `Master ADR field map — ${req.lab_name} (${req.request_code})`,
      summary: `${req.customer_name} · ${fieldMap.total_users} users · input ${inr(input_cost)} · selling ${inr(selling_cost)} · margin ${margin.toFixed(1)}%`,
      payload: {
        request_code: req.request_code,
        lab_request_id: req.id,
        margin_pct: Number(margin.toFixed(2)),
        field_map: fieldMap,
        extraction_notes: [
          `Trigger: lab request ${req.request_code} reached status CONFIRMED.`,
          `Costs taken from the requisition (${String(r.currency ?? "INR")}).`,
          "No transaction is written — a human must save the Master ADR entry.",
        ],
        components: r.components ?? [],
      },
    },
  ];
}

/* ---------------------------------------------------------------------------
 * runAgent
 * ------------------------------------------------------------------------- */

export const runAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { agent_key: AgentKey; job_hint?: string }) =>
    z
      .object({
        agent_key: z.enum(["generalist", "support", "cost_adr"]),
        job_hint: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertActor(ctx);
    const email = actorEmail(ctx);
    const sb = await admin();
    const read = context.supabase as unknown as { from: (t: string) => any };

    const { data: run, error: runErr } = await sb
      .from("ai_cc_runs")
      .insert({
        agent_key: data.agent_key,
        status: "running",
        job_hint: data.job_hint ?? null,
        input_json: { job_hint: data.job_hint ?? null },
        actor_id: ctx.userId,
        actor_email: email,
      })
      .select("id")
      .single();
    if (runErr) throw dbError(runErr, "ai-command-center.runAgent");
    const runId = (run as { id: string }).id;

    await writeAudit(sb, {
      actor_id: ctx.userId,
      actor_email: email,
      agent_key: data.agent_key,
      action: "run",
      run_id: runId,
      detail: { job_hint: data.job_hint ?? null },
    });

    try {
      let proposals: Proposal[] = [];
      const output: Record<string, any> = {};

      if (data.agent_key === "generalist") {
        proposals = generalistBrain(data.job_hint ?? null);
      } else if (data.agent_key === "support") {
        // READ real synced tickets — never write here.
        const { data: tickets, error } = await read
          .from("freshdesk_tickets")
          .select(
            "id, subject, status, priority, requester_name, requester_email, company_name, agent_name, description_text",
          )
          .in("status", ["Open", "Pending", "Waiting on Customer"])
          .order("ticket_created_at", { ascending: false })
          .limit(25);
        if (error) throw dbError(error, "ai-command-center.runAgent");
        const hint = data.job_hint?.trim().toLowerCase();
        const list = (tickets ?? []) as Parameters<typeof supportBrain>[0][];
        const picked =
          (hint ? list.find((t) => `${t.id} ${t.subject ?? ""}`.toLowerCase().includes(hint)) : undefined) ?? list[0];
        if (!picked) throw new Error("No open or pending tickets are synced yet — run a Freshdesk sync first");
        proposals = supportBrain(picked);
        output['ticket_id'] = picked.id;
      } else {
        const { data: reqs, error } = await read
          .from("ai_cc_lab_requests")
          .select("*")
          .eq("status", "CONFIRMED")
          .order("confirmed_at", { ascending: false })
          .limit(5);
        if (error) throw dbError(error, "ai-command-center.runAgent");
        let confirmed = ((reqs ?? []) as LabRequest[])[0];
        if (!confirmed) {
          // Seed a demo CONFIRMED request so the trigger is always demoable.
          const { data: seeded, error: seedErr } = await sb
            .from("ai_cc_lab_requests")
            .insert({
              request_code: `LR-${new Date().getUTCFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
              customer_name: "Cognizant",
              lab_name: data.job_hint?.trim() || "Kogito BPMN Automation Lab",
              status: "CONFIRMED",
              confirmed_at: new Date().toISOString(),
              requisition: {
                line_of_business: "Integrated",
                lab_type: "public_cloud",
                cloud_provider: "AWS",
                total_users: 45,
                start_date: "2026-10-01",
                end_date: "2026-12-31",
                input_cost: 182500,
                selling_cost: 312000,
                currency: "INR",
                components: ["Kogito runtime (OSS)", "Quarkus", "Keycloak SSO", "Postgres"],
                notes: "Seeded demo requisition.",
              },
            })
            .select("*")
            .single();
          if (seedErr) throw dbError(seedErr, "ai-command-center.runAgent");
          confirmed = seeded as LabRequest;
          output['seeded_lab_request'] = confirmed.request_code;
        }
        proposals = costAdrBrain(confirmed);
        output['lab_request'] = confirmed.request_code;
      }

      const { data: inserted, error: inboxErr } = await sb
        .from("ai_cc_inbox")
        .insert(
          proposals.map((p) => ({
            run_id: runId,
            agent_key: p.agent_key,
            item_type: p.item_type,
            title: p.title,
            summary: p.summary,
            payload: p.payload,
            status: "pending",
          })),
        )
        .select("id, item_type, title");
      if (inboxErr) throw dbError(inboxErr, "ai-command-center.runAgent");

      for (const item of (inserted ?? []) as { id: string; item_type: string; title: string }[]) {
        await writeAudit(sb, {
          actor_id: ctx.userId,
          actor_email: email,
          agent_key: data.agent_key,
          action: "propose",
          run_id: runId,
          inbox_id: item.id,
          detail: { item_type: item.item_type, title: item.title },
        });
      }

      output['items'] = (inserted ?? []).length;
      await sb
        .from("ai_cc_runs")
        .update({ status: "done", finished_at: new Date().toISOString(), output_json: output })
        .eq("id", runId);

      return { run_id: runId, items: (inserted ?? []).length, output };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await sb
        .from("ai_cc_runs")
        .update({ status: "error", finished_at: new Date().toISOString(), output_json: { error: message } })
        .eq("id", runId);
      throw new Error(message);
    }
  });

/* ---------------------------------------------------------------------------
 * Confirm / reject
 * ------------------------------------------------------------------------- */

export const confirmInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; note?: string; edited?: { subject?: string; body?: string } }) =>
    z
      .object({
        id: z.string().uuid(),
        note: z.string().max(2000).optional(),
        edited: z.object({ subject: z.string().optional(), body: z.string().optional() }).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertActor(ctx);
    const email = actorEmail(ctx);
    const sb = await admin();

    const { data: item, error } = await sb.from("ai_cc_inbox").select("*").eq("id", data.id).maybeSingle();
    if (error) throw dbError(error, "ai-command-center.confirmInboxItem");
    if (!item) throw new Error("This proposal no longer exists");
    const row = item as InboxItem;
    if (row.status !== "pending") throw new Error(`This proposal is already ${row.status}`);

    const payload = { ...(row.payload as Record<string, any>) };
    if (data.edited?.subject !== undefined) payload['subject'] = data.edited.subject;
    if (data.edited?.body !== undefined) payload['body'] = data.edited.body;

    let write_result: Record<string, any> = { performed: false, reason: "No external write for this item type" };

    if (row.item_type === "ticket_proposal") {
      // The ONLY place a helpdesk write may happen — after human confirm.
      const ticketId = Number(payload['ticket_id']);
      try {
        const { STATUS_IDS, updateFreshdeskTicket, addFreshdeskNote } = await import("@/lib/freshdesk.server");
        const status = String(payload['suggested_status'] ?? "");
        const statusId = STATUS_IDS[status];
        if (payload['resolution_note']) await addFreshdeskNote(ticketId, String(payload['resolution_note']));
        if (statusId) await updateFreshdeskTicket(ticketId, { status: statusId });
        write_result = { performed: true, target: "freshdesk", ticket_id: ticketId, status };
        const logRes = await sb.from("ticket_action_log").insert({
          ticket_id: ticketId,
          action: "status_change",
          field_name: "status",
          old_value: String(payload['current_status'] ?? ""),
          new_value: status,
          resolution_note: String(payload['resolution_note'] ?? ""),
          actor_id: ctx.userId,
          actor_email: email,
        });
        logIfError(logRes, "ai-command-center.confirmInboxItem:ticket_action_log");
      } catch (e) {
        write_result = {
          performed: false,
          stubbed: true,
          target: "freshdesk",
          ticket_id: ticketId,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    } else if (row.item_type === "email_draft") {
      write_result = { performed: false, approved_for_human_send: true, note: "Never auto-sent" };
    } else if (row.item_type === "adr_field_map") {
      write_result = { performed: false, note: "Field map approved. A human must save the Master ADR entry." };
    }

    const { error: upErr } = await sb
      .from("ai_cc_inbox")
      .update({
        status: "confirmed",
        decision_note: data.note ?? null,
        decided_by: ctx.userId,
        decided_by_email: email,
        decided_at: new Date().toISOString(),
        payload: { ...payload, write_result },
      })
      .eq("id", data.id);
    if (upErr) throw dbError(upErr, "ai-command-center.confirmInboxItem");

    await writeAudit(sb, {
      actor_id: ctx.userId,
      actor_email: email,
      agent_key: row.agent_key,
      action: "confirm",
      run_id: row.run_id,
      inbox_id: row.id,
      detail: { item_type: row.item_type, title: row.title, note: data.note ?? null, write_result },
    });

    return { ok: true, write_result };
  });

export const rejectInboxItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; note?: string }) =>
    z.object({ id: z.string().uuid(), note: z.string().max(2000).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertActor(ctx);
    const email = actorEmail(ctx);
    const sb = await admin();

    const { data: item, error } = await sb.from("ai_cc_inbox").select("*").eq("id", data.id).maybeSingle();
    if (error) throw dbError(error, "ai-command-center.rejectInboxItem");
    if (!item) throw new Error("This proposal no longer exists");
    const row = item as InboxItem;
    if (row.status !== "pending") throw new Error(`This proposal is already ${row.status}`);

    const { error: upErr } = await sb
      .from("ai_cc_inbox")
      .update({
        status: "rejected",
        decision_note: data.note ?? null,
        decided_by: ctx.userId,
        decided_by_email: email,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (upErr) throw dbError(upErr, "ai-command-center.rejectInboxItem");

    await writeAudit(sb, {
      actor_id: ctx.userId,
      actor_email: email,
      agent_key: row.agent_key,
      action: "reject",
      run_id: row.run_id,
      inbox_id: row.id,
      detail: { item_type: row.item_type, title: row.title, note: data.note ?? null },
    });

    return { ok: true };
  });
