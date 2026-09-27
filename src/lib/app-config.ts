// SCRUM-101 (G-24): business settings that used to be hard-coded in source.
// Each one can be set with a server environment variable; the default is the
// value that was hard-coded before, so behaviour is unchanged until someone
// deliberately sets a variable. Invalid values are errors (never silently
// replaced by the default), so a typo shows up as a failed, logged sync run.

export interface FreshdeskScope {
  /** Only tickets in this Freshdesk group are synced. */
  groupId: number;
  groupName: string;
  /** Nothing created before this instant is synced (ISO 8601, UTC). */
  ticketsFrom: string;
}

export const DEFAULT_FRESHDESK_SCOPE: FreshdeskScope = {
  groupId: 1060000391179,
  groupName: "Cloud Labs",
  ticketsFrom: "2026-04-01T00:00:00Z",
};

type Env = Record<string, string | undefined>;

const blank = (v: string | undefined) => v === undefined || v.trim() === "";

export function freshdeskScopeFromEnv(env: Env): FreshdeskScope {
  const scope = { ...DEFAULT_FRESHDESK_SCOPE };
  if (!blank(env.FRESHDESK_GROUP_ID)) {
    const v = env.FRESHDESK_GROUP_ID!.trim();
    if (!/^[1-9][0-9]{0,15}$/.test(v)) throw new Error(`FRESHDESK_GROUP_ID must be a Freshdesk group id (digits only), got "${v}"`);
    scope.groupId = Number(v);
  }
  if (!blank(env.FRESHDESK_GROUP_NAME)) scope.groupName = env.FRESHDESK_GROUP_NAME!.trim();
  if (!blank(env.FRESHDESK_TICKETS_FROM)) {
    const v = env.FRESHDESK_TICKETS_FROM!.trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/.test(iso) || Number.isNaN(Date.parse(iso))) {
      throw new Error(`FRESHDESK_TICKETS_FROM must be a UTC date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ), got "${v}"`);
    }
    scope.ticketsFrom = new Date(iso).toISOString().replace(".000Z", "Z");
  }
  return scope;
}

export interface DailyTimeUtc {
  hour: number;
  minute: number;
}

/**
 * Time of the daily snapshot cron, for display only. The real schedule lives in
 * pg_cron; keep SNAPSHOT_CRON_UTC ("HH:MM") equal to it if the schedule changes.
 */
export function snapshotCronFromEnv(env: Env): DailyTimeUtc {
  if (blank(env.SNAPSHOT_CRON_UTC)) return { hour: 2, minute: 0 };
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(env.SNAPSHOT_CRON_UTC!.trim());
  if (!m) throw new Error(`SNAPSHOT_CRON_UTC must be HH:MM (24h, UTC), got "${env.SNAPSHOT_CRON_UTC}"`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function formatDailyTimeUtc(t: DailyTimeUtc): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")} UTC`;
}

export function nextDailyRunAt(now: Date, t: DailyTimeUtc): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), t.hour, t.minute, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
