// SCRUM-92 (G-08): incremental Freshdesk sync.
// Before: every hourly run asked Freshdesk for everything updated since the fixed
// start date (2026-04-01) and walked every page, which is slow, burns API quota, and
// page drift left about a third of tickets stale.
// Now: an hourly run asks only for tickets updated since the last *successful*
// run started (minus a 10-minute overlap). Once a day (default 21:00 UTC =
// 02:30 IST) and whenever there is no successful run on record, a full pass runs.
// Upserts are keyed on ticket id, so overlap and re-fetching are harmless.

export type SyncMode = "incremental" | "full";

export interface CursorInput {
  now: Date;
  /** started_at of the newest successful freshdesk run, or null if none. */
  lastSuccessStartedAt: string | null;
  /** Configured lower bound (FRESHDESK_TICKETS_FROM). */
  ticketsFrom: string;
  /** Hour (UTC) of the daily full pass; null disables it. */
  fullSyncHourUtc: number | null;
  overlapMinutes?: number;
  forceFull?: boolean;
}

export interface CursorDecision {
  mode: SyncMode;
  updatedSince: string;
  reason: string;
}

export function decideSyncWindow(i: CursorInput): CursorDecision {
  const overlap = (i.overlapMinutes ?? 10) * 60_000;
  const floor = Date.parse(i.ticketsFrom);
  const full = (reason: string): CursorDecision => ({ mode: "full", updatedSince: new Date(floor).toISOString(), reason });
  if (i.forceFull) return full("full sync requested");
  if (!i.lastSuccessStartedAt || Number.isNaN(Date.parse(i.lastSuccessStartedAt))) return full("no successful run on record");
  if (i.fullSyncHourUtc !== null && i.now.getUTCHours() === i.fullSyncHourUtc) return full("daily full pass");
  const since = Math.max(floor, Date.parse(i.lastSuccessStartedAt) - overlap);
  return { mode: "incremental", updatedSince: new Date(since).toISOString(), reason: "since last successful run (10 min overlap)" };
}

export function fullSyncHourFromEnv(env: Record<string, string | undefined>): number | null {
  const v = env.FRESHDESK_FULL_SYNC_HOUR_UTC?.trim();
  if (v === undefined || v === "") return 21;
  if (v.toLowerCase() === "off") return null;
  if (!/^([01]?\d|2[0-3])$/.test(v)) throw new Error(`FRESHDESK_FULL_SYNC_HOUR_UTC must be 0-23 or "off", got "${v}"`);
  return Number(v);
}

/**
 * What a run that read `complete` (true = reached the end) should record.
 * Incremental + incomplete = failure (the cursor must not move past unread pages).
 * Full + incomplete = success with a visible note (same coverage as before SCRUM-92).
 */
export function runOutcome(mode: SyncMode, complete: boolean, maxPages: number, saved: number): { failure: string | null; note: string | null } {
  if (complete) return { failure: null, note: null };
  if (mode === "incremental") {
    return {
      failure: `Stopped at the page limit (${maxPages} pages) before reaching the end; saved ${saved} tickets. The next run starts again from the last successful run.`,
      note: null,
    };
  }
  return { failure: null, note: `Warning: full pass stopped at the page limit (${maxPages} pages); older updates were not re-read.` };
}
