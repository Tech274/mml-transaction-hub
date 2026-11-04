// SCRUM-129: import-level tests. A SYNTHETIC file shaped like the owner's 6 Oct upload
// (334 "MakeMyLabs Private Cloud", 2 "Oracle", 6 "Azure"; made-up names and amounts) goes through
// the validator, the submit service and, at the end, the real stage_import() + approve_import() on the
// in-process PGlite database. Never touches sandbox or live. (SCRUM-131: uploads are staged for sign-off;
// nothing is committed until an approver approves.)
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { ACTIVE_ALIAS_ENTRIES, NEVER_ALIASES, PUBLIC_CLOUD_PROVIDERS } from "@/lib/cloud-provider";
import { createApprovalDb, submitAs, asActorCommit, as, USERS } from "@/test-support/scrum131-db";
import { syntheticCsv, syntheticRows } from "@/test-support/scrum129-fixture";
import { runPreview, runSubmit, type StageRpcPayload, type StageRpcResult, type StrictImportDeps } from "../service";
import { sha256Hex } from "../hash";
import { parseCsvText } from "../parse";
import { validateStrict } from "../validate";
import { HEADER, row } from "./fixtures";

const enc = (s: string) => new TextEncoder().encode(s);
const validateCsv = (csv: string) => {
  const sheet = parseCsvText(csv);
  return validateStrict(sheet.header, sheet.rows, { blankRowsIgnored: sheet.blankRowsIgnored });
};

function fakeDeps() {
  const calls: StageRpcPayload[] = [];
  const deps: StrictImportDeps = {
    hasImportRole: async () => true,
    listCustomers: async () => [],
    priorImport: async () => null,
    callStage: async (p): Promise<StageRpcResult> => {
      calls.push(p);
      return {
        stage_id: "00000000-0000-4000-8000-000000000131",
        rows_sha256: "a".repeat(64),
        expires_at: "2026-10-13T00:00:00Z",
        repeat_of: null,
        row_count: p.p_rows.length,
      };
    },
    loadXlsx: async () => {
      throw new Error("xlsx not used");
    },
  };
  return { deps, calls };
}

describe("owner-shaped synthetic file (342 rows)", () => {
  const csv = syntheticCsv();

  it("validates to 336 Private cloud and 6 Public cloud, 0 errors, 0 blanked, batch kind mixed", () => {
    const r = validateCsv(csv);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatchObject({ rowsToImport: 342, privateRows: 336, publicRows: 6, providerErrorRows: 0, batchKind: "mixed", errorCount: 0 });
    expect(r.records.filter((x) => x.cloud_provider === null || x.lab_type === null)).toHaveLength(0);
    const byProvider: Record<string, number> = {};
    for (const x of r.records) byProvider[`${x.cloud_provider}|${x.lab_type}`] = (byProvider[`${x.cloud_provider}|${x.lab_type}`] ?? 0) + 1;
    expect(byProvider).toEqual({
      "MakeMyLabs Private Cloud|private_cloud": 334,
      "Oracle|private_cloud": 2,
      "Azure|public_cloud": 6,
    });
  });

  it("stages in one go for sign-off: p_kind 'mixed', every row carries its provider's type", async () => {
    const bytes = enc(csv);
    const { deps, calls } = fakeDeps();
    const preview = await runPreview(deps, { filename: "synthetic.csv", bytes });
    expect(preview.blockers).toEqual([]);
    const res = await runSubmit(deps, { filename: "synthetic.csv", bytes, expectedSha256: await sha256Hex(bytes) });
    expect(res).toMatchObject({ rows: 342, kind: "mixed", privateRows: 336, publicRows: 6 });
    expect(calls).toHaveLength(1);
    expect(calls[0].p_kind).toBe("mixed");
    const healed = calls[0].p_rows.map((r) => r.healed);
    expect(healed.filter((r) => r.lab_type === "private_cloud")).toHaveLength(336);
    expect(healed.filter((r) => r.lab_type === "public_cloud").every((r) => r.cloud_provider === "Azure")).toBe(true);
  });

  it("with one SAP, one unknown and one blank provider: SAP is private, the other two block with line numbers", () => {
    const rows = syntheticRows();
    rows[0].provider = "SAP";
    rows[1].provider = "IBM Cloud";
    rows[2].provider = "";
    const r = validateCsv(syntheticCsv(rows));
    expect(r.ok).toBe(false);
    expect(r.summary).toMatchObject({ privateRows: 334, publicRows: 6, providerErrorRows: 2 });
    expect(r.records[0]).toMatchObject({ cloud_provider: "SAP", lab_type: "private_cloud" });
    expect(r.rowErrors.map((e) => [e.line, e.header, e.value])).toEqual([
      [3, "Cloud Provider", "IBM Cloud"],
      [4, "Cloud Provider", ""],
    ]);
  });

  it("the server preview returns per-row provider outcomes for the preview table", async () => {
    const rows = syntheticRows();
    rows[0].provider = "OCI";
    rows[1].provider = "IBM Cloud";
    const { deps } = fakeDeps();
    const preview = await runPreview(deps, { filename: "synthetic.csv", bytes: enc(syntheticCsv(rows)) });
    expect(preview.providerRows).toHaveLength(342);
    expect(preview.providerRows[0]).toEqual({ line: 2, providerInFile: "OCI", storedProvider: "Oracle", cloudType: "private_cloud", aliasApplied: true, blocked: false });
    expect(preview.providerRows[1]).toEqual({ line: 3, providerInFile: "IBM Cloud", storedProvider: null, cloudType: null, aliasApplied: false, blocked: true });
    expect(preview.providerRows.filter((r) => r.blocked)).toHaveLength(preview.summary.providerErrorRows);
    expect(preview.providerRows.filter((r) => r.aliasApplied)).toHaveLength(preview.summary.providerAliasesApplied);
    expect(preview.providerRows.filter((r) => r.cloudType === "private_cloud")).toHaveLength(preview.summary.privateRows);
    expect(preview.providerRows.filter((r) => r.cloudType === "public_cloud")).toHaveLength(preview.summary.publicRows);
  });

  it("a file with any provider error is refused and nothing is sent to the database", async () => {
    const rows = syntheticRows();
    rows[10].provider = "Hybrid";
    const bytes = enc(syntheticCsv(rows));
    const { deps, calls } = fakeDeps();
    await expect(runSubmit(deps, { filename: "s.csv", bytes, expectedSha256: await sha256Hex(bytes) })).rejects.toMatchObject({
      code: "blocked",
    });
    expect(calls).toHaveLength(0);
  });
});


describe("provider rule in the validator", () => {
  const one = (provider: string, extra: Record<string, string> = {}) => {
    const header = [...HEADER, ...Object.keys(extra)];
    const base = row(2, { "Cloud Provider": provider });
    return validateStrict(header, [{ line: 2, cells: [...base.cells, ...Object.values(extra)] }]);
  };

  it.each(ACTIVE_ALIAS_ENTRIES.map(([alias, canonical]) => [alias, canonical]))("%j is accepted and stored as %j", (alias, canonical) => {
    for (const spelling of [alias, ` ${alias.toUpperCase()} `]) {
      const r = one(spelling);
      expect(r.ok).toBe(true);
      expect(r.records[0].cloud_provider).toBe(canonical);
    }
  });

  it.each(["SAP", "Oracle", "MakeMyLabs", "MakeMyLabs Private Cloud", "OCI", "Oracle Cloud"])("%j is Private cloud", (p) => {
    expect(one(p).records[0].lab_type).toBe("private_cloud");
  });

  it.each([...NEVER_ALIASES, "   ", "OpenAI", "Alibaba Cloud", "Private Cloud Hybrid"])("%j blocks the row (never public, never blank-stored)", (p) => {
    const r = one(p);
    expect(r.ok).toBe(false);
    expect(r.records[0].lab_type).toBeNull();
    expect(r.records[0].cloud_provider).toBeNull();
    expect(r.summary.publicRows).toBe(0);
  });

  it("no path yields Public cloud unless the provider is AWS, Azure or GCP", () => {
    const spellings = [
      ...ACTIVE_ALIAS_ENTRIES.map(([a]) => a),
      ...NEVER_ALIASES,
      "OpenAI", "IBM", "Hybrid", "public", "Public cloud", "public_cloud", "", "SAP BTP", "Oracle Cloud Infrastructure",
    ];
    const cloudTypes = ["", "Public cloud", "Private cloud", "public_cloud", "private", "Hybrid"];
    let checked = 0;
    for (const p of spellings) {
      for (const t of cloudTypes) {
        const r = one(p, { "Cloud Type": t });
        for (const rec of r.records) {
          if (rec.lab_type === "public_cloud") expect(PUBLIC_CLOUD_PROVIDERS as readonly string[]).toContain(rec.cloud_provider);
          if (rec.lab_type === null) expect(r.ok).toBe(false);
        }
        checked += 1;
      }
    }
    expect(checked).toBe(spellings.length * cloudTypes.length);
  });

  it("an optional Cloud Type column must agree with the provider", () => {
    expect(one("SAP", { "Cloud Type": "Private cloud" }).ok).toBe(true);
    const conflict = one("SAP", { "Cloud Type": "Public cloud" });
    expect(conflict.ok).toBe(false);
    expect(conflict.rowErrors[0]).toMatchObject({ header: "Cloud Type", column: "M" });
    expect(one("Azure", { "Cloud Type": "Hybrid" }).ok).toBe(false);
  });

  it("Cloud Type and System Config are optional columns (no 'missing' or 'unknown column' notes)", () => {
    const plain = one("AWS");
    expect(plain.warnings).toEqual([]);
    const withBoth = one("Oracle", { "Cloud Type": "private", "System Config": "16GB 4vCPUs" });
    expect(withBoth.warnings).toEqual([]);
    expect(withBoth.records[0]).toMatchObject({ lab_type: "private_cloud", system_config: "16GB 4vCPUs" });
  });

  it("System Config on a Public cloud row is noted and not saved", () => {
    const r = one("GCP", { "System Config": "8GB" });
    expect(r.ok).toBe(true);
    expect(r.records[0].system_config).toBeNull();
    expect(r.warnings[0].message).toMatch(/Private cloud rows only/);
  });
});


describe("end to end: stage_import -> approve_import (PGlite)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createApprovalDb();
  }, 120_000);

  it("stores 336 private + 6 public with canonical providers and 0 NULL providers once Chief approves", async () => {
    const staged = await submitAs(db, USERS.OPS, syntheticCsv());
    const before = (await db.query<{ n: number }>("select count(*)::int n from public.transactions")).rows[0].n;
    expect(before).toBe(0);
    const res = await asActorCommit(db, as(USERS.CHIEF), async (q) => {
      const r = await q.query<{ r: { batch_id: string; inserted: number; kind: string; private_rows: number; public_rows: number } }>(
        "select public.approve_import($1, $2, $3, null) r",
        [staged.stageId, staged.fileSha256, staged.rowsSha256],
      );
      return r.rows[0].r;
    });
    expect(res).toMatchObject({ inserted: 342, kind: "mixed", private_rows: 336, public_rows: 6 });
    const split = await db.query<{ repository_type: string; cloud_provider: string | null; n: number }>(
      "select repository_type, cloud_provider, count(*)::int n from public.transactions where import_batch_id = $1 group by 1, 2 order by 1, 2",
      [res.batch_id],
    );
    expect(split.rows).toEqual([
      { repository_type: "private_cloud", cloud_provider: "MakeMyLabs Private Cloud", n: 334 },
      { repository_type: "private_cloud", cloud_provider: "Oracle", n: 2 },
      { repository_type: "public_cloud", cloud_provider: "Azure", n: 6 },
    ]);
  });
});
