// SCRUM-128 C8 value pins for Import history / Import audit log, written before the UI rewrite.
// The oracles below are the inline code from bulk-import-history.tsx and bulk-import-audit-log.tsx
// at 4680807, copied unchanged.
import { describe, expect, it } from "vitest";
import {
  filterImportAuditEvents,
  filterImportRuns,
  runAuditSummary,
  type ImportAuditFilterRow,
  type ImportRunFilterRow,
} from "@/lib/import-history-view";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

const STATUSES = ["pending", "completed", "failed", "cancelled"];
const ROW_STATUSES = ["valid", "error", "imported", "updated", "linked", "skipped", "other"];
const EVENTS = [
  "import_started",
  "import_completed",
  "import_failed",
  "run_cancelled",
  "retry_started",
];

function runs(seed: number): ImportRunFilterRow[] {
  const r = rng(seed);
  return Array.from({ length: 40 }, (_, i) => ({
    filename: pick(r, ["Jan-Private.csv", "feb public.xlsx", "Q3 mixed.csv", "batch-7.csv"]),
    user_email: r() < 0.2 ? null : pick(r, ["ops@mml.local", "Lead@MML.local", "viewer@mml.local"]),
    status: pick(r, STATUSES),
    created_at: new Date(
      Date.UTC(2026, Math.floor(r() * 10), 1 + Math.floor(r() * 28), Math.floor(r() * 24)),
    ).toISOString(),
    i,
  }));
}

// Oracle: bulk-import-history.tsx `filtered` useMemo body at 4680807.
function oracleFilterRuns(
  runs: ImportRunFilterRow[],
  search: string,
  statusF: string,
  fromDate: string,
  toDate: string,
) {
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

// Oracle: RunDetails `summary` useMemo body at 4680807.
function oracleSummary(rows: { status: string }[]) {
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

// Oracle: bulk-import-audit-log.tsx `filtered` useMemo body at 4680807.
function oracleFilterAudit(
  rows: ImportAuditFilterRow[],
  runId: string,
  eventType: string,
  line: string,
) {
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

describe("Import history filter (moved verbatim)", () => {
  it("matches the old inline filter on 300 random fixtures", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 7);
      const data = runs(seed);
      const search = pick(r, ["", "csv", " LEAD ", "mixed", "nobody"]);
      const status = pick(r, ["all", ...STATUSES]);
      const fromDate = pick(r, ["", "2026-03-01", "2026-06-15"]);
      const toDate = pick(r, ["", "2026-05-31", "2026-09-30"]);
      expect(filterImportRuns(data, { search, status, fromDate, toDate })).toEqual(
        oracleFilterRuns(data, search, status, fromDate, toDate),
      );
    }
  });

  it("literal pins", () => {
    const data: ImportRunFilterRow[] = [
      {
        filename: "Jan.csv",
        user_email: "ops@mml.local",
        status: "completed",
        created_at: "2026-01-10T05:00:00Z",
      },
      {
        filename: "Feb.csv",
        user_email: null,
        status: "failed",
        created_at: "2026-02-10T05:00:00Z",
      },
      {
        filename: "Mar.xlsx",
        user_email: "lead@mml.local",
        status: "pending",
        created_at: "2026-03-10T05:00:00Z",
      },
    ];
    const all = { search: "", status: "all", fromDate: "", toDate: "" };
    expect(filterImportRuns(data, all)).toHaveLength(3);
    expect(filterImportRuns(data, { ...all, search: "LEAD" }).map((r) => r.filename)).toEqual([
      "Mar.xlsx",
    ]);
    expect(filterImportRuns(data, { ...all, status: "failed" }).map((r) => r.filename)).toEqual([
      "Feb.csv",
    ]);
    expect(
      filterImportRuns(data, { ...all, fromDate: "2026-02-01", toDate: "2026-02-28" }).map(
        (r) => r.filename,
      ),
    ).toEqual(["Feb.csv"]);
  });
});

describe("Run detail summary (moved verbatim)", () => {
  it("matches the old inline counts on 300 random fixtures", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 13);
      const rows = Array.from({ length: Math.floor(r() * 30) }, () => ({
        status: pick(r, ROW_STATUSES),
      }));
      expect(runAuditSummary(rows)).toEqual(oracleSummary(rows));
    }
  });

  it("literal pins: valid = imported + updated + linked, invalid = error", () => {
    const rows = ["imported", "imported", "updated", "linked", "error", "skipped", "valid"].map(
      (status) => ({ status }),
    );
    expect(runAuditSummary(rows)).toEqual({
      valid: 4,
      error: 1,
      imported: 2,
      updated: 1,
      linked: 1,
      skipped: 1,
      invalid: 1,
    });
    expect(runAuditSummary([])).toEqual({
      valid: 0,
      error: 0,
      imported: 0,
      updated: 0,
      linked: 0,
      skipped: 0,
      invalid: 0,
    });
  });
});

describe("Import audit log filter (moved verbatim)", () => {
  it("matches the old inline filter on 300 random fixtures", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 31);
      const rows: ImportAuditFilterRow[] = Array.from({ length: 30 }, () => ({
        run_id: r() < 0.1 ? null : pick(r, ["a1b2c3", "A1B2ff", "9988aa", "77cc00"]),
        parent_run_id: r() < 0.6 ? null : pick(r, ["a1b2c3", "deadbe"]),
        event_type: pick(r, EVENTS),
        details:
          r() < 0.2
            ? null
            : {
                line_numbers: Array.from(
                  { length: Math.floor(r() * 4) },
                  () => 1 + Math.floor(r() * 6),
                ),
              },
      }));
      const runId = pick(r, ["", "a1b2", " DEAD ", "zz"]);
      const eventType = pick(r, ["all", ...EVENTS]);
      const line = pick(r, ["", "2", " 5 ", "x"]);
      expect(filterImportAuditEvents(rows, { runId, eventType, line })).toEqual(
        oracleFilterAudit(rows, runId, eventType, line),
      );
    }
  });
});
