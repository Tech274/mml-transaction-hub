// SCRUM-91 (G-06) and SCRUM-102 (G-25): who may read ticket conversations and
// who may claim which helpdesk agent identity. Pure helpers, unit-tested.

/** Roles that work tickets. Only these may see Freshdesk conversation text or the agent directory. */
export const TICKET_OPS_ROLES = ["admin", "ops_lead", "ops_user"] as const;

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 ? e : null;
}

/**
 * A user may claim a helpdesk agent identity only when the agent's email in
 * Freshdesk matches the user's sign-in email. Admins may pick any agent for
 * themselves (e.g. to cover a shared inbox). Nobody may claim an agent that
 * does not exist in the Freshdesk directory.
 */
export function canClaimAgent(args: {
  callerEmail: string | null | undefined;
  isAdmin: boolean;
  agent: { id: number; email: string | null } | undefined;
}): { ok: true } | { ok: false; reason: string } {
  if (!args.agent) return { ok: false, reason: "That helpdesk agent was not found in Freshdesk" };
  if (args.isAdmin) return { ok: true };
  const caller = normalizeEmail(args.callerEmail);
  const agentEmail = normalizeEmail(args.agent.email);
  if (!caller || !agentEmail || caller !== agentEmail) {
    return {
      ok: false,
      reason: "You can only link the helpdesk agent whose email matches your sign-in email. Ask an admin if this is wrong.",
    };
  }
  return { ok: true };
}
