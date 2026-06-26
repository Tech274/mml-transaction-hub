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

export function useExportJobs(): ExportJob[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => read(),
    () => [],
  );
}