// SCRUM-131 (Chris 07:16): Peter's My uploads page (95292f4) uses listImportStages({scope:"mine"}) and
// cancelImport({stageId}). After the approver-membership change both must still work for uploaders who are NOT
// approvers. The server-function logic (listOwnStagesForMine, cancelMyStage) runs here against the real migrations
// in PGlite as each user. Synthetic data only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createApprovalDb, submitAs, USERS } from "@/test-support/scrum131-db";
import { pgUntypedDb } from "@/test-support/pg-untyped-db";
import { syntheticCsv, syntheticRows } from "@/test-support/scrum129-fixture";
import { ApprovalError, runApprove } from "../approval";
import { approvalDepsFor, cancelMyStage, listOwnStagesForMine } from "../approval-queries";
import { HEALER_RULES } from "../healer";

let seq = 0;
const csv = () => {
  seq += 1;
  return syntheticCsv(syntheticRows(["AWS", "SAP"]).map((r, i) => ({ ...r, potentialId: `SYN131-MINE-${seq}-${i}` })));
};
const WRITE_SQL = /\b(insert|update|delete|merge|truncate)\b|expire_import_stages/i;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ApprovalError ? e.code : (e as Error).message;
  }
};

describe("SCRUM-131 My uploads contract (scope 'mine' + cancelImport) for non-approver uploaders", () => {
  let db: PGlite;
  let leadPending: string;
  let leadToCancel: string;
  let leadApproved: string;
  let leadOverdue: string;
  let opsStage: string;
  beforeAll(async () => {
    db = await createApprovalDb();
    leadPending = (await submitAs(db, USERS.LEAD, csv(), "lead-1.csv")).stageId;
    leadToCancel = (await submitAs(db, USERS.LEAD, csv(), "lead-2.csv")).stageId;
    const approved = await submitAs(db, USERS.LEAD, csv(), "lead-3.csv");
    leadApproved = approved.stageId;
    await runApprove(approvalDepsFor(pgUntypedDb(db, as(USERS.CHIEF)), USERS.CHIEF), {
      stageId: approved.stageId, fileSha256: approved.fileSha256, rowsSha256: approved.rowsSha256, reason: null,
    });
    leadOverdue = (await submitAs(db, USERS.LEAD, csv(), "lead-4.csv")).stageId;
    opsStage = (await submitAs(db, USERS.OPS, csv(), "ops-1.csv")).stageId;
    // last, so no later stage_import (which runs the lazy expiry) touches it
    await db.query("update public.import_stages set expires_at = now() - interval '1 minute' where id = $1", [leadOverdue]);
  }, 180_000);

  it("scope 'mine' (read-only): own stages only, same shape, overdue pending reads as expired, fixed_by_rule kept", async () => {
    const view = pgUntypedDb(db, as(USERS.LEAD), { readOnly: true });
    const r = await listOwnStagesForMine(view, USERS.LEAD);
    expect(Object.keys(r).sort()).toEqual(["isApprover", "names", "stages", "userId"]);
    expect(r.isApprover).toBe(false);
    expect(r.userId).toBe(USERS.LEAD);
    const ids = r.stages.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([leadPending, leadToCancel, leadApproved, leadOverdue]));
    expect(ids).not.toContain(opsStage);
    const byId = Object.fromEntries(r.stages.map((s) => [s.id, s]));
    expect(byId[leadPending].status).toBe("pending");
    expect(byId[leadOverdue].status).toBe("expired");
    expect(byId[leadApproved].status).toBe("committed");
    const fixed = byId[leadPending].summary.fixed_by_rule as Record<string, number>;
    expect(Object.keys(fixed).sort()).toEqual([...HEALER_RULES].sort());
    expect(view.log.some((s) => WRITE_SQL.test(s))).toBe(false);
    // the database row is untouched by the read (still 'pending' past expiry until a lazy expiry runs)
    const raw = await db.query<{ status: string }>("select status from public.import_stages where id = $1", [leadOverdue]);
    expect(raw.rows[0].status).toBe("pending");
  });

  it("cancelImport: a non-approver uploader cancels their own pending stage", async () => {
    expect(await code(cancelMyStage(pgUntypedDb(db, as(USERS.LEAD)), USERS.LEAD, leadToCancel))).toBe("ok");
    const left = await db.query("select 1 from public.import_stages where id = $1", [leadToCancel]);
    expect(left.rows).toHaveLength(0);
  });

  it("cancelImport refuses another user's stage, a non-pending stage and an expired one", async () => {
    expect(await code(cancelMyStage(pgUntypedDb(db, as(USERS.LEAD)), USERS.LEAD, opsStage))).toBe("forbidden");
    expect(await code(cancelMyStage(pgUntypedDb(db, as(USERS.CHIEF)), USERS.CHIEF, leadPending))).toBe("forbidden"); // even an approver
    expect(await code(cancelMyStage(pgUntypedDb(db, as(USERS.LEAD)), USERS.LEAD, leadApproved))).toBe("not_pending");
    expect(await code(cancelMyStage(pgUntypedDb(db, as(USERS.LEAD)), USERS.LEAD, leadOverdue))).toBe("expired");
    const still = await db.query<{ n: number }>("select count(*)::int n from public.import_stages where id = any($1::uuid[])", [[opsStage, leadPending, leadApproved, leadOverdue]]);
    expect(still.rows[0].n).toBe(4);
  });

  it("the server functions keep the names and shapes Peter's page calls", () => {
    const src = readFileSync(path.resolve(__dirname, "../../import-approvals.functions.ts"), "utf8");
    expect(src).toContain('z.enum(["pending", "mine", "recent"])');
    expect(src).toContain('if (data.scope === "mine") return await listOwnStagesForMine(db, ctx.userId);');
    // one shape for every scope (Peter's adapter types it as { stages, userId }): no ok/Failure union
    const list = src.slice(src.indexOf("export const listImportStages"), src.indexOf("export interface ImportStageList"));
    expect(list).toContain("Promise<ImportStageList>");
    expect(list).not.toMatch(/ok: (true|false)/);
    expect(list).toContain("return { stages: [], names: {}, isApprover: false, userId: ctx.userId };");
    const cancel = src.slice(src.indexOf("export const cancelImport"), src.indexOf("export interface NotificationView"));
    expect(cancel).toContain("z.object({ stageId })");
    expect(cancel).toContain("cancelMyStage(untyped(ctx.supabase), ctx.userId, data.stageId)");
    expect(cancel).not.toMatch(/isApprover|requireApprover/);
  });
});
