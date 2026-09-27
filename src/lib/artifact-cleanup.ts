// SCRUM-96 (G-17) slice 3: bulk-import artifact clean-up that never hides a failure.
//
// Before: storage delete errors were ignored, and the path columns were cleared for EVERY
// expired run, even when its files were not deleted. The database then forgot files that were
// still in storage (orphans nobody can find, possibly evidence under review), and the result
// still said "ok". Now a run's paths are cleared only when all of its files were removed, and
// every failure is logged with a ref and reported in the result.
//
// Used by the scheduled hook (/api/public/hooks/bulk-import-cleanup, cron PAUSED, SCRUM-98)
// and the admin "run clean-up" button (runArtifactCleanup). Pure apart from the injected deps.

export interface ExpiredArtifactRow {
  run_id: string;
  original_csv_path: string | null;
  error_artifact_path: string | null;
}

export interface CleanupDeps {
  /** Supabase storage remove for the bucket. */
  remove: (paths: string[]) => Promise<{ error: unknown }>;
  /** rpc clear_bulk_import_artifact_paths(_run_ids) */
  clearPaths: (runIds: string[]) => Promise<{ data: unknown; error: unknown }>;
  /** Logs the error server-side, returns a ref. */
  log: (err: unknown, where: string, extra?: Record<string, unknown>) => string;
}

export interface CleanupSummary {
  ok: boolean;
  dryRun: boolean;
  expiredRuns: number;
  pathsAttempted: number;
  deletedObjects: number;
  csvRemoved: number;
  errorRemoved: number;
  failedObjects: number;
  clearedRows: number;
  /** Runs whose paths were kept because at least one of their files was not removed. */
  runsKept: number;
  errorRefs: string[];
}

export const CLEANUP_CHUNK = 100;

const pathsOf = (r: ExpiredArtifactRow) => [r.original_csv_path, r.error_artifact_path].filter((p): p is string => !!p);

/** Deletes in chunks; returns exactly which paths were removed and a ref per failed chunk. */
export async function removeInChunks(
  paths: string[],
  deps: Pick<CleanupDeps, "remove" | "log">,
  where: string,
  chunkSize = CLEANUP_CHUNK,
): Promise<{ removed: Set<string>; failed: number; refs: string[] }> {
  const removed = new Set<string>();
  const refs: string[] = [];
  let failed = 0;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    let error: unknown = null;
    try {
      ({ error } = await deps.remove(chunk));
    } catch (e) {
      error = e;
    }
    if (error) {
      failed += chunk.length;
      refs.push(deps.log(error, `${where}:storage_remove`, { objects: chunk.length, first: chunk[0] }));
    } else {
      for (const p of chunk) removed.add(p);
    }
  }
  return { removed, failed, refs };
}

/** Runs whose every stored file was removed. Only these may have their path columns cleared. */
export function runsSafeToClear(list: ExpiredArtifactRow[], removed: Set<string>): string[] {
  return list.filter((r) => pathsOf(r).every((p) => removed.has(p))).map((r) => r.run_id);
}

export async function cleanupExpiredArtifacts(
  list: ExpiredArtifactRow[],
  deps: CleanupDeps,
  opts: { dryRun: boolean; where: string },
): Promise<CleanupSummary> {
  const csvPaths = list.map((r) => r.original_csv_path).filter((p): p is string => !!p);
  const errPaths = list.map((r) => r.error_artifact_path).filter((p): p is string => !!p);
  const all = [...csvPaths, ...errPaths];

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      expiredRuns: list.length,
      pathsAttempted: all.length,
      deletedObjects: all.length,
      csvRemoved: csvPaths.length,
      errorRemoved: errPaths.length,
      failedObjects: 0,
      clearedRows: list.length,
      runsKept: 0,
      errorRefs: [],
    };
  }

  const { removed, failed, refs } = await removeInChunks(all, deps, opts.where);
  const safe = runsSafeToClear(list, removed);
  let clearedRows = 0;
  if (safe.length) {
    let res: { data: unknown; error: unknown };
    try {
      res = await deps.clearPaths(safe);
    } catch (e) {
      res = { data: null, error: e };
    }
    if (res.error) refs.push(deps.log(res.error, `${opts.where}:clear_paths`, { runs: safe.length }));
    else clearedRows = Number(res.data ?? 0);
  }

  return {
    ok: refs.length === 0,
    dryRun: false,
    expiredRuns: list.length,
    pathsAttempted: all.length,
    deletedObjects: removed.size,
    csvRemoved: csvPaths.filter((p) => removed.has(p)).length,
    errorRemoved: errPaths.filter((p) => removed.has(p)).length,
    failedObjects: failed,
    clearedRows,
    runsKept: list.length - safe.length,
    errorRefs: refs,
  };
}
