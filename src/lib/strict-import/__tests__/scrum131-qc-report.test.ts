// SCRUM-131 Eng QC S2: the Healer report Chief signs off is recomputed and checked by the database; a tampered
// client copy is ignored or refused. PGlite, all migrations (NOT APPLIED to any hosted DB). Synthetic data only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createApprovalDb, submitAs, USERS } from "@/test-support/scrum131-db";
import { synthetic131Csv, synthetic131Rows } from "@/test-support/scrum131-fixture";
import type { StageRpcPayload } from "../service";
import { HEALER_RULES } from "../healer";

const nonZero = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([, n]) => n > 0));

type Summary = Record<string, unknown> & { fixed_by_rule: Record<string, number> };
let seq = 0;
/** A distinct copy of the synthetic 131 file (different PIDs -> different SHA-256), with Healer fixes in it. */
function file(): string {
  seq += 1;
  return synthetic131Csv(synthetic131Rows().map((r) => ({ ...r, potentialId: `${r.potentialId}-QC${seq}` })));
}

async function stored(db: PGlite, stageId: string) {
  const s = await db.query<{ summary: Summary; correction_count: number; warning_row_count: number }>(
    "select summary, correction_count, warning_row_count from public.import_stages where id = $1",
    [stageId],
  );
  const byRule = await db.query<{ rule: string; n: number }>(
    "select rule, count(*)::int n from public.import_corrections where stage_id = $1 group by rule order by rule",
    [stageId],
  );
  return { ...s.rows[0], byRule: Object.fromEntries(byRule.rows.map((r) => [r.rule, r.n])) };
}

const FORGED_SUMMARY = {
  healer_version: "forged",
  fixed_by_rule: { "date.reorder_to_iso": 9999, "forged.rule": 7 },
  warning_count: 0,
  warnings_by_type: { forged: 3 },
  blocker_count: 5,
  new_customers: ["Forged Customer Ltd"],
  correction_count: 1,
  blank_rows_ignored: 2,
  extra_key: "should not be stored",
};

describe("SCRUM-131 QC S2: the Healer report is recomputed from the staged rows", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createApprovalDb();
  }, 120_000);

  it("an honest submit stores a summary that equals the corrections and rows", async () => {
    let sent: StageRpcPayload | null = null;
    const res = await submitAs(db, USERS.OPS, file(), "qc-honest.csv", { tamper: (p) => ((sent = p), p) });
    const s = await stored(db, res.stageId);
    expect(res.correctionCount).toBeGreaterThan(0);
    expect(s.summary.recomputed_by).toBe("stage_import");
    expect(nonZero(s.summary.fixed_by_rule)).toEqual(s.byRule);
    expect(Object.keys(s.summary.fixed_by_rule).sort()).toEqual([...HEALER_RULES].sort());
    expect(s.summary.fixed_by_rule).toEqual((sent as unknown as StageRpcPayload).p_summary.fixed_by_rule);
    expect(s.summary.correction_count).toBe(res.correctionCount);
    expect(s.summary.blocker_count).toBe(0);
  });

  it("a tampered client summary is ignored: counts come from the rows and corrections", async () => {
    const res = await submitAs(db, USERS.OPS, file(), "qc-forged-summary.csv", {
      tamper: (p) => ({ ...p, p_summary: FORGED_SUMMARY }),
    });
    const s = await stored(db, res.stageId);
    expect(nonZero(s.summary.fixed_by_rule)).toEqual(s.byRule);
    expect(Object.keys(s.summary.fixed_by_rule).sort()).toEqual([...HEALER_RULES].sort());
    expect(s.summary.fixed_by_rule["forged.rule"]).toBeUndefined();
    expect(s.summary.fixed_by_rule["date.reorder_to_iso"]).not.toBe(9999);
    expect(s.summary.correction_count).toBe(res.correctionCount);
    expect(s.summary.healer_version).not.toBe("forged");
    expect(s.summary.blocker_count).toBe(0);
    expect(s.summary.new_customers).not.toContain("Forged Customer Ltd");
    expect(s.summary.warnings_by_type).toEqual({}); // does not add up to the recomputed warning_count
    expect(s.summary.extra_key).toBeUndefined();
    expect(s.summary.blank_rows_ignored).toBe(2); // informational, type-checked, kept
  });

  it("corrections that do not match the staged rows are refused (22023), nothing staged", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int n from public.import_stages")).rows[0].n;
    const cases: [string, (p: StageRpcPayload) => StageRpcPayload][] = [
      ["wrong healed value", (p) => ({ ...p, p_corrections: p.p_corrections.map((c, i) => (i === 0 ? { ...c, healed: "forged" } : c)) })],
      ["fix on a line that was not staged", (p) => ({ ...p, p_corrections: [...p.p_corrections, { ...p.p_corrections[0], source_line: 99999 }] })],
      ["field the row does not have", (p) => ({ ...p, p_corrections: [...p.p_corrections, { ...p.p_corrections[0], field: "forged_field" as never }] })],
      ["rule that is not a Healer rule", (p) => ({ ...p, p_corrections: [...p.p_corrections, { ...p.p_corrections[0], rule: "Forged Rule!" as never }] })],
    ];
    for (const [label, tamper] of cases) {
      await expect(submitAs(db, USERS.OPS, file(), `qc-${label}.csv`, { tamper }), label).rejects.toThrow(/Healer report does not match the rows/);
    }
    const after = (await db.query<{ n: number }>("select count(*)::int n from public.import_stages")).rows[0].n;
    expect(after).toBe(before);
  });

  it("residual (documented): dropping fixes is not detectable by the DB, but the stored report stays consistent", async () => {
    const res = await submitAs(db, USERS.OPS, file(), "qc-dropped.csv", { tamper: (p) => ({ ...p, p_corrections: [] }) });
    const s = await stored(db, res.stageId);
    expect(s.byRule).toEqual({});
    expect(nonZero(s.summary.fixed_by_rule)).toEqual({});
    expect(s.correction_count).toBe(0);
  });

  it("the database rule list equals the Healer's HEALER_RULES", async () => {
    const r = await db.query<{ rules: string[] }>("select public.import_healer_rules() rules");
    expect(r.rows[0].rules).toEqual([...HEALER_RULES]);
  });

  it("the server function accepts no Healer report from the browser (re-runs the Healer from the file bytes)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../strict-import.functions.ts"), "utf8");
    const submit = src.slice(src.indexOf("export const submitStrictImport"), src.indexOf("export const commitStrictImport"));
    expect(submit).toContain("bytes: base64ToBytes(data.contentBase64)");
    expect(submit).not.toMatch(/report|summary|corrections|fixedByRule/i);
  });
});
