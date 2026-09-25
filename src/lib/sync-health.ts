// SCRUM-74 (G-07) / SCRUM-72: health of a scheduled job from its sync_runs rows.
// Pure function (unit-tested). The Sync Status page shows the result and raises
// an in-app alert after 2 failures in a row or when the last success is too old.
export type SyncHealthState = "ok" | "warning" | "failing" | "stale" | "never";

export interface RunLike {
  status: string; // "running" | "success" | "error"
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

export interface SyncHealth {
  state: SyncHealthState;
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  runsLast24h: number;
  failuresLast24h: number;
  lastError: string | null;
  message: string;
}

export interface SyncHealthOptions {
  /** Alert when the newest N finished runs all failed. */
  failingAfter: number;
  /** Alert when the last success is older than this. */
  staleAfterMinutes: number;
  /** A run still "running" after this long is counted as a failure (it never finished). */
  stuckAfterMinutes: number;
}

export const FRESHDESK_HEALTH: SyncHealthOptions = { failingAfter: 2, staleAfterMinutes: 180, stuckAfterMinutes: 30 };

const MIN = 60_000;

function isFailure(r: RunLike, now: number, o: SyncHealthOptions): boolean | null {
  if (r.status === "error") return true;
  if (r.status === "success") return false;
  // running (or unknown): only a failure once it is clearly stuck
  return now - Date.parse(r.started_at) > o.stuckAfterMinutes * MIN ? true : null;
}

export function summarizeSyncHealth(runs: RunLike[], now: Date, o: SyncHealthOptions = FRESHDESK_HEALTH): SyncHealth {
  const t = now.getTime();
  const sorted = [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const lastSuccess = sorted.find((r) => r.status === "success") ?? null;
  const lastSuccessAt = lastSuccess ? (lastSuccess.finished_at ?? lastSuccess.started_at) : null;

  let consecutiveFailures = 0;
  let lastError: string | null = null;
  for (const r of sorted) {
    const f = isFailure(r, t, o);
    if (f === null) continue; // still running, not yet judged
    if (!f) break;
    consecutiveFailures += 1;
    lastError ??= r.error_message ?? (r.status === "error" ? "Failed without a message" : "Run did not finish");
  }

  const recent = sorted.filter((r) => t - Date.parse(r.started_at) <= 24 * 60 * MIN);
  const failuresLast24h = recent.filter((r) => isFailure(r, t, o) === true).length;

  let state: SyncHealthState;
  let message: string;
  if (sorted.length === 0) {
    state = "never";
    message = "No runs recorded yet.";
  } else if (consecutiveFailures >= o.failingAfter) {
    state = "failing";
    message = `The last ${consecutiveFailures} runs failed.`;
  } else if (!lastSuccessAt || t - Date.parse(lastSuccessAt) > o.staleAfterMinutes * MIN) {
    state = "stale";
    message = lastSuccessAt ? `No successful run for more than ${Math.round(o.staleAfterMinutes / 60)} hours.` : "No successful run recorded.";
  } else if (consecutiveFailures > 0) {
    state = "warning";
    message = "The most recent run failed.";
  } else {
    state = "ok";
    message = "Healthy.";
  }

  return {
    state,
    lastSuccessAt,
    lastRunAt: sorted[0]?.started_at ?? null,
    consecutiveFailures,
    runsLast24h: recent.length,
    failuresLast24h,
    lastError,
    message,
  };
}
