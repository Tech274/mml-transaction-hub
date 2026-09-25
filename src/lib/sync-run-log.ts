// SCRUM-74 (G-07): write one sync_runs row per scheduled/manual job run.
// Server-only callers pass the service-role client. Logging problems are
// reported with console.error (never silently ignored) but do not stop the job.
type Db = { from: (t: string) => any };

export interface RunStart {
  kind: "freshdesk" | "snapshot";
  trigger_source: "cron" | "manual";
  triggered_by?: string | null;
  triggered_by_email?: string | null;
}

export interface RunFinish {
  status: "success" | "error";
  duration_ms: number;
  error_message?: string | null;
  fetched_count?: number;
  upserted_count?: number;
}

export async function startRun(db: Db, run: RunStart): Promise<string | null> {
  const { data, error } = await db
    .from("sync_runs")
    .insert({
      kind: run.kind,
      trigger_source: run.trigger_source,
      status: "running",
      triggered_by: run.triggered_by ?? null,
      triggered_by_email: run.triggered_by_email ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error(`[sync-run-log] could not record start of ${run.kind} run:`, error?.message ?? "no row returned");
    return null;
  }
  return data.id as string;
}

export async function finishRun(db: Db, id: string | null, f: RunFinish): Promise<void> {
  if (!id) return;
  const base = {
    status: f.status,
    finished_at: new Date().toISOString(),
    duration_ms: f.duration_ms,
    error_message: f.error_message ?? null,
  };
  const counts: Record<string, number> = {};
  if (f.fetched_count !== undefined) counts.fetched_count = f.fetched_count;
  if (f.upserted_count !== undefined) counts.upserted_count = f.upserted_count;
  const { error } = await db.from("sync_runs").update({ ...base, ...counts }).eq("id", id);
  if (!error) return;
  console.error(`[sync-run-log] could not record finish of run ${id} (retrying without counts):`, error.message);
  // Counts columns come from the SCRUM-74 migration; keep the status even if it is not applied yet.
  const retry = await db.from("sync_runs").update(base).eq("id", id);
  if (retry.error) console.error(`[sync-run-log] could not record finish of run ${id}:`, retry.error.message);
}
