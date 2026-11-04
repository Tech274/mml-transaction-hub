// SCRUM-128 C8: the Import history and Import audit log list maths, moved verbatim from
// components/bulk-import-history.tsx and components/bulk-import-audit-log.tsx so the values are
// pinned by lib/__tests__/import-history-view.test.ts before the UI rewrite. No logic change.

/** The columns of bulk_import_runs the Import history filter reads. */
export interface ImportRunFilterRow {
  filename: string;
  user_email: string | null;
  status: string;
  created_at: string;
}

export interface ImportRunFilter {
  search: string;
  /** "all" or a run status. */
  status: string;
  /** yyyy-mm-dd or "". */
  fromDate: string;
  /** yyyy-mm-dd or "" (inclusive to 23:59:59 local). */
  toDate: string;
}

/** Import history filter (was the `filtered` useMemo in bulk-import-history.tsx). */
export function filterImportRuns<T extends ImportRunFilterRow>(
  runs: readonly T[],
  { search, status: statusF, fromDate, toDate }: ImportRunFilter,
): T[] {
  const q = search.trim().toLowerCase();
  return runs.filter((r) => {
    if (
      q &&
      !r.filename.toLowerCase().includes(q) &&
      !(r.user_email ?? "").toLowerCase().includes(q)
    )
      return false;
    if (statusF !== "all" && r.status !== statusF) return false;
    if (fromDate && new Date(r.created_at) < new Date(fromDate)) return false;
    if (toDate && new Date(r.created_at) > new Date(toDate + "T23:59:59")) return false;
    return true;
  });
}

/**
 * Per-status counts for one run from bulk_import_row_audit (was the `summary` useMemo in
 * RunDetails): valid = imported + updated + linked; invalid = error.
 */
export function runAuditSummary(rows: readonly { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {
    valid: 0,
    error: 0,
    imported: 0,
    updated: 0,
    linked: 0,
    skipped: 0,
  };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  counts.valid = (counts.imported ?? 0) + (counts.updated ?? 0) + (counts.linked ?? 0);
  counts.invalid = counts.error ?? 0;
  return counts;
}

/** The columns of bulk_import_audit_events the Import audit log filter reads. */
export interface ImportAuditFilterRow {
  run_id: string | null;
  parent_run_id: string | null;
  event_type: string;
  details: { line_numbers?: number[]; [k: string]: unknown } | null;
}

/** Import audit log filter (was the `filtered` useMemo in bulk-import-audit-log.tsx). */
export function filterImportAuditEvents<T extends ImportAuditFilterRow>(
  rows: readonly T[],
  { runId, eventType, line }: { runId: string; eventType: string; line: string },
): T[] {
  const idQ = runId.trim().toLowerCase();
  const lineQ = line.trim() ? Number(line.trim()) : null;
  return rows.filter((r) => {
    if (eventType !== "all" && r.event_type !== eventType) return false;
    if (idQ) {
      const inRun = (r.run_id ?? "").toLowerCase().includes(idQ);
      const inParent = (r.parent_run_id ?? "").toLowerCase().includes(idQ);
      if (!inRun && !inParent) return false;
    }
    if (lineQ !== null && !Number.isNaN(lineQ)) {
      const nums = (r.details?.line_numbers ?? []) as number[];
      if (!nums.includes(lineQ)) return false;
    }
    return true;
  });
}
