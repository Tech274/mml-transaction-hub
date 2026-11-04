// SCRUM-131 release-blocker fix R-1 (071200): no import function may raise a SQLSTATE that PostgREST retries.
// PostgREST 14.x re-runs the whole transaction on 40001 (serialization_failure) and 40P01 (deadlock_detected) with
// no limit, so a deterministic RAISE with either code loops forever (sandbox: ~164k rollbacks in ~3.5 min).
// 1) source scan: the LAST definition of every function across supabase/migrations (in apply order) raises neither;
//    plain statements outside function bodies do not either; no app code maps or emits them.
// 2) database: after all migrations, no public function body contains them, and the wrong-hash (approve_import) and
//    reconcile-mismatch (commit_import) paths return P0001 with their message and write nothing.
// Synthetic data only (PGlite). Never touches sandbox or live.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { MIGRATIONS_DIR, migrationFiles } from "@/test-support/local-db";
import { createApprovalDb, submitAs, USERS } from "@/test-support/scrum131-db";
import { syntheticCsv, syntheticRows } from "@/test-support/scrum129-fixture";
import type { SubmitResult } from "../service";

const RETRIED = /'40001'|'40P01'|\bserialization_failure\b|\bdeadlock_detected\b/i;
const ROOT = path.resolve(MIGRATIONS_DIR, "../..");

/** SQL without `--` comments (the headers explain the fix and name the codes). Dollar-quoted bodies keep their text. */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

interface FnDef {
  file: string;
  key: string; // name + normalised parameter list (stage_import has an 8- and a 9-argument form)
  body: string;
}

/** Every CREATE [OR REPLACE] FUNCTION in a file, with its dollar-quoted body. */
function functionDefs(file: string, sql: string): { defs: FnDef[]; rest: string } {
  const defs: FnDef[] = [];
  let rest = sql;
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+([\w."]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\bas\s+(\$[\w]*\$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const tag = m[3];
    const start = m.index + m[0].length;
    const end = sql.indexOf(tag, start);
    if (end < 0) throw new Error(`${file}: unterminated body for ${m[1]}`);
    const body = sql.slice(start, end);
    const params = m[2]
      .replace(/\s+default\s+[^,]+/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    defs.push({ file, key: `${m[1].toLowerCase().replace(/^public\./, "")}(${params})`, body });
    rest = rest.replace(body, "");
    re.lastIndex = end + tag.length;
  }
  return { defs, rest };
}

describe("SCRUM-131 fix R-1: no import function raises a PostgREST-retried SQLSTATE (source scan)", () => {
  const files = migrationFiles();
  const last = new Map<string, FnDef>();
  const superseded: string[] = [];
  const outside: string[] = [];
  for (const f of files) {
    const { defs, rest } = functionDefs(
      f,
      stripComments(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")),
    );
    for (const d of defs) {
      const prev = last.get(d.key);
      if (prev && RETRIED.test(prev.body))
        superseded.push(`${prev.file} ${prev.key.split("(")[0]}`);
      last.set(d.key, d);
    }
    if (RETRIED.test(rest)) outside.push(f);
  }

  it("scans the release migrations (070000, 070600-071100) and the fix (071200)", () => {
    const release = files.filter((f) => /^202610060(70000|70[6-9]00|71[0-2]00)_/.test(f));
    expect(release).toHaveLength(8);
    expect(release.at(-1)).toBe("20261006071200_scrum131_fix_r1.sql");
    expect(
      last.get(
        "approve_import(p_stage_id uuid, p_file_sha256 text, p_rows_sha256 text, p_reason text)",
      )?.file,
    ).toBe("20261006071200_scrum131_fix_r1.sql");
    expect(last.get("commit_import(p_stage_id uuid)")?.file).toBe(
      "20261006071200_scrum131_fix_r1.sql",
    );
  });

  it("the last definition of every function raises neither 40001 nor 40P01", () => {
    const offenders = [...last.values()]
      .filter((d) => RETRIED.test(d.body))
      .map((d) => `${d.file} ${d.key}`);
    expect(offenders).toEqual([]);
  });

  it("the only historical sites are the two 070000 bodies that 071200 replaces", () => {
    expect(superseded.sort()).toEqual([
      "20261006070000_scrum131_import_staging_approval.sql approve_import",
      "20261006070000_scrum131_import_staging_approval.sql commit_import",
    ]);
  });

  it("no plain statement or DO block outside a function body uses them", () => {
    expect(outside).toEqual([]);
  });

  it("the held-back migrations-pending files do not use them either", () => {
    const dir = path.join(ROOT, "supabase/migrations-pending");
    const bad = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => RETRIED.test(stripComments(readFileSync(path.join(dir, f), "utf8"))));
    expect(bad).toEqual([]);
  });

  it("no app code keys on or emits 40001 / 40P01 (friendly-error and approval mappings)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(p);
        } else if (
          /\.(ts|tsx)$/.test(name) &&
          !/\.test\.tsx?$/.test(name) &&
          /\b40001\b|\b40P01\b/.test(readFileSync(p, "utf8"))
        ) {
          hits.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(hits).toEqual([]);
  });
});

describe("SCRUM-131 fix R-1: the wrong-hash and mismatch paths return P0001 (database)", () => {
  let db: PGlite;
  let stage: SubmitResult;
  const APPROVE = "select public.approve_import($1, $2, $3, $4) r";
  const txCount = async () =>
    (await db.query<{ n: number }>("select count(*)::int n from public.transactions")).rows[0].n;

  /** Runs `approve_import` as Chief after `setup` (run as owner) in one transaction that is always rolled back. */
  async function approveError(
    args: unknown[],
    setup?: string,
  ): Promise<{ code: string; message: string }> {
    await db.exec("begin");
    try {
      if (setup) await db.query(setup, [stage.stageId]);
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: USERS.CHIEF, role: "authenticated" }),
      ]);
      await db.exec("set local role authenticated");
      await db.query(APPROVE, args);
      return { code: "ok", message: "" };
    } catch (e) {
      return { code: (e as { code?: string }).code ?? "?", message: (e as Error).message };
    } finally {
      await db.exec("rollback");
    }
  }

  beforeAll(async () => {
    db = await createApprovalDb();
    const rows = syntheticRows(["AWS", "SAP", "Oracle"]).map((r, i) => ({
      ...r,
      potentialId: `SYN131-R1-${i}`,
    }));
    stage = await submitAs(db, USERS.OPS, syntheticCsv(rows), "synthetic-r1.csv");
  }, 120_000);

  it("no public function body contains 40001 or 40P01 after every migration", async () => {
    const r = await db.query<{ fn: string }>(
      "select oid::regprocedure::text fn from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~* '''40001''|''40P01''|serialization_failure|deadlock_detected'",
    );
    expect(r.rows).toEqual([]);
  });

  it("approve_import with a wrong rows hash or file hash: P0001, same message, nothing written", async () => {
    for (const args of [
      [stage.stageId, stage.fileSha256, "f".repeat(64), null],
      [stage.stageId, "e".repeat(64), stage.rowsSha256, null],
    ]) {
      expect(await approveError(args)).toEqual({
        code: "P0001",
        message: "The staged import changed since it was shown; reload and review again",
      });
    }
    expect(await txCount()).toBe(0);
  });

  it("commit_import reconcile mismatch (stage totals differ from what is inserted): P0001, same message, rolled back", async () => {
    const r = await approveError(
      [stage.stageId, stage.fileSha256, stage.rowsSha256, null],
      "update public.import_stages set total_selling = total_selling + 1 where id = $1",
    );
    expect(r.code).toBe("P0001");
    expect(r.message).toMatch(
      /^Commit does not match the approved import \(.*\); nothing was written$/,
    );
    expect(await txCount()).toBe(0);
    const s = (
      await db.query<{ status: string }>("select status from public.import_stages where id = $1", [
        stage.stageId,
      ])
    ).rows[0];
    expect(s.status).toBe("pending");
  });

  it("the untouched stage still approves normally afterwards", async () => {
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USERS.CHIEF, role: "authenticated" }),
    ]);
    await db.exec("set local role authenticated");
    const res = (
      await db.query<{ r: { inserted: number } }>(APPROVE, [
        stage.stageId,
        stage.fileSha256,
        stage.rowsSha256,
        null,
      ])
    ).rows[0].r;
    await db.exec("rollback");
    expect(res.inserted).toBe(3);
  });

  it("commit_import is still not executable by any client role", async () => {
    const r = await db.query<{ a: boolean; b: boolean }>(
      "select has_function_privilege('authenticated', 'public.commit_import(uuid)', 'execute') a, has_function_privilege('anon', 'public.commit_import(uuid)', 'execute') b",
    );
    expect(r.rows[0]).toEqual({ a: false, b: false });
  });
});
