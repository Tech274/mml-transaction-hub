// SCRUM-76 (G-09): rules for AI Command Center decisions, kept free of I/O so they can be tested.
//
// - Who may decide on a proposal at all (DECIDE_ROLES), and who may approve a proposal that
//   writes to an outside system (EXTERNAL_WRITE_ROLES: today only the Freshdesk ticket update).
// - An outside write needs an explicit second confirmation from the user (confirm_external_write).
// - The write plan is rebuilt from an allowlist, so text inside a ticket (or an edited payload)
//   can never change the target, choose an arbitrary status, or add extra fields.
// - Running the plan reports exactly which steps happened, so a failure is never recorded as success.
import type { AppRole } from "@/lib/require-role";

export type AiCcItemType = "solution_guide" | "email_draft" | "ticket_proposal" | "adr_field_map";

/** May run agents and confirm/reject proposals that do not write outside the app. */
export const DECIDE_ROLES: readonly AppRole[] = ["admin", "ops_lead", "ops_user", "leadership", "finance"];

/** May confirm a proposal that writes to Freshdesk (G-09: ops_lead/admin only). */
export const EXTERNAL_WRITE_ROLES: readonly AppRole[] = ["admin", "ops_lead"];

/** Statuses an AI proposal may set. Resolving or closing a ticket stays a human action in Freshdesk. */
export const ALLOWED_PROPOSAL_STATUSES = ["Open", "Pending", "Waiting on Customer"] as const;

export const MAX_NOTE_LENGTH = 2000;

export const EXTERNAL_WRITE_ROLE_MESSAGE = "Only an Admin or Ops Lead can confirm a helpdesk update";
export const EXTERNAL_WRITE_CONFIRM_MESSAGE =
  "This proposal updates the real helpdesk ticket. Please confirm the helpdesk update explicitly.";
export const NO_CONFIRMED_LAB_REQUEST_MESSAGE =
  "There are no CONFIRMED lab requests yet, so the Cost / ADR agent has nothing to work on. No demo data is created.";

export function writesExternally(itemType: AiCcItemType | string): boolean {
  return itemType === "ticket_proposal";
}

export function rolesToConfirm(itemType: AiCcItemType | string): readonly AppRole[] {
  return writesExternally(itemType) ? EXTERNAL_WRITE_ROLES : DECIDE_ROLES;
}

export interface TicketWritePlan {
  ticketId: number;
  status: string | null;
  statusId: number | null;
  note: string | null;
}

export type PlanResult = { ok: true; plan: TicketWritePlan } | { ok: false; reason: string };

/**
 * Builds the Freshdesk write from a stored proposal payload. Only three fields are read
 * (ticket_id, suggested_status, resolution_note) and each is checked; everything else in
 * the payload is ignored.
 */
export function planTicketWrite(payload: Record<string, unknown>, statusIds: Record<string, number>): PlanResult {
  const rawId = payload["ticket_id"];
  const ticketId = typeof rawId === "number" ? rawId : typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return { ok: false, reason: "The proposal has no valid ticket number" };

  const rawStatus = payload["suggested_status"];
  let status: string | null = null;
  let statusId: number | null = null;
  if (rawStatus !== undefined && rawStatus !== null && rawStatus !== "") {
    if (typeof rawStatus !== "string" || !(ALLOWED_PROPOSAL_STATUSES as readonly string[]).includes(rawStatus)) {
      return { ok: false, reason: `An AI proposal may not set the status "${String(rawStatus)}"` };
    }
    const id = statusIds[rawStatus];
    if (!Number.isInteger(id)) return { ok: false, reason: `Unknown helpdesk status "${rawStatus}"` };
    status = rawStatus;
    statusId = id;
  }

  const rawNote = payload["resolution_note"];
  let note: string | null = null;
  if (rawNote !== undefined && rawNote !== null && rawNote !== "") {
    if (typeof rawNote !== "string") return { ok: false, reason: "The proposed note is not text" };
    if (rawNote.length > MAX_NOTE_LENGTH) return { ok: false, reason: `The proposed note is longer than ${MAX_NOTE_LENGTH} characters` };
    note = rawNote;
  }

  if (status === null && note === null) return { ok: false, reason: "The proposal contains no helpdesk change" };
  return { ok: true, plan: { ticketId, status, statusId, note } };
}

export interface TicketWriteDeps {
  addNote: (ticketId: number, body: string) => Promise<void>;
  setStatus: (ticketId: number, statusId: number) => Promise<unknown>;
}

export type TicketWriteStep = "note" | "status";

export interface TicketWriteOutcome {
  ok: boolean;
  done: TicketWriteStep[];
  failedStep: TicketWriteStep | null;
  error: unknown;
}

/** Runs the note, then the status change. Stops at the first failure and says what already happened. */
export async function runTicketWrite(plan: TicketWritePlan, deps: TicketWriteDeps): Promise<TicketWriteOutcome> {
  const done: TicketWriteStep[] = [];
  const steps: [TicketWriteStep, (() => Promise<unknown>) | null][] = [
    ["note", plan.note !== null ? () => deps.addNote(plan.ticketId, plan.note as string) : null],
    ["status", plan.statusId !== null ? () => deps.setStatus(plan.ticketId, plan.statusId as number) : null],
  ];
  for (const [step, run] of steps) {
    if (!run) continue;
    try {
      await run();
      done.push(step);
    } catch (error) {
      return { ok: false, done, failedStep: step, error };
    }
  }
  return { ok: true, done, failedStep: null, error: null };
}

/** User-facing text for a failed helpdesk write. The proposal stays pending in every case. */
export function ticketWriteFailureMessage(outcome: TicketWriteOutcome, ticketId: number, ref: string): string {
  const already = outcome.done.includes("note") ? " The note WAS added, so check the ticket before trying again." : "";
  const step = outcome.failedStep === "status" ? "change the status of" : "add the note to";
  return `Could not ${step} helpdesk ticket #${ticketId} (ref ${ref}).${already} The proposal is still pending.`;
}
