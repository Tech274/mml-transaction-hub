import { useSyncExternalStore } from "react";

export type ExportJob = {
  id: string;
  filename: string;
  scope: string;
  total: number;
  processed: number;
  attempts: number;
  status: "running" | "done" | "error" | "cancelled";
  error?: string;
  errorStack?: string;
  errorName?: string;
  startedAt: number;
  endedAt?: number;
  user?: string;
};

const KEY = "lovable.exportJobs.v1";
const MAX = 100;
const RETENTION_KEY = "lovable.exportJobs.retention.v1";
const LAST_CLEANED_KEY = "lovable.exportJobs.lastCleanedAt.v1";
const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;

let cache: ExportJob[] | null = null;
const listeners = new Set<() => void>();

function read(): ExportJob[] {
  if (cache) return cache;
  if (typeof window === "undefined") return (cache = []);
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as ExportJob[]) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function write(next: ExportJob[]) {
  cache = next.slice(0, MAX);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  }
  for (const l of listeners) l();
}

export function startJob(init: Omit<ExportJob, "id" | "startedAt" | "status" | "processed" | "attempts"> & { processed?: number }): string {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: ExportJob = {
    id,
    filename: init.filename,
    scope: init.scope,
    total: init.total,
    processed: init.processed ?? 0,
    attempts: 1,
    status: "running",
    startedAt: Date.now(),
    user: init.user,
  };
  write([job, ...read()]);
  return id;
}

export function updateJob(id: string, patch: Partial<ExportJob>) {
  const list = read();
  const idx = list.findIndex((j) => j.id === id);
  if (idx < 0) return;
  const next = [...list];
  next[idx] = { ...next[idx], ...patch };
  write(next);
}

export function finishJob(
  id: string,
  status: "done" | "error" | "cancelled",
  error?: { message?: string; name?: string; stack?: string } | string,
) {
  if (typeof error === "string" || !error) {
    updateJob(id, { status, error: typeof error === "string" ? error : undefined, endedAt: Date.now() });
  } else {
    updateJob(id, {
      status,
      error: error.message,
      errorName: error.name,
      errorStack: error.stack,
      endedAt: Date.now(),
    });
  }
}

export function clearJobs() { write([]); }

export function getRetentionDays(): number {
  if (typeof window === "undefined") return DEFAULT_RETENTION_DAYS;
  try {
    const raw = window.localStorage.getItem(RETENTION_KEY);
    const n = raw ? Number(raw) : DEFAULT_RETENTION_DAYS;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
  } catch { return DEFAULT_RETENTION_DAYS; }
}

export function setRetentionDays(days: number) {
  if (typeof window === "undefined") return;
  const n = Math.max(1, Math.floor(days));
  try { window.localStorage.setItem(RETENTION_KEY, String(n)); } catch {}
  for (const l of listeners) l();
}

export function getLastCleanedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_CLEANED_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** Returns when the next automatic cleanup will logically run.
 * Cleanup is triggered when the admin Export Jobs panel mounts; this value
 * is the earliest point at which mounting the panel would actually delete
 * a job under the current retention setting (lastCleaned + retentionDays).
 * If cleanup has never run, returns null. */
export function getNextCleanupAt(days?: number): number | null {
  const last = getLastCleanedAt();
  if (last == null) return null;
  const d = days ?? getRetentionDays();
  return last + d * 24 * 60 * 60 * 1000;
}

export function validateRetentionDays(n: number): string | null {
  if (!Number.isFinite(n)) return "Enter a number";
  if (!Number.isInteger(n)) return "Must be a whole number of days";
  if (n < 1) return "Must be at least 1 day";
  if (n > MAX_RETENTION_DAYS) return `Must be ${MAX_RETENTION_DAYS} days or fewer`;
  return null;
}

/** Delete jobs older than retention. Returns number of jobs removed. */
export function runCleanup(days?: number): number {
  const d = days ?? getRetentionDays();
  const cutoff = Date.now() - d * 24 * 60 * 60 * 1000;
  const list = read();
  const next = list.filter((j) => (j.endedAt ?? j.startedAt) >= cutoff);
  const removed = list.length - next.length;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(LAST_CLEANED_KEY, String(Date.now())); } catch {}
  }
  if (removed > 0) write(next); else for (const l of listeners) l();
  return removed;
}

// ---- Retry registry --------------------------------------------------------
// Pages that own an export (e.g. /customers) register a handler keyed by the
// job scope. The admin "View error" drawer can then re-trigger the job using
// the same request parameters by invoking the handler. Handlers live in
// module memory only — if the owning page is unmounted, retry is unavailable
// and the caller should prompt the user to navigate to that page.

export type RetryHandler = () => void | Promise<void>;
const retryHandlers = new Map<string, RetryHandler>();

export function registerRetryHandler(scope: string, fn: RetryHandler): () => void {
  retryHandlers.set(scope, fn);
  for (const l of listeners) l();
  return () => {
    if (retryHandlers.get(scope) === fn) {
      retryHandlers.delete(scope);
      for (const l of listeners) l();
    }
  };
}

export function hasRetryHandler(scope: string): boolean {
  return retryHandlers.has(scope);
}

/** Returns true if a handler ran; false if no handler is registered. */
export function retryJob(job: Pick<ExportJob, "id" | "scope">): boolean {
  const fn = retryHandlers.get(job.scope);
  if (!fn) return false;
  // Mark the failed job as cancelled/retried so it stops showing as "error"
  // in the list; the handler creates a new running job entry.
  updateJob(job.id, { status: "cancelled", endedAt: Date.now() });
  Promise.resolve(fn()).catch(() => {});
  return true;
}

export function useExportJobs(): ExportJob[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => read(),
    () => [],
  );
}
