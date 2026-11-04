// SCRUM-131: sign-off enforced IN THE DATABASE (PGlite, all migrations incl. the NOT APPLIED
// 20261006070000_scrum131_import_staging_approval.sql). The uploader stages through the real server path
// (runSubmit: parse -> Healer -> validate -> stage_import); every decision runs as the deciding user.
// Synthetic data only. Never touches sandbox or live.
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor } from "@/test-support/local-db";
import { as, asActorCommit, codeAs, createApprovalDb, messageAs, stageRow, submitAs, USERS } from "@/test-support/scrum131-db";
import { synthetic131Csv, synthetic131Rows } from "@/test-support/scrum131-fixture";
import { syntheticCsv, syntheticRows } from "@/test-support/scrum129-fixture";
import { isIncompleteTransaction } from "@/lib/transaction-completeness";
import type { SubmitResult } from "../service";

const APPROVE = "select public.approve_import($1, $2, $3, $4) r";
const approveArgs = (s: SubmitResult, reason: string | null = null) => [s.stageId, s.fileSha256, s.rowsSha256, reason];
const count = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0].n;
/** Postgres error code (or "ok") of a statement run as the table owner (rolled back): table CHECKs only. */
async function ownerCode(db: PGlite, sql: string, params: unknown[] = []): Promise<string> {
  await db.exec("begin");
  try {
    await db.query(sql, params);
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  } finally {
    await db.exec("rollback");
  }
}
const txCount = (db: PGlite) => count(db, "select count(*)::int n from public.transactions");

/** A small distinct synthetic file (different bytes -> different SHA-256). */
let seq = 0;
function smallCsv(providers: string[] = ["AWS", "SAP"]): string {
  seq += 1;
  const rows = syntheticRows(providers).map((r, i) => ({ ...r, potentialId: `SYN131-SMALL-${seq}-${i}` }));
  return syntheticCsv(rows);
}

describe("SCRUM-131 sign-off gate (database)", () => {
  let db: PGlite;
  let main: SubmitResult;

  beforeAll(async () => {
    db = await createApprovalDb();
    main = await submitAs(db, USERS.OPS, synthetic131Csv(), "synthetic-131.csv");
  }, 120_000);

  it("staging writes nothing to transactions; the stage holds the Healer counts", async () => {
    expect(await txCount(db)).toBe(0);
    expect(main).toMatchObject({ rows: 342, kind: "mixed", privateRows: 336, publicRows: 6, incompleteRows: 248, correctionCount: 695 });
    const s = await stageRow(db, main.stageId);
    expect(s).toMatchObject({
      status: "pending",
      row_count: 342,
      private_count: 336,
      public_count: 6,
      incomplete_count: 248,
      correction_count: 695,
      uploaded_by: USERS.OPS,
      decided_by: null,
    });
    const ttl = (Date.parse(String((s.expires_at as Date).toISOString())) - Date.parse((s.uploaded_at as Date).toISOString())) / 86_400_000;
    expect(Math.round(ttl)).toBe(7);
    expect(await count(db, "select count(*)::int n from public.import_stage_rows where stage_id = $1", [main.stageId])).toBe(342);
    expect(await count(db, "select count(*)::int n from public.import_corrections where stage_id = $1", [main.stageId])).toBe(695);
  });

  it("the DB computes Incomplete with Peter's rule (import_row_is_incomplete = isIncompleteTransaction)", async () => {
    const r = await db.query<{ healed: Record<string, unknown>; is_incomplete: boolean }>(
      "select healed, is_incomplete from public.import_stage_rows where stage_id = $1",
      [main.stageId],
    );
    for (const x of r.rows) expect(x.is_incomplete).toBe(isIncompleteTransaction(x.healed));
    const cases: Record<string, unknown>[] = [
      { potential_id: "P", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: "1", selling_cost: "2" },
      { potential_id: "P", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: "0", selling_cost: "2" },
      { potential_id: " ", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: "1", selling_cost: "2" },
      { potential_id: "P", month: null, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: "1", selling_cost: "2" },
      { potential_id: "P", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: null, selling_cost: "2" },
      { potential_id: "P", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: "1", selling_cost: "-1" },
      { potential_id: "P", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "", input_cost: "1", selling_cost: "2" },
      { potential_id: "P", month: 1, year: 2026, customer_name: "C", lab_name: "L", cloud_provider: "AWS", input_cost: "1", selling_cost: "2", system_config: null, total_users: null },
    ];
    for (const c of cases) {
      const got = (await db.query<{ v: boolean }>("select public.import_row_is_incomplete($1::jsonb) v", [JSON.stringify(c)])).rows[0].v;
      expect(got, JSON.stringify(c)).toBe(isIncompleteTransaction(c));
    }
  });

  it("Q1 an uploader cannot commit: no direct batch import, no commit_import, cannot approve their own upload", async () => {
    expect(await codeAs(db, as(USERS.OPS), APPROVE, approveArgs(main))).toBe("42501");
    expect(await messageAs(db, as(USERS.OPS), APPROVE, approveArgs(main))).toMatch(/Only an import approver/);
    expect(await codeAs(db, as(USERS.OPS), "select public.commit_import($1)", [main.stageId])).toBe("42501");
    expect(
      await codeAs(
        db,
        as(USERS.OPS),
        "select public.import_transactions_batch('public_cloud', 'x.csv', $1, '2.0.0', jsonb_build_array(jsonb_build_object('source_line', 2, 'lab_name', 'L', 'cloud_provider', 'AWS')), '[]'::jsonb)",
        ["a".repeat(64)],
      ),
    ).toBe("42501");
    expect(await codeAs(db, as(USERS.OPS), "update public.import_stages set status = 'approved' where id = $1", [main.stageId])).toBe("42501");
    expect(await codeAs(db, as(USERS.OPS), "insert into public.transactions (potential_id) values ('x') ", [])).not.toBe("ok");
    expect(await txCount(db)).toBe(0);
  });

  it("Q2 a non-approver (ops lead, admin not on the list) cannot approve or reject", async () => {
    expect(await codeAs(db, as(USERS.LEAD), APPROVE, approveArgs(main))).toBe("42501");
    expect(await codeAs(db, as(USERS.VIEWER), APPROVE, approveArgs(main))).toBe("42501");
    expect(await codeAs(db, as(USERS.LEAD), "select public.reject_import($1, 'no')", [main.stageId])).toBe("42501");
    expect((await stageRow(db, main.stageId)).status).toBe("pending");
  });

  it("Q3 self-approval is rejected, even for an approver who is also an admin, and by a table CHECK", async () => {
    await db.query("update public.import_approval_settings set approver_user_ids = $1::uuid[] where id = 1", [[USERS.CHIEF, USERS.ADMIN2]]);
    try {
      const own = await submitAs(db, USERS.ADMIN2, smallCsv(), "admin2-own.csv");
      expect(await messageAs(db, as(USERS.ADMIN2), APPROVE, approveArgs(own))).toMatch(/cannot approve your own upload/);
      expect(await codeAs(db, as(USERS.ADMIN2), APPROVE, approveArgs(own))).toBe("42501");
      expect(await codeAs(db, as(USERS.ADMIN2), "select public.reject_import($1, null)", [own.stageId])).toBe("55000");
      // Even the table owner cannot record a self-decision.
      let code = "ok";
      try {
        await db.query("update public.import_stages set decided_by = uploaded_by where id = $1", [own.stageId]);
      } catch (e) {
        code = (e as { code: string }).code;
      }
      expect(code).toBe("23514");
      // allow_self_approval cannot be switched on.
      let code2 = "ok";
      try {
        await db.query("update public.import_approval_settings set allow_self_approval = true where id = 1");
      } catch (e) {
        code2 = (e as { code: string }).code;
      }
      expect(code2).toBe("23514");
      expect((await stageRow(db, own.stageId)).status).toBe("pending");
      await asActorCommit(db, as(USERS.ADMIN2), (q) => q.query("select public.cancel_import($1)", [own.stageId]));
    } finally {
      await db.query("update public.import_approval_settings set approver_user_ids = $1::uuid[] where id = 1", [[USERS.CHIEF]]);
    }
  });

  it("Q4 a changed stage (hash mismatch) cannot be approved", async () => {
    // Fix R-1 (071200): P0001, never 40001 (PostgREST 14.x re-runs 40001/40P01 transactions without limit).
    expect(await codeAs(db, as(USERS.CHIEF), APPROVE, [main.stageId, main.fileSha256, "f".repeat(64), null])).toBe("P0001");
    expect(await codeAs(db, as(USERS.CHIEF), APPROVE, [main.stageId, "e".repeat(64), main.rowsSha256, null])).toBe("P0001");
    // Tampering with a staged row behind the stage's back is caught too.
    await db.exec("begin");
    await db.query("update public.import_stage_rows set healed = jsonb_set(healed, '{selling_cost}', '\"999.00\"') where stage_id = $1 and source_line = 2", [main.stageId]);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.CHIEF, role: "authenticated" })]);
    await db.exec("set local role authenticated");
    let code = "ok";
    try {
      await db.query(APPROVE, approveArgs(main));
    } catch (e) {
      code = (e as { code: string }).code;
    }
    await db.exec("rollback");
    expect(code).toBe("P0001");
    expect(await txCount(db)).toBe(0);
  });

  it("Q5 Chief's approval commits all 342 rows (336/6) in one transaction, with full audit", async () => {
    const res = await asActorCommit(db, as(USERS.CHIEF), async (q) => (await q.query<{ r: Record<string, unknown> }>(APPROVE, approveArgs(main, "Looks right"))).rows[0].r);
    expect(res).toMatchObject({ inserted: 342, kind: "mixed", private_rows: 336, public_rows: 6 });
    const s = await stageRow(db, main.stageId);
    expect(s).toMatchObject({ status: "committed", decided_by: USERS.CHIEF, decision_reason: "Looks right", committed_batch_id: res.batch_id });
    const b = (await db.query<Record<string, unknown>>("select * from public.import_batches where id = $1", [res.batch_id])).rows[0];
    expect(b).toMatchObject({ stage_id: main.stageId, uploaded_by: USERS.OPS, approved_by: USERS.CHIEF, row_count: 342 });
    expect(b.approved_at).not.toBeNull();
    const split = await db.query<{ cloud_provider: string; repository_type: string; n: number }>(
      "select cloud_provider, repository_type, count(*)::int n from public.transactions where import_batch_id = $1 group by 1, 2 order by 1",
      [res.batch_id],
    );
    expect(split.rows).toEqual([
      { cloud_provider: "Azure", repository_type: "public_cloud", n: 6 },
      { cloud_provider: "MakeMyLabs Private Cloud", repository_type: "private_cloud", n: 334 },
      { cloud_provider: "Oracle", repository_type: "private_cloud", n: 2 },
    ]);
    // Healed values were stored: ISO dates, existing customer spellings, prices never NULL.
    expect(await count(db, "select count(*)::int n from public.transactions where import_batch_id = $1 and start_date is not null and end_date is not null", [res.batch_id])).toBe(342);
    expect(await count(db, "select count(*)::int n from public.transactions where import_batch_id = $1 and (input_cost is null or selling_cost is null)", [res.batch_id])).toBe(0);
    expect(await count(db, "select count(*)::int n from public.transactions where import_batch_id = $1 and (input_cost <= 0 or selling_cost <= 0)", [res.batch_id])).toBe(248);
    expect(await count(db, "select count(*)::int n from public.customers")).toBe(8);
    const totals = synthetic131Rows().reduce((a, r) => ({ s: a.s + r.selling, i: a.i + r.input }), { s: 0, i: 0 });
    const got = (await db.query<{ s: string; i: string }>("select sum(selling_cost)::text s, sum(input_cost)::text i from public.transactions where import_batch_id = $1", [res.batch_id])).rows[0];
    expect([Number(got.s), Number(got.i)]).toEqual([totals.s, totals.i]);
    // Corrections are kept and linked to the stored transactions; staged rows are cleared.
    expect(await count(db, "select count(*)::int n from public.import_corrections where stage_id = $1 and transaction_id is not null and import_batch_id = $2", [main.stageId, res.batch_id])).toBe(695);
    expect(await count(db, "select count(*)::int n from public.import_stage_rows where stage_id = $1", [main.stageId])).toBe(0);
    // In-app notifications: Chief got "pending", the uploader got "approved".
    expect(await count(db, "select count(*)::int n from public.user_notifications where user_id = $1 and kind = 'import_pending' and stage_id = $2", [USERS.CHIEF, main.stageId])).toBe(1);
    expect(await count(db, "select count(*)::int n from public.user_notifications where user_id = $1 and kind = 'import_approved' and stage_id = $2", [USERS.OPS, main.stageId])).toBe(1);
  });

  it("an approved/committed stage cannot be approved again", async () => {
    expect(await codeAs(db, as(USERS.CHIEF), APPROVE, approveArgs(main))).toBe("55000");
    expect(await txCount(db)).toBe(342);
  });

  it("Q6 an expired pending import cannot commit; expiry clears its rows and tells the uploader", async () => {
    const s = await submitAs(db, USERS.LEAD, smallCsv(), "will-expire.csv");
    await db.query("update public.import_stages set expires_at = now() - interval '1 minute', uploaded_at = now() - interval '7 days 1 minute' where id = $1", [s.stageId]);
    const before = await txCount(db);
    expect(await messageAs(db, as(USERS.CHIEF), APPROVE, approveArgs(s))).toMatch(/expired/);
    expect(await codeAs(db, as(USERS.CHIEF), APPROVE, approveArgs(s))).toBe("55000");
    expect(await codeAs(db, as(USERS.CHIEF), "select public.reject_import($1, null)", [s.stageId])).toBe("55000");
    const n = await asActorCommit(db, as(USERS.LEAD), async (q) => (await q.query<{ n: number }>("select public.expire_import_stages() n")).rows[0].n);
    expect(n).toBe(1);
    expect((await stageRow(db, s.stageId)).status).toBe("expired");
    expect(await count(db, "select count(*)::int n from public.import_stage_rows where stage_id = $1", [s.stageId])).toBe(0);
    expect(await count(db, "select count(*)::int n from public.user_notifications where user_id = $1 and kind = 'import_expired' and stage_id = $2", [USERS.LEAD, s.stageId])).toBe(1);
    expect(await codeAs(db, as(USERS.CHIEF), APPROVE, approveArgs(s))).toBe("55000");
    expect(await txCount(db)).toBe(before);
  });

  it("Q7 Chief can reject with a reason: nothing is written, rows are cleared, the uploader is told", async () => {
    const s = await submitAs(db, USERS.OPS, smallCsv(), "to-reject.csv");
    const before = await txCount(db);
    await asActorCommit(db, as(USERS.CHIEF), (q) => q.query("select public.reject_import($1, $2)", [s.stageId, "Wrong month"]));
    expect(await stageRow(db, s.stageId)).toMatchObject({ status: "rejected", decided_by: USERS.CHIEF, decision_reason: "Wrong month" });
    expect(await count(db, "select count(*)::int n from public.import_stage_rows where stage_id = $1", [s.stageId])).toBe(0);
    expect(await count(db, "select count(*)::int n from public.user_notifications where user_id = $1 and kind = 'import_rejected' and stage_id = $2", [USERS.OPS, s.stageId])).toBe(1);
    expect(await codeAs(db, as(USERS.CHIEF), APPROVE, approveArgs(s))).toBe("55000");
    expect(await txCount(db)).toBe(before);
  });

  it("Q8 only the uploader can cancel their own pending upload; it leaves nothing behind", async () => {
    const s = await submitAs(db, USERS.OPS, smallCsv(), "to-cancel.csv");
    expect(await codeAs(db, as(USERS.LEAD), "select public.cancel_import($1)", [s.stageId])).toBe("55000");
    expect(await codeAs(db, as(USERS.CHIEF), "select public.cancel_import($1)", [s.stageId])).toBe("55000");
    await asActorCommit(db, as(USERS.OPS), (q) => q.query("select public.cancel_import($1)", [s.stageId]));
    expect(await count(db, "select count(*)::int n from public.import_stages where id = $1", [s.stageId])).toBe(0);
  });

  it("Q9 stage_import re-validates healed rows: NULL price, unhealed provider, wrong type, blank identity, non-ISO date, wrong kind", async () => {
    const base = { potential_id: "P-1", month: 3, year: 2026, customer_name: "Synthetic Alpha", lab_name: "L", cloud_provider: "AWS", lab_type: "public_cloud", input_cost: "1.00", selling_cost: "2.00", start_date: "2026-03-01", end_date: "2026-03-02" };
    const stage = (healed: Record<string, unknown>, kind = "public_cloud") =>
      codeAs(db, as(USERS.OPS), "select public.stage_import($1, 'bad.csv', $2, '2.0.0', '1.0.0', $3::jsonb, '[]'::jsonb, '{}'::jsonb)", [
        kind,
        "9".repeat(64),
        JSON.stringify([{ source_line: 2, healed, original: {}, warnings: [] }]),
      ]);
    expect(await stage(base)).toBe("ok");
    expect(await stage({ ...base, selling_cost: null })).toBe("22023");
    expect(await stage({ ...base, input_cost: "-1" })).toBe("22023");
    expect(await stage({ ...base, cloud_provider: "aws" })).toBe("22023");
    expect(await stage({ ...base, cloud_provider: "OpenAI" })).toBe("22023");
    expect(await stage({ ...base, lab_type: "private_cloud" })).toBe("22023");
    expect(await stage({ ...base, potential_id: " " })).toBe("22023");
    expect(await stage({ ...base, start_date: "01-03-2026" })).toBe("22023");
    expect(await stage(base, "mixed")).toBe("22023");
    expect(await codeAs(db, as(USERS.VIEWER), "select public.stage_import('public_cloud', 'v.csv', $1, '2.0.0', '1.0.0', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)", ["9".repeat(64)])).toBe("42501");
  });

  it("repeat file WITHOUT the acknowledgement: refused with repeat_file (canAcknowledge), nothing staged", async () => {
    const batchId = (await stageRow(db, main.stageId)).committed_batch_id;
    const before = await count(db, "select count(*)::int n from public.import_stages");
    const err = await submitAs(db, USERS.LEAD, synthetic131Csv(), "synthetic-131-again.csv").then(
      () => null,
      (e: unknown) => e as { code: string; repeat?: { repeatOf: { source: string; id: string } | null; canAcknowledge: boolean } },
    );
    expect(err).toMatchObject({ code: "repeat_file", repeat: { canAcknowledge: true, repeatOf: { source: "batch", id: batchId } } });
    expect(await count(db, "select count(*)::int n from public.import_stages")).toBe(before);
    // The old 8-argument stage_import never acknowledges, so it cannot skip the warning either.
    expect(
      await messageAs(
        db,
        as(USERS.LEAD),
        "select public.stage_import('mixed', 'x.csv', $1, '2.0.0', '1.0.0', '[{}]'::jsonb, '[]'::jsonb, '{}'::jsonb)",
        [main.fileSha256],
      ),
    ).toMatch(/Repeat file not acknowledged/);
  });

  it("repeat file WITH the acknowledgement: staged, and the stage records who acknowledged, when, and the earlier batch", async () => {
    const batchId = (await stageRow(db, main.stageId)).committed_batch_id;
    const again = await submitAs(db, USERS.LEAD, synthetic131Csv(), "synthetic-131-again.csv", { acknowledgeRepeatFile: true });
    expect(again).toMatchObject({ repeatAcknowledged: true, repeatOf: { source: "batch", id: batchId }, rows: 342 });
    const s = await stageRow(db, again.stageId);
    expect(s).toMatchObject({ status: "pending", uploaded_by: USERS.LEAD, repeat_acknowledged_by: USERS.LEAD });
    expect(s.repeat_acknowledged_at).toBeInstanceOf(Date);
    expect(s.repeat_of).toMatchObject({ source: "batch", id: batchId });
    // The approver reads the same fields (RLS: approvers see every stage).
    const seen = await asActorCommit(db, as(USERS.CHIEF), async (q) =>
      (await q.query<{ by: string; of: { id: string } }>("select repeat_acknowledged_by by, repeat_of of from public.import_stages where id = $1", [again.stageId])).rows[0],
    );
    expect(seen).toEqual({ by: USERS.LEAD, of: expect.objectContaining({ id: batchId }) });
    // An acknowledgement belongs to the uploader and to a detected repeat (table CHECK).
    expect(await ownerCode(db, "update public.import_stages set repeat_acknowledged_by = $2 where id = $1", [again.stageId, USERS.CHIEF])).toBe("23514");
    expect(await ownerCode(db, "update public.import_stages set repeat_of = null where id = $1", [again.stageId])).toBe("23514");
    expect(await ownerCode(db, "update public.import_stages set repeat_acknowledged_at = null where id = $1", [again.stageId])).toBe("23514");
    await asActorCommit(db, as(USERS.LEAD), (q) => q.query("select public.cancel_import($1)", [again.stageId]));
  });

  it("a new file never records an acknowledgement, even if one is sent", async () => {
    const fresh = await submitAs(db, USERS.LEAD, smallCsv(), "fresh.csv", { acknowledgeRepeatFile: true });
    expect(fresh).toMatchObject({ repeatOf: null, repeatAcknowledged: false });
    expect(await stageRow(db, fresh.stageId)).toMatchObject({ repeat_acknowledged_by: null, repeat_acknowledged_at: null, repeat_of: null });
    await asActorCommit(db, as(USERS.LEAD), (q) => q.query("select public.cancel_import($1)", [fresh.stageId]));
  });

  it("repeat file: 'block' refuses it even with the acknowledgement; the approver list can be changed by an admin only", async () => {

    expect(await codeAs(db, as(USERS.LEAD), "select public.set_import_approvers($1::uuid[])", [[USERS.LEAD]])).toBe("42501");
    expect(await codeAs(db, as(USERS.ADMIN2), "select public.set_import_approvers($1::uuid[])", [[USERS.CHIEF]])).toBe("ok");
    await db.query("update public.import_approval_settings set repeat_file_check = 'block' where id = 1");
    try {
      await expect(submitAs(db, USERS.LEAD, synthetic131Csv(), "blocked-repeat.csv", { acknowledgeRepeatFile: true })).rejects.toMatchObject({
        code: "repeat_file",
        repeat: { canAcknowledge: false },
      });
    } finally {
      await db.query("update public.import_approval_settings set repeat_file_check = 'warn' where id = 1");
    }
  });

  it("no approver configured: uploads are refused (not silently queued)", async () => {
    await db.query("update public.import_approval_settings set approver_user_ids = '{}' where id = 1");
    try {
      await expect(submitAs(db, USERS.OPS, smallCsv(), "nobody.csv")).rejects.toMatchObject({ code: "not_configured" });
    } finally {
      await db.query("update public.import_approval_settings set approver_user_ids = $1::uuid[] where id = 1", [[USERS.CHIEF]]);
    }
  });

  it("an inactive Chief is not an approver", async () => {
    const s = await submitAs(db, USERS.OPS, smallCsv(), "inactive.csv");
    await db.query("update public.profiles set is_active = false where id = $1", [USERS.CHIEF]);
    try {
      expect(await codeAs(db, as(USERS.CHIEF), APPROVE, approveArgs(s))).toBe("42501");
    } finally {
      await db.query("update public.profiles set is_active = true where id = $1", [USERS.CHIEF]);
    }
    await asActorCommit(db, as(USERS.OPS), (q) => q.query("select public.cancel_import($1)", [s.stageId]));
  });

  it("RLS: uploaders see only their own stages, approvers and admins see all, viewers none; notifications are private", async () => {
    const vis = async (u: string) =>
      asActor(db, as(u), async (q) => ({
        stages: (await q.query<{ n: number }>("select count(*)::int n from public.import_stages")).rows[0].n,
        own: (await q.query<{ n: number }>("select count(*)::int n from public.import_stages where uploaded_by = $1", [u])).rows[0].n,
        notes: (await q.query<{ n: number }>("select count(*)::int n from public.user_notifications where user_id <> $1", [u])).rows[0].n,
      }));
    const total = await count(db, "select count(*)::int n from public.import_stages");
    const chief = await vis(USERS.CHIEF);
    const ops = await vis(USERS.OPS);
    const viewer = await vis(USERS.VIEWER);
    const admin = await vis(USERS.ADMIN2);
    expect(chief.stages).toBe(total);
    expect(admin.stages).toBe(total);
    expect(ops.stages).toBe(ops.own);
    expect(ops.stages).toBeLessThan(total);
    expect(viewer.stages).toBe(0);
    for (const v of [chief, ops, viewer, admin]) expect(v.notes).toBe(0);
    expect(await codeAs(db, as(USERS.OPS), "insert into public.user_notifications (user_id, kind, title) values ($1, 'import_pending', 'x')", [USERS.CHIEF])).toBe("42501");
    expect(await codeAs(db, as(USERS.CHIEF), "delete from public.import_corrections")).toBe("42501");
    expect(await codeAs(db, { role: "anon" }, "select * from public.import_stages")).toBe("42501");
  });

  it("pending count and mark-read helpers", async () => {
    const s = await submitAs(db, USERS.OPS, smallCsv(), "count.csv");
    const n = await asActor(db, as(USERS.CHIEF), async (q) => (await q.query<{ n: number }>("select public.pending_import_count() n")).rows[0].n);
    expect(n).toBeGreaterThanOrEqual(1);
    await asActorCommit(db, as(USERS.CHIEF), (q) => q.query("select public.mark_all_notifications_read()"));
    expect(await count(db, "select count(*)::int n from public.user_notifications where user_id = $1 and read_at is null", [USERS.CHIEF])).toBe(0);
    await asActorCommit(db, as(USERS.OPS), (q) => q.query("select public.cancel_import($1)", [s.stageId]));
  });
});
