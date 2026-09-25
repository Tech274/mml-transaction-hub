// SCRUM-72: scheduled hooks answer at once and do the work in the background.
//
// Why: pg_cron calls the hooks through pg_net, which gives up after 5 seconds by
// default. The sync used to run inside that request, so the caller timed out,
// and on Workers the work could be cut off with the sync_runs row left "running".
//
// Now a hook replies 202 straight away and hands the job to the platform's
// waitUntil (Cloudflare Workers via nitro sets request.waitUntil). If the host
// has no waitUntil, the job runs inline as before, so nothing breaks elsewhere.
// Either way the job gets a time budget (HOOK_TIMEOUT_SECONDS, default 25 s: under
// Cloudflare's ~30 s limit for work after the response).

export const DEFAULT_HOOK_TIMEOUT_SECONDS = 25;
export const MIN_HOOK_TIMEOUT_SECONDS = 5;
export const MAX_HOOK_TIMEOUT_SECONDS = 900;

/** Reads HOOK_TIMEOUT_SECONDS. A bad value is logged and the default is used: a
 * scheduled job should not stop running because of a typo in a setting. */
export function hookTimeoutMsFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.HOOK_TIMEOUT_SECONDS?.trim();
  if (!raw) return DEFAULT_HOOK_TIMEOUT_SECONDS * 1000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_HOOK_TIMEOUT_SECONDS || n > MAX_HOOK_TIMEOUT_SECONDS) {
    console.error(
      `[hooks] HOOK_TIMEOUT_SECONDS must be a whole number from ${MIN_HOOK_TIMEOUT_SECONDS} to ${MAX_HOOK_TIMEOUT_SECONDS}, got "${raw}"; using ${DEFAULT_HOOK_TIMEOUT_SECONDS}`,
    );
    return DEFAULT_HOOK_TIMEOUT_SECONDS * 1000;
  }
  return n * 1000;
}

export class HookTimeoutError extends Error {
  constructor(job: string, ms: number) {
    super(`${job} did not finish within ${Math.round(ms / 1000)} s`);
    this.name = "HookTimeoutError";
  }
}

/** Rejects with HookTimeoutError if `p` has not settled after `ms`. Does not cancel `p`;
 * jobs that can stop cleanly also receive the deadline (see HookJob.run). */
export function withTimeout<T>(p: Promise<T>, ms: number, job: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HookTimeoutError(job, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

type WaitUntil = (p: Promise<unknown>) => void;

/** request.waitUntil as set by nitro/srvx on Cloudflare; null when the host has none. */
export function waitUntilFor(request: Request): WaitUntil | null {
  const w = (request as unknown as { waitUntil?: unknown }).waitUntil;
  return typeof w === "function" ? (w as WaitUntil) : null;
}

export interface HookJobResult {
  ok: boolean;
  /** Logged in background mode; returned as the response body in inline mode. */
  body: unknown;
}

export interface HookJob {
  name: string;
  timeoutMs: number;
  /** `deadline` is an epoch-ms time the job should aim to finish (and record its status) before. */
  run: (deadline: number) => Promise<HookJobResult>;
}

/** A small margin so the hard timeout fires only if the job ignores its deadline. */
const HARD_TIMEOUT_GRACE_MS = 2000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Reply 202 now and run the job in the background (waitUntil), or run it inline if
 * the host has no waitUntil. Background results and failures go to the logs; the
 * jobs themselves also record their outcome (e.g. sync_runs), which Sync Status shows.
 */
export async function respondThenRun(request: Request, job: HookJob, now: () => number = Date.now): Promise<Response> {
  const deadline = now() + job.timeoutMs;
  const hardMs = job.timeoutMs + HARD_TIMEOUT_GRACE_MS;
  const waitUntil = waitUntilFor(request);

  if (waitUntil) {
    const task = withTimeout(job.run(deadline), hardMs, job.name).then(
      (r) => {
        if (r.ok) console.log(`[hooks] ${job.name} finished:`, JSON.stringify(r.body));
        else console.error(`[hooks] ${job.name} failed:`, JSON.stringify(r.body));
      },
      (e) => console.error(`[hooks] ${job.name} failed:`, describe(e)),
    );
    waitUntil(task);
    return json({ accepted: true, job: job.name, mode: "background", timeout_seconds: Math.round(job.timeoutMs / 1000) }, 202);
  }

  try {
    const r = await withTimeout(job.run(deadline), hardMs, job.name);
    return json(r.body, r.ok ? 200 : 500);
  } catch (e) {
    console.error(`[hooks] ${job.name} failed:`, describe(e));
    return json({ ok: false, job: job.name, error: describe(e) }, e instanceof HookTimeoutError ? 504 : 500);
  }
}
