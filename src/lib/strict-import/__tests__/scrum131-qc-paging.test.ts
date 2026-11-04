// SCRUM-131 Eng QC S5: the sign-off detail reads every staged row and every Healer fix, in pages of 1000, so a
// file over PostgREST's db-max-rows (1000 on Supabase) is never shown partially. PGlite with the adapter capping
// each read at 1000 rows, like PostgREST. Synthetic data only.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createApprovalDb, submitAs, USERS } from "@/test-support/scrum131-db";
import { pgUntypedDb } from "@/test-support/pg-untyped-db";
import { synthetic131Csv, synthetic131Rows } from "@/test-support/scrum131-fixture";
import { DETAIL_PAGE, getApprovalStageDetail } from "../approval-queries";

/** 4 copies of the synthetic 131 file with distinct PIDs: 1,368 rows and well over 1,000 Healer fixes. */
function bigCsv(): string {
  const rows = [0, 1, 2, 3].flatMap((k) => synthetic131Rows().map((r) => ({ ...r, potentialId: `${r.potentialId}-P${k}` })));
  return synthetic131Csv(rows);
}

describe("SCRUM-131 QC S5: sign-off reads are paged", () => {
  let db: PGlite;
  let stageId: string;
  let rowCount: number;
  let fixCount: number;
  beforeAll(async () => {
    db = await createApprovalDb();
    const res = await submitAs(db, USERS.OPS, bigCsv(), "qc-big.csv");
    stageId = res.stageId;
    rowCount = res.rows;
    fixCount = (await db.query<{ n: number }>("select count(*)::int n from public.import_corrections where stage_id = $1", [stageId])).rows[0].n;
  }, 240_000);

  it("the file is over the 1000-row cap in both rows and fixes (and the adapter really caps)", async () => {
    expect(DETAIL_PAGE).toBe(1000);
    expect(rowCount).toBeGreaterThan(1000);
    expect(fixCount).toBeGreaterThan(1000);
    const capped = await pgUntypedDb(db, as(USERS.CHIEF), { maxRows: 1000 })
      .from<unknown[]>("import_stage_rows")
      .select("source_line")
      .eq("stage_id", stageId)
      .range(0, 4999);
    expect((capped.data as unknown[]).length).toBe(1000);
  });

  it("the approver sees every row and every fix, once each, in order", async () => {
    const view = pgUntypedDb(db, as(USERS.CHIEF), { maxRows: 1000 });
    const d = await getApprovalStageDetail(view, USERS.CHIEF, stageId);
    if (!d.ok) throw new Error(d.message);
    expect(d.rows).toHaveLength(rowCount);
    expect(new Set(d.rows.map((r) => r.source_line)).size).toBe(rowCount);
    expect(d.rows.map((r) => r.source_line)).toEqual([...d.rows.map((r) => r.source_line)].sort((a, b) => a - b));
    expect(d.corrections).toHaveLength(fixCount);
    expect(d.stage.correction_count).toBe(fixCount);
    const reads = view.log.filter((s) => /from public\."import_(stage_rows|corrections)"/.test(s));
    expect(reads.some((s) => /offset 1000/.test(s))).toBe(true);
    expect(reads.filter((s) => /import_corrections/.test(s)).every((s) => /order by "source_line" asc, "id" asc/.test(s))).toBe(true);
  });
});
