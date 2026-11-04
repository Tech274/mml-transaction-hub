// SCRUM-131 Eng QC fixes (John, 6 Oct; report /workspace/mml-validation/SCRUM-131-eng-qc.md): source guards.
// Behaviour is tested where it lives (approval DB/access tests); these keep the fixes from regressing.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("SCRUM-131 Eng QC fixes", () => {
  it("B1: the held is_complete rule is not in supabase/migrations (Chief GO; no db push can apply it)", () => {
    const applied = readdirSync(path.join(root, "supabase/migrations"));
    expect(applied.some((f) => f.includes("scrum131_is_complete_rule"))).toBe(false);
    for (const f of applied.filter((n) => n.endsWith(".sql")))
      expect(read(`supabase/migrations/${f}`)).not.toMatch(/ALTER COLUMN is_complete SET EXPRESSION AS \(\s*\n?\s*NOT public\.is_blank_text/);
    const held = read("supabase/migrations-pending/scrum131_is_complete_rule.sql");
    expect(held).toContain("REQUIRES CHIEF GO");
    expect(held).toContain("-- approval-required:");
    expect(read("supabase/migrations-pending/README.md")).toContain("scrum131_is_complete_rule.sql");
  });

  it("S4: the approve dialog restates the repeat (who, when, prior batch) and needs a tick", () => {
    const page = read("src/routes/_authenticated/import-approvals.$stageId.tsx");
    expect(page).toContain('data-testid="repeat-ack"');
    expect(page).toContain('dialog === "approve" && repeat && (');
    expect(page).toContain('disabled={busy || (dialog === "approve" && !!repeat && !repeatAck)}');
    expect(page).toContain("repeatLine(stage, uploaderName ? { [stage.uploaded_by]: uploaderName } : {})");
    expect(page).toMatch(/const openDialog = [\s\S]*?setRepeatAck\(false\)/);
  });

  it("S8: the badge/status path never calls expire_import_stages (one read-only RPC)", () => {
    const fns = read("src/lib/import-approvals.functions.ts");
    const status = fns.slice(fns.indexOf("export const getImportApprovalStatus"), fns.indexOf("export const listImportStages"));
    expect(status).toContain("readImportApprovalStatus(");
    expect(status).not.toContain("expire_import_stages");
    const q = read("src/lib/strict-import/approval-queries.ts");
    const fn = q.slice(q.indexOf("export async function readImportApprovalStatus"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 2);
    expect(body).toContain('rpc<');
    expect(body).toContain('"import_approval_status"');
    expect(body).not.toMatch(/expire_import_stages|expireStale/);
    const sql = read("supabase/migrations/20261006070700_scrum131_import_approval_status.sql");
    expect(sql).toMatch(/STABLE\s+SECURITY DEFINER/);
    expect(sql).toContain("s.expires_at >= now()");
  });

  it("S5: the sign-off reads are paged on a unique order", () => {
    const q = read("src/lib/strict-import/approval-queries.ts");
    expect(q).toContain("export const DETAIL_PAGE = 1000;");
    expect(q).toContain("page(from, from + DETAIL_PAGE - 1)");
    expect(q).not.toMatch(/\.range\(0, (4999|19999)\)/);
  });
});
