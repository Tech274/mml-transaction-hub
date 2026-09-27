// SCRUM-96 slice 3: artifact clean-up and Sync Status counts never hide a failure.
import { describe, it, expect, vi } from "vitest";
import { cleanupExpiredArtifacts, removeInChunks, runsSafeToClear, type CleanupDeps, type ExpiredArtifactRow } from "../artifact-cleanup";
import { countLabel, countOrNull } from "../sync-health";

const rows: ExpiredArtifactRow[] = [
  { run_id: "r1", original_csv_path: "a/1.csv", error_artifact_path: "a/1.json" },
  { run_id: "r2", original_csv_path: "a/2.csv", error_artifact_path: null },
  { run_id: "r3", original_csv_path: null, error_artifact_path: null },
];

function deps(over: Partial<CleanupDeps> = {}) {
  const log = vi.fn((_e: unknown, _w: string) => "REF00001");
  const clearPaths = vi.fn(async (ids: string[]) => ({ data: ids.length, error: null }));
  const remove = vi.fn(async (_p: string[]) => ({ error: null }));
  return { log, clearPaths, remove, ...over } as CleanupDeps & { log: typeof log; clearPaths: typeof clearPaths; remove: typeof remove };
}

describe("cleanupExpiredArtifacts", () => {
  it("all deletes succeed: every run is cleared and ok is true", async () => {
    const d = deps();
    const s = await cleanupExpiredArtifacts(rows, d, { dryRun: false, where: "t" });
    expect(s).toMatchObject({ ok: true, pathsAttempted: 3, deletedObjects: 3, failedObjects: 0, clearedRows: 3, runsKept: 0, errorRefs: [] });
    expect(d.clearPaths).toHaveBeenCalledWith(["r1", "r2", "r3"]);
  });

  it("a failed storage delete keeps that run's paths and reports the failure (used to clear them all)", async () => {
    const d = deps({ remove: vi.fn(async () => ({ error: { message: "storage 500" } })) });
    const s = await cleanupExpiredArtifacts(rows, d, { dryRun: false, where: "t" });
    expect(s.ok).toBe(false);
    expect(s.failedObjects).toBe(3);
    expect(s.deletedObjects).toBe(0);
    // r3 had no files, so clearing it loses nothing; r1/r2 keep their paths.
    expect(d.clearPaths).toHaveBeenCalledWith(["r3"]);
    expect(s.runsKept).toBe(2);
    expect(s.errorRefs).toEqual(["REF00001"]);
    expect(d.log).toHaveBeenCalledWith({ message: "storage 500" }, "t:storage_remove", expect.any(Object));
  });

  it("a thrown storage error is treated like a returned one", async () => {
    const d = deps({ remove: vi.fn(async () => { throw new Error("network"); }) });
    const s = await cleanupExpiredArtifacts(rows, d, { dryRun: false, where: "t" });
    expect(s.ok).toBe(false);
    expect(s.failedObjects).toBe(3);
  });

  it("a failed path clear is logged, not counted as cleared", async () => {
    const d = deps({ clearPaths: vi.fn(async () => ({ data: null, error: { code: "42501" } })) });
    const s = await cleanupExpiredArtifacts(rows, d, { dryRun: false, where: "t" });
    expect(s.ok).toBe(false);
    expect(s.clearedRows).toBe(0);
    expect(s.deletedObjects).toBe(3);
    expect(s.errorRefs).toHaveLength(1);
  });

  it("dry run touches nothing", async () => {
    const d = deps();
    const s = await cleanupExpiredArtifacts(rows, d, { dryRun: true, where: "t" });
    expect(d.remove).not.toHaveBeenCalled();
    expect(d.clearPaths).not.toHaveBeenCalled();
    expect(s).toMatchObject({ ok: true, dryRun: true, pathsAttempted: 3, csvRemoved: 2, errorRemoved: 1 });
  });

  it("no expired runs: no calls, ok", async () => {
    const d = deps();
    const s = await cleanupExpiredArtifacts([], d, { dryRun: false, where: "t" });
    expect(s).toMatchObject({ ok: true, expiredRuns: 0, clearedRows: 0 });
    expect(d.clearPaths).not.toHaveBeenCalled();
  });
});

describe("removeInChunks / runsSafeToClear", () => {
  it("chunks by 100 and only the failed chunk is missing", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `p${i}`);
    let call = 0;
    const remove = vi.fn(async () => ({ error: call++ === 1 ? { message: "boom" } : null }));
    const r = await removeInChunks(paths, { remove, log: () => "R" }, "t");
    expect(remove).toHaveBeenCalledTimes(3);
    expect(r.removed.size).toBe(150);
    expect(r.failed).toBe(100);
    expect(r.removed.has("p99")).toBe(true);
    expect(r.removed.has("p100")).toBe(false);
  });
  it("a run is safe only when all of its files are gone", () => {
    expect(runsSafeToClear(rows, new Set(["a/1.csv", "a/2.csv"]))).toEqual(["r2", "r3"]);
  });
});

describe("Sync Status counts", () => {
  it("a failed count is null (shown as 'unavailable'), never 0", () => {
    const onError = vi.fn();
    expect(countOrNull({ count: null, error: { message: "x" } }, onError)).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    expect(countOrNull({ count: 12, error: null }, onError)).toBe(12);
    expect(countOrNull({ count: null, error: null }, onError)).toBe(0);
    expect(countLabel(null)).toBe("unavailable");
    expect(countLabel(1234)).toBe((1234).toLocaleString());
  });
});

const src = import.meta.glob(["/src/routes/api/public/hooks/bulk-import-cleanup.ts", "/src/lib/bulk-import.functions.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("both clean-up entry points use the shared helper", () => {
  it.each(Object.keys(src))("%s", (file) => {
    expect(src[file]).toContain("cleanupExpiredArtifacts(");
    expect(src[file]).not.toMatch(/if \(!error\) (deleted|removed) \+=/);
  });
});
