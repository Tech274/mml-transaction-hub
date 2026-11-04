// SCRUM-131 test helpers: the staging -> approval flow on the in-process PGlite database
// (src/test-support/local-db.ts). Tests only; synthetic data only; never touches sandbox or live.
import type { PGlite } from "@electric-sql/pglite";
import { createLocalDb, type Actor } from "./local-db";
import { runSubmit, type StageRpcPayload, type StageRpcResult, type StrictImportDeps, type SubmitResult } from "@/lib/strict-import/service";
import { sha256Hex } from "@/lib/strict-import/hash";
import { SYNTHETIC_EXISTING_CUSTOMERS } from "./scrum131-fixture";

export const USERS = {
  CHIEF: "00000000-0000-4000-8000-0000000c0001", // the approver (role leadership: approving needs no import role)
  OPS: "00000000-0000-4000-8000-0000000c0002", // uploader (ops_user)
  LEAD: "00000000-0000-4000-8000-0000000c0003", // uploader (ops_lead), NOT an approver
  ADMIN2: "00000000-0000-4000-8000-0000000c0004", // admin AND approver (for the self-approval case)
  VIEWER: "00000000-0000-4000-8000-0000000c0005",
} as const;

/** Like asActor, but COMMITS, so a stage made by one user can be decided by another. */
export async function asActorCommit<T>(db: PGlite, actor: Actor, fn: (q: PGlite) => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${actor.role}`);
    const out = await fn(db);
    await db.exec("commit");
    return out;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}

export const as = (userId: string): Actor => ({ role: "authenticated", userId });

/** Fresh DB with five users, synthetic customers and Chief as the only approver (the approved default). */
export async function createApprovalDb(): Promise<PGlite> {
  const db = await createLocalDb();
  for (const [name, id] of Object.entries(USERS)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name.toLowerCase()}@example.test`]);
  }
  await db.exec("delete from public.user_roles");
  const roles: [string, string][] = [
    [USERS.CHIEF, "leadership"],
    [USERS.OPS, "ops_user"],
    [USERS.LEAD, "ops_lead"],
    [USERS.ADMIN2, "admin"],
    [USERS.VIEWER, "viewer"],
  ];
  for (const [id, role] of roles) await db.query("insert into public.user_roles (user_id, role) values ($1, $2::app_role)", [id, role]);
  for (const name of SYNTHETIC_EXISTING_CUSTOMERS) await db.query("insert into public.customers (customer_name) values ($1)", [name]);
  await db.query("update public.import_approval_settings set approver_user_ids = $1::uuid[] where id = 1", [[USERS.CHIEF]]);
  return db;
}

/** The real server path (runSubmit: parse -> Healer -> validate -> stage_import) as `userId`, committed. */
export async function submitAs(
  db: PGlite,
  userId: string,
  csv: string,
  filename = "synthetic.csv",
  opts: {
    acknowledgeRepeatFile?: boolean;
    /** SCRUM-131 date fix: the uploader's date order (preview picker), as the server fn passes it. */
    dateOrder?: "DMY" | "MDY";
    /** QC S2 tests: change what reaches stage_import, as a caller of the RPC could. */
    tamper?: (p: StageRpcPayload) => StageRpcPayload;
  } = {},
): Promise<SubmitResult> {
  const bytes = new TextEncoder().encode(csv);
  return asActorCommit(db, as(userId), async (q) => {
    const deps: StrictImportDeps = {
      hasImportRole: async () =>
        (await q.query<{ ok: boolean }>("select public.has_any_role($1, array['admin','ops_lead','ops_user']::app_role[]) ok", [userId])).rows[0].ok,
      listCustomers: async () =>
        (await q.query<{ customer_name: string; normalized_name: string }>("select customer_name, normalized_name from public.customers")).rows,
      priorImport: async () => null,
      callStage: async (sent) => {
        const p = opts.tamper ? opts.tamper(structuredClone(sent)) : sent;
        const r = await q.query<{ r: StageRpcResult }>(
          "select public.stage_import($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::boolean) r",
          [p.p_kind, p.p_filename, p.p_file_sha256, p.p_template_version, p.p_healer_version, JSON.stringify(p.p_rows), JSON.stringify(p.p_corrections), JSON.stringify(p.p_summary), p.p_acknowledge_repeat],
        );
        return r.rows[0].r;
      },
      loadXlsx: async () => {
        throw new Error("xlsx not used");
      },
    };
    return runSubmit(deps, {
      filename,
      bytes,
      expectedSha256: await sha256Hex(bytes),
      acknowledgeRepeatFile: opts.acknowledgeRepeatFile,
      dateOrder: opts.dateOrder,
    });
  });
}

export async function stageRow(db: PGlite, id: string) {
  const r = await db.query<Record<string, unknown>>("select * from public.import_stages where id = $1", [id]);
  return r.rows[0];
}

/** Postgres error code (or "ok") of a statement run as `actor` (rolled back). */
export async function codeAs(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<string> {
  await db.exec("begin");
  try {
    const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${actor.role}`);
    await db.query(sql, params);
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  } finally {
    await db.exec("rollback");
  }
}

/** Error message of a statement run as `actor` (rolled back), or "ok". */
export async function messageAs(db: PGlite, actor: Actor, sql: string, params: unknown[] = []): Promise<string> {
  await db.exec("begin");
  try {
    const claims = actor.role === "authenticated" ? { sub: actor.userId, role: "authenticated" } : { role: actor.role };
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${actor.role}`);
    await db.query(sql, params);
    return "ok";
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec("rollback");
  }
}
