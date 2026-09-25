// SCRUM-92 (G-08): stale-ticket sweep.
// A ticket that leaves the synced group (or is deleted in Freshdesk) is never returned
// again, so its row kept its old status forever. After a *complete* full pass, every
// row the pass did not touch (synced_at older than the run start) is stamped with
// stale_since. Nothing is deleted. A ticket that comes back has stale_since cleared
// by the normal upsert.
//
// Off unless FRESHDESK_STALE_SWEEP_ENABLED=true. That flag must only be turned on
// after migration 20260925150000_scrum92_freshdesk_stale_marker.sql is applied,
// because the column does not exist before it.

type Db = { from: (t: string) => any };

/** Only the exact string "true" turns the sweep on (same rule as STRICT_IMPORT_ENABLED). */
export function staleSweepEnabledFromEnv(env: Record<string, string | undefined>): boolean {
  return env.FRESHDESK_STALE_SWEEP_ENABLED?.trim() === "true";
}

/** Refuse to mark more than this share of tracked tickets in one run... */
export const MAX_STALE_FRACTION = 0.5;
/** ...unless it is only a handful. */
export const STALE_ALWAYS_OK_COUNT = 50;

export interface SweepInput {
  mode: "incremental" | "full";
  /** true if the pass reached the last page. */
  complete: boolean;
  /** tickets written by this pass. */
  seen: number;
  /** rows not yet stale that this pass did not touch. */
  candidates: number;
  /** all rows not yet stale (including the ones this pass wrote). */
  tracked: number;
}

export function decideStaleSweep(i: SweepInput): { run: boolean; reason: string } {
  if (i.mode !== "full") return { run: false, reason: "only a full pass can tell which tickets are gone" };
  if (!i.complete) return { run: false, reason: "full pass stopped early, so missing tickets may just be unread" };
  if (i.seen === 0) return { run: false, reason: "full pass returned no tickets; check FRESHDESK_GROUP_ID before marking anything" };
  if (i.candidates === 0) return { run: false, reason: "no stale tickets" };
  if (i.candidates > STALE_ALWAYS_OK_COUNT && i.candidates > i.tracked * MAX_STALE_FRACTION) {
    return {
      run: false,
      reason: `refused: ${i.candidates} of ${i.tracked} tickets would be marked stale (over ${MAX_STALE_FRACTION * 100}%); this usually means the group or date setting changed`,
    };
  }
  return { run: true, reason: `marking ${i.candidates} ticket(s) stale` };
}

export interface SweepResult {
  marked: number;
  /** Human-readable line for the sync_runs note / logs; null when there was nothing to say. */
  note: string | null;
}

/**
 * Stamp rows the full pass did not touch. `runStartIso` is when this sync run started:
 * every row this run (or any concurrent write) touched has synced_at >= it, so it is left alone.
 * Never throws: a sweep problem is reported as a note and must not fail the ticket sync itself.
 */
export async function markStaleTickets(
  db: Db,
  opts: { runStartIso: string; mode: "incremental" | "full"; complete: boolean; seen: number; now?: Date },
): Promise<SweepResult> {
  try {
    const tracked = await db
      .from("freshdesk_tickets")
      .select("id", { count: "exact", head: true })
      .is("stale_since", null);
    if (tracked.error) throw new Error(tracked.error.message);
    const candidates = await db
      .from("freshdesk_tickets")
      .select("id", { count: "exact", head: true })
      .is("stale_since", null)
      .lt("synced_at", opts.runStartIso);
    if (candidates.error) throw new Error(candidates.error.message);

    const decision = decideStaleSweep({
      mode: opts.mode,
      complete: opts.complete,
      seen: opts.seen,
      candidates: candidates.count ?? 0,
      tracked: tracked.count ?? 0,
    });
    if (!decision.run) {
      return { marked: 0, note: decision.reason === "no stale tickets" ? null : `Stale sweep skipped: ${decision.reason}.` };
    }

    const upd = await db
      .from("freshdesk_tickets")
      .update({ stale_since: (opts.now ?? new Date()).toISOString() })
      .is("stale_since", null)
      .lt("synced_at", opts.runStartIso)
      .select("id");
    if (upd.error) throw new Error(upd.error.message);
    const marked = (upd.data as unknown[] | null)?.length ?? 0;
    return { marked, note: `Marked ${marked} ticket(s) stale (no longer returned by Freshdesk for this group).` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[freshdesk-sync] stale sweep failed:", msg);
    return { marked: 0, note: `Stale sweep failed: ${msg}` };
  }
}
