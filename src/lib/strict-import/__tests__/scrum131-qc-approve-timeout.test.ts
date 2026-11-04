// SCRUM-131 Eng QC S3: approve_import carries a 60 s function-level statement_timeout (PostgREST hoists it into
// the RPC transaction), so a 5,000-row approve is not cut off by the authenticated role's 8 s. PGlite catalog check.
// Fix R-2 (071200): stage_import (both forms) gets the same 60 s; 071200 restates it on approve_import (CREATE OR REPLACE).
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createApprovalDb } from "@/test-support/scrum131-db";

describe("SCRUM-131 QC S3: approve timeout", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createApprovalDb();
  }, 120_000);

  it("approve_import has statement_timeout=60s and keeps SECURITY DEFINER + search_path", async () => {
    const r = await db.query<{ cfg: string[]; secdef: boolean }>(
      "select proconfig cfg, prosecdef secdef from pg_proc where oid = 'public.approve_import(uuid, text, text, text)'::regprocedure",
    );
    expect(r.rows[0].secdef).toBe(true);
    expect(r.rows[0].cfg).toEqual(
      expect.arrayContaining(["search_path=public", "statement_timeout=60s"]),
    );
  });

  it("only approve_import and stage_import (both forms, fix R-2 071200) get the longer timeout; reject, cancel keep the role default", async () => {
    const r = await db.query<{ fn: string; cfg: string[]; secdef: boolean }>(
      "select oid::regprocedure::text fn, proconfig cfg, prosecdef secdef from pg_proc where pronamespace = 'public'::regnamespace and array_to_string(proconfig, ',') like '%statement_timeout%' order by 1",
    );
    expect(r.rows.map((x) => x.fn)).toEqual([
      "approve_import(uuid,text,text,text)",
      "stage_import(text,text,text,text,text,jsonb,jsonb,jsonb)",
      "stage_import(text,text,text,text,text,jsonb,jsonb,jsonb,boolean)",
    ]);
    for (const row of r.rows) {
      expect(row.secdef).toBe(true);
      expect(row.cfg).toEqual(
        expect.arrayContaining(["search_path=public", "statement_timeout=60s"]),
      );
    }
  });

  it("a 5,000-row file is still the cap the timeout was sized for", async () => {
    const r = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.import_stages'::regclass and pg_get_constraintdef(oid) like '%row_count%5000%'",
    );
    expect(r.rows.length).toBeGreaterThan(0);
  });
});
