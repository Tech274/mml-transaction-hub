// SCRUM-131 follow-up (Chris 07:02; John 07:06/07:07, Option 2): the server-function logic
// (approval-queries.ts) run against the real migrations in PGlite, as each user, through the same narrow
// client view the server functions use.
//  1. The badge/status path and the My-uploads list are READ-ONLY (READ ONLY transactions; no INSERT/UPDATE/
//     DELETE, no expire_import_stages); an overdue pending stage is not counted / reads as expired.
//  2. Import approvals (queue, detail, approve, reject) go by approver MEMBERSHIP, whatever the role: a
//     leadership-only approver can list and approve; a non-approver (ops lead, or an admin not on the list)
//     cannot. No self-approval.
//  3. My uploads: own stages only; cancel only the caller's own pending, unexpired stage.
// Synthetic data only.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, asActorCommit, codeAs, createApprovalDb, stageRow, submitAs, USERS } from "@/test-support/scrum131-db";
import { pgUntypedDb } from "@/test-support/pg-untyped-db";
import { syntheticCsv, syntheticRows } from "@/test-support/scrum129-fixture";
import { runApprove, runReject } from "../approval";
import {
  ApprovalQueryError,
  approvalDepsFor,
  cancelMyStage,
  effectiveStatus,
  getApprovalStageDetail,
  listApprovalQueue,
  listMyStages,
  readImportApprovalStatus,
} from "../approval-queries";
import type { SubmitResult } from "../service";

let seq = 0;
function smallCsv(providers: string[] = ["AWS", "SAP"]): string {
  seq += 1;
  const rows = syntheticRows(providers).map((r, i) => ({ ...r, potentialId: `SYN131-ACCESS-${seq}-${i}` }));
  return syntheticCsv(rows);
}
const WRITE_SQL = /\b(insert|update|delete|merge|truncate)\b|expire_import_stages/i;
const ro = (db: PGlite, userId: string) => pgUntypedDb(db, as(userId), { readOnly: true });
const rw = (db: PGlite, userId: string) => pgUntypedDb(db, as(userId));

describe("SCRUM-131 access: read-only badge, approver membership, My uploads", () => {
  let db: PGlite;
  let a: SubmitResult; // OPS, pending
  let b: SubmitResult; // LEAD, pending
  let c: SubmitResult; // OPS, pending but past expires_at (not yet written as expired)

  beforeAll(async () => {
    db = await createApprovalDb();
    a = await submitAs(db, USERS.OPS, smallCsv(), "ops-a.csv");
    b = await submitAs(db, USERS.LEAD, smallCsv(["Azure"]), "lead-b.csv");
    c = await submitAs(db, USERS.OPS, smallCsv(["Oracle"]), "ops-c.csv");
    await db.query("update public.import_stages set uploaded_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [c.stageId]);
  }, 120_000);

  describe("1. read-only badge / status", () => {
    it("Chief (leadership-only approver): isApprover, not canUpload, pendingCount excludes the overdue stage; nothing written", async () => {
      const client = ro(db, USERS.CHIEF);
      const s = await readImportApprovalStatus(client, USERS.CHIEF);
      expect(s).toEqual({ isApprover: true, canUpload: false, pendingCount: 2, unreadNotifications: 3 });
      expect(client.log).toEqual(["select public.\"import_approval_status\"() as r"]); // one round trip
      for (const sql of client.log) expect(sql).not.toMatch(WRITE_SQL);
      expect((await stageRow(db, c.stageId)).status).toBe("pending"); // the read did not expire it
    });

    it("uploaders and viewers: isApprover false, pendingCount 0; canUpload follows the import role", async () => {
      expect(await readImportApprovalStatus(ro(db, USERS.OPS), USERS.OPS)).toMatchObject({ isApprover: false, canUpload: true, pendingCount: 0 });
      expect(await readImportApprovalStatus(ro(db, USERS.LEAD), USERS.LEAD)).toMatchObject({ isApprover: false, canUpload: true, pendingCount: 0 });
      expect(await readImportApprovalStatus(ro(db, USERS.VIEWER), USERS.VIEWER)).toEqual({
        isApprover: false,
        canUpload: false,
        pendingCount: 0,
        unreadNotifications: 0,
      });
    });

    it("import_approval_status() is STABLE (read-only by declaration), SECURITY DEFINER, and not callable by anon", async () => {
      const f = await db.query<{ v: string; sd: boolean }>(
        "select provolatile::text v, prosecdef sd from pg_proc where oid = 'public.import_approval_status()'::regprocedure",
      );
      expect(f.rows[0]).toEqual({ v: "s", sd: true });
      expect(await codeAs(db, { role: "anon" }, "select public.import_approval_status()")).toBe("42501");
    });

    it("control: the queue load DOES write (lazy expiry), so it fails in a READ ONLY transaction", async () => {
      await expect(listApprovalQueue(ro(db, USERS.CHIEF), USERS.CHIEF, "pending")).rejects.toBeInstanceOf(ApprovalQueryError);
      expect((await stageRow(db, c.stageId)).status).toBe("pending");
    });
  });

  describe("3a. My uploads list (read-only, own stages only)", () => {
    it("lists only the caller's stages; the overdue pending one reads as expired without being written", async () => {
      const client = ro(db, USERS.OPS);
      const mine = await listMyStages(client, USERS.OPS);
      expect(mine.map((m) => m.id).sort()).toEqual([a.stageId, c.stageId].sort());
      const byId = Object.fromEntries(mine.map((m) => [m.id, m]));
      expect(byId[a.stageId]).toMatchObject({ status: "pending", canCancel: true, rowCount: a.rows, filename: "ops-a.csv" });
      expect(byId[c.stageId]).toMatchObject({ status: "expired", canCancel: false });
      expect(byId[a.stageId].healerFixCount).toBe(a.correctionCount);
      expect(Object.values(byId[a.stageId].healerFixesByRule).reduce((x, y) => x + y, 0)).toBe(a.correctionCount);
      for (const sql of client.log) expect(sql).not.toMatch(WRITE_SQL);
      expect((await stageRow(db, c.stageId)).status).toBe("pending");
      expect((await listMyStages(ro(db, USERS.LEAD), USERS.LEAD)).map((m) => m.id)).toEqual([b.stageId]);
      expect(await listMyStages(ro(db, USERS.VIEWER), USERS.VIEWER)).toEqual([]);
      expect(await listMyStages(ro(db, USERS.CHIEF), USERS.CHIEF)).toEqual([]); // approvers see everything in the queue, but "mine" is mine
    });

    it("effectiveStatus: only a pending stage past expires_at reads as expired", () => {
      const now = Date.parse("2026-10-06T07:00:00Z");
      expect(effectiveStatus({ status: "pending", expires_at: "2026-10-06T06:59:59Z" }, now)).toBe("expired");
      expect(effectiveStatus({ status: "pending", expires_at: "2026-10-06T07:00:00Z" }, now)).toBe("pending");
      expect(effectiveStatus({ status: "committed", expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("committed");
    });
  });

  describe("2. Import approvals by approver membership (role ignored)", () => {
    it("a leadership-only approver can list the queue, open a stage and approve it", async () => {
      const roles = await db.query<{ role: string }>("select role::text from public.user_roles where user_id = $1", [USERS.CHIEF]);
      expect(roles.rows.map((r) => r.role)).toEqual(["leadership"]);
      const client = rw(db, USERS.CHIEF);
      const queue = await listApprovalQueue(client, USERS.CHIEF, "pending");
      expect(queue.stages.map((s) => s.id).sort()).toEqual([a.stageId, b.stageId].sort());
      expect((await stageRow(db, c.stageId)).status).toBe("expired"); // the queue load ran the lazy expiry
      const detail = await getApprovalStageDetail(client, USERS.CHIEF, a.stageId);
      expect(detail).toMatchObject({ ok: true, isApprover: true, isUploader: false, canDecide: true });
      const res = await runApprove(approvalDepsFor(client, USERS.CHIEF), { stageId: a.stageId, fileSha256: a.fileSha256, rowsSha256: a.rowsSha256 });
      expect(res).toMatchObject({ stageId: a.stageId, inserted: a.rows });
      expect((await stageRow(db, a.stageId)).status).toBe("committed");
    });

    it("a non-approver ops lead cannot list, open, approve or reject (even a stage they could otherwise see)", async () => {
      const client = rw(db, USERS.LEAD);
      await expect(listApprovalQueue(client, USERS.LEAD, "pending")).rejects.toMatchObject({ code: "forbidden" });
      await expect(getApprovalStageDetail(client, USERS.LEAD, b.stageId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(runApprove(approvalDepsFor(client, USERS.OPS), { stageId: b.stageId, fileSha256: b.fileSha256, rowsSha256: b.rowsSha256 })).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(runReject(approvalDepsFor(rw(db, USERS.OPS), USERS.OPS), { stageId: b.stageId, reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
      expect((await stageRow(db, b.stageId)).status).toBe("pending");
    });

    it("an admin NOT on the approver list is refused, although RLS lets admins read stages", async () => {
      const rows = await asActorCommit(db, as(USERS.ADMIN2), async (q) => (await q.query("select id from public.import_stages")).rows);
      expect(rows.length).toBeGreaterThan(0);
      const client = rw(db, USERS.ADMIN2);
      await expect(listApprovalQueue(client, USERS.ADMIN2, "recent")).rejects.toMatchObject({ code: "forbidden" });
      await expect(getApprovalStageDetail(client, USERS.ADMIN2, b.stageId)).rejects.toMatchObject({ code: "forbidden" });
      expect(await readImportApprovalStatus(ro(db, USERS.ADMIN2), USERS.ADMIN2)).toMatchObject({ isApprover: false, canUpload: true, pendingCount: 0 });
    });

    it("no self-approval: an approver who uploaded the file sees canDecide false and is refused", async () => {
      await db.query("update public.import_approval_settings set approver_user_ids = $1::uuid[] where id = 1", [[USERS.CHIEF, USERS.ADMIN2]]);
      try {
        const own = await submitAs(db, USERS.ADMIN2, smallCsv(["GCP"]), "admin-own.csv");
        const client = rw(db, USERS.ADMIN2);
        expect(await getApprovalStageDetail(client, USERS.ADMIN2, own.stageId)).toMatchObject({ ok: true, isUploader: true, canDecide: false });
        await expect(runApprove(approvalDepsFor(client, USERS.ADMIN2), { stageId: own.stageId, fileSha256: own.fileSha256, rowsSha256: own.rowsSha256 })).rejects.toMatchObject({
          code: "self_approval",
        });
        const direct = await client.rpc("approve_import", { p_stage_id: own.stageId, p_file_sha256: own.fileSha256, p_rows_sha256: own.rowsSha256, p_reason: null });
        expect(direct.error?.code).toBe("42501");
        await cancelMyStage(client, USERS.ADMIN2, own.stageId);
      } finally {
        await db.query("update public.import_approval_settings set approver_user_ids = $1::uuid[] where id = 1", [[USERS.CHIEF]]);
      }
    });
  });

  describe("3b. cancel: the caller's own PENDING stage only", () => {
    it("refuses someone else's stage, an expired stage and a committed stage; cancels the owner's pending stage", async () => {
      await expect(cancelMyStage(rw(db, USERS.OPS), USERS.OPS, b.stageId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(cancelMyStage(rw(db, USERS.CHIEF), USERS.CHIEF, b.stageId)).rejects.toMatchObject({ code: "forbidden" }); // approvers cannot cancel others' uploads
      await expect(cancelMyStage(rw(db, USERS.OPS), USERS.OPS, c.stageId)).rejects.toMatchObject({ code: "expired" });
      await expect(cancelMyStage(rw(db, USERS.OPS), USERS.OPS, a.stageId)).rejects.toMatchObject({ code: "not_pending" });
      expect((await stageRow(db, b.stageId)).status).toBe("pending");
      await cancelMyStage(rw(db, USERS.LEAD), USERS.LEAD, b.stageId);
      expect(await stageRow(db, b.stageId)).toBeUndefined();
    });
  });
});
