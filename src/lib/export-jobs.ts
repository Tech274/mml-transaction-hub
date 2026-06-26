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

export function useExportJobs(): ExportJob[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => read(),
    () => [],
  );
}