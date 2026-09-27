// SCRUM-102 (G-25) follow-up: helpdesk agent identities are written only by the server, after
// the checks in setMyAgentIdentity / the email auto-match, using the service-role client.
// Signed-in users can read their own row but can't write the table directly (migration
// 20260928020000). Found by the SCRUM-57 RLS audit (docs/rls-audit.md, finding 2).
import { AppError, logError } from "./app-error";

export type AgentIdentityRow = {
  user_id: string;
  agent_name: string;
  agent_id: number;
  auto_matched: boolean;
};

type Db = { from: (t: string) => { upsert: (row: AgentIdentityRow, opts?: { onConflict?: string }) => PromiseLike<{ error: unknown }> } };

export const SAVE_IDENTITY_FAILED = "Could not save your agent identity. Please try again.";

/** The stored name and id always come from the Freshdesk agent record, never from the caller. */
export function identityRow(userId: string, agent: { id: number; name: string }, autoMatched: boolean): AgentIdentityRow {
  if (!userId) throw new AppError("Not signed in");
  if (!Number.isInteger(agent.id) || !agent.name?.trim()) throw new AppError("That helpdesk agent was not found in Freshdesk");
  return { user_id: userId, agent_name: agent.name.trim(), agent_id: agent.id, auto_matched: autoMatched };
}

/**
 * Upserts the caller's identity with the service-role client. Returns a ref when it fails; the
 * caller decides whether that stops the action (manual pick) or is only logged (auto-match).
 */
export async function saveAgentIdentity(admin: Db, row: AgentIdentityRow, where: string): Promise<{ ok: true } | { ok: false; ref: string }> {
  try {
    const { error } = await admin.from("agent_identities").upsert(row, { onConflict: "user_id" });
    if (error) return { ok: false, ref: logError(error, where, { user_id: row.user_id }) };
    return { ok: true };
  } catch (e) {
    return { ok: false, ref: logError(e, where, { user_id: row.user_id }) };
  }
}
