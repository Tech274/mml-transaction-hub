// SCRUM-131 Eng QC S1: set_import_approvers() works from the SQL editor (owner session, no user JWT) and for the
// service role, and is still refused for everyone else. Local PGlite only; synthetic ids (USERS); never run on a
// hosted database.
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { codeAs, createApprovalDb, USERS, as } from "@/test-support/scrum131-db";

const NEW_APPROVER = USERS.LEAD;
let db: PGlite;

async function approvers(): Promise<{ ids: string[]; by: string | null }> {
  const r = await db.query<{ ids: string[]; by: string | null }>(
    "select approver_user_ids::text[] ids, updated_by::text by from public.import_approval_settings where id = 1",
  );
  return r.rows[0];
}

describe("SCRUM-131 QC S1: set_import_approvers from the SQL editor", () => {
  beforeAll(async () => {
    db = await createApprovalDb();
  }, 120_000);

  it("works from the owner's SQL-editor session (no SET ROLE, no JWT: auth.uid() is NULL)", async () => {
    await db.exec("begin");
    try {
      const uid = await db.query<{ u: string | null }>("select auth.uid()::text u");
      expect(uid.rows[0].u).toBeNull();
      await db.query("select public.set_import_approvers($1::uuid[])", [[NEW_APPROVER]]);
      expect(await approvers()).toEqual({ ids: [NEW_APPROVER], by: null });
      const verify = await db.query<{ a: string }>("select a::text from public.import_stage_approvers() a");
      expect(verify.rows.map((r) => r.a)).toEqual([NEW_APPROVER]);
    } finally {
      await db.exec("rollback");
    }
    expect((await approvers()).ids).toEqual([USERS.CHIEF]);
  });

  it("works for the service role and for a signed-in admin", async () => {
    const sql = "select public.set_import_approvers($1::uuid[])";
    expect(await codeAs(db, { role: "service_role" }, sql, [[NEW_APPROVER]])).toBe("ok");
    expect(await codeAs(db, as(USERS.ADMIN2), sql, [[NEW_APPROVER]])).toBe("ok");
  });

  it("is still refused for a non-admin, a JWT without a user, and anon", async () => {
    const sql = "select public.set_import_approvers($1::uuid[])";
    expect(await codeAs(db, as(USERS.OPS), sql, [[USERS.OPS]])).toBe("42501");
    expect(await codeAs(db, as(USERS.CHIEF), sql, [[USERS.CHIEF]])).toBe("42501"); // approver but not admin
    // An authenticated request with no sub (auth.uid() NULL) is not the operator session.
    await db.exec("begin");
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated" })]);
      await db.exec("set local role authenticated");
      await expect(db.query(sql, [[USERS.OPS]])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("rollback");
    }
    expect(await codeAs(db, { role: "anon" }, sql, [[USERS.OPS]])).toBe("42501");
    expect((await approvers()).ids).toEqual([USERS.CHIEF]);
  });

  it("the settings function keeps self-approval impossible and the helper is not callable by clients", async () => {
    expect(await codeAs(db, as(USERS.OPS), "select public.import_settings_operator()")).toBe("42501");
    const r = await db.query<{ c: number }>(
      "select count(*)::int c from pg_constraint where conrelid = 'public.import_approval_settings'::regclass and pg_get_constraintdef(oid) ilike '%allow_self_approval = false%'",
    );
    expect(r.rows[0].c).toBe(1);
  });
});
