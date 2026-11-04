import { describe, it, expect, vi } from "vitest";
import { runPreview, runSubmit, stageRpcError, type StageRpcPayload, type StrictImportDeps } from "../service";
import { HEALER_VERSION } from "../healer";
import { sha256Hex, base64ToBytes, bytesToBase64 } from "../hash";
import { parseStrictBytes, MAX_STRICT_FILE_BYTES } from "../parse";
import { HEADER } from "./fixtures";

// Synthetic CSV only. No real customers, IDs or amounts.
const line = (pid: string, customer: string, input: string, selling: string) =>
  [pid, "3", "2026", customer, "Synthetic Lab A", "VILT", "2026-03-01", "2026-03-31", "10", input, selling, "AWS"].join(",");
const csv = (...rows: string[]) => new TextEncoder().encode([HEADER.join(","), ...rows].join("\n") + "\n");

const GOOD = csv(
  line("PID-TEST-001", "Acme Test Co", "1000", "1500.50"),
  line("PID-TEST-001", "Acme Test Co", "1000", "1500.50"), // same PID twice = two rows (never merged)
  line("PID-TEST-002", "Beta Test Ltd", "200.25", "300"),
);

function fakeDeps(over: Partial<StrictImportDeps> = {}) {
  const calls: StageRpcPayload[] = [];
  const deps: StrictImportDeps = {
    hasImportRole: async () => true,
    listCustomers: async () => [{ customer_name: "Acme Test Co", normalized_name: "acme test co" }],
    priorImport: async () => null,
    callStage: async (p) => {
      calls.push(p);
      return {
        stage_id: "00000000-0000-4000-8000-000000000001",
        rows_sha256: "c".repeat(64),
        expires_at: "2026-10-13T06:30:00Z",
        repeat_of: null,
        row_count: p.p_rows.length,
      };
    },
    loadXlsx: async () => {
      throw new Error("xlsx not used in this test");
    },
    ...over,
  };
  return { deps, calls };
}

describe("hash helpers", () => {
  it("sha256 of known input", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("base64 round-trip", () => {
    const b = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
});

describe("parseStrictBytes", () => {
  it("rejects invalid UTF-8 CSV instead of guessing", async () => {
    await expect(parseStrictBytes("a.csv", new Uint8Array([0xff, 0xfe, 0x41]), async () => { throw new Error(); })).rejects.toThrow(/UTF-8/);
  });
  it("rejects other extensions and oversized files", async () => {
    await expect(parseStrictBytes("a.xls", new Uint8Array([1]), async () => { throw new Error(); })).rejects.toThrow(/Only .xlsx and .csv/);
    await expect(parseStrictBytes("a.csv", new Uint8Array(MAX_STRICT_FILE_BYTES + 1), async () => { throw new Error(); })).rejects.toThrow(/5 MB/);
  });
});

describe("runPreview", () => {
  it("is refused for roles without import rights", async () => {
    const { deps } = fakeDeps({ hasImportRole: async () => false });
    await expect(runPreview(deps, { filename: "f.csv", bytes: GOOD })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("reports summary, new customers and file hash; never writes", async () => {
    const { deps, calls } = fakeDeps();
    const p = await runPreview(deps, { filename: "f.csv", bytes: GOOD });
    expect(p.summary).toMatchObject({ rowsToImport: 3, errorCount: 0, totalSellingCents: 330100, totalInputCents: 220025 });
    expect(p.customers.newCustomers).toEqual(["Beta Test Ltd"]);
    expect(p.fileSha256).toBe(await sha256Hex(GOOD));
    expect(p.templateStatus).toBe("LENIENT_2026-09-28");
    expect(p.blockers).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it("a failed duplicate-file lookup does not block", async () => {
    const { deps } = fakeDeps({ priorImport: async () => null });
    const p = await runPreview(deps, { filename: "f.csv", bytes: GOOD });
    expect(p.priorImport).toBeNull();
    expect(p.blockers).toEqual([]);
  });
});

describe("runSubmit (SCRUM-131: submit for approval; nothing is written to transactions)", () => {
  const base = async () => ({ filename: "f.csv", bytes: GOOD, expectedSha256: await sha256Hex(GOOD) });

  it("stages one healed row per input row with the Healer version and derived kind", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runSubmit(deps, await base());
    expect(r).toMatchObject({ stageId: "00000000-0000-4000-8000-000000000001", rows: 3, kind: "public_cloud", privateRows: 0, publicRows: 3, healerVersion: HEALER_VERSION });
    expect(calls).toHaveLength(1);
    expect(calls[0].p_rows.map((x) => x.source_line)).toEqual([2, 3, 4]);
    expect(calls[0].p_kind).toBe("public_cloud");
    expect(calls[0].p_healer_version).toBe(HEALER_VERSION);
    expect(calls[0].p_rows.every((x) => x.healed.lab_type === "public_cloud" && x.healed.cloud_provider === "AWS")).toBe(true);
    expect(calls[0].p_rows[0].original["Potential ID"]).toBe("PID-TEST-001");
  });
  it("refuses a file that differs from the previewed one", async () => {
    const { deps, calls } = fakeDeps();
    await expect(runSubmit(deps, { ...(await base()), expectedSha256: "0".repeat(64) })).rejects.toMatchObject({ code: "file_changed" });
    expect(calls).toHaveLength(0);
  });
  it("a blank cost is healed to 0 (NOT NULL), recorded with its blank original, and is a warning", async () => {
    const blankCost = csv(line("PID-TEST-003", "Acme Test Co", "", "100"));
    const { deps, calls } = fakeDeps();
    const p = await runPreview(deps, { filename: "f.csv", bytes: blankCost });
    expect(p.canSubmit).toBe(true);
    expect(p.warnings.some((w) => w.header === "Input Cost" && /Stored as 0/.test(w.message))).toBe(true);
    const r = await runSubmit(deps, { filename: "f.csv", bytes: blankCost, expectedSha256: await sha256Hex(blankCost) });
    expect(r.rows).toBe(1);
    expect(r.incompleteRows).toBe(1);
    expect(calls[0].p_rows[0].healed.input_cost).toBe("0.00");
    expect(calls[0].p_rows[0].is_incomplete).toBe(true);
    expect(calls[0].p_corrections).toEqual([{ source_line: 2, field: "input_cost", rule: "price.blank_to_zero", original: null, healed: "0" }]);
  });
  it("SCRUM-129/131: an unknown provider blocks and nothing is sent", async () => {
    const header = HEADER.join(",");
    const body = ["PID-TEST-003", "3", "2026", "Acme Test Co", "Synthetic Lab A", "VILT", "2026-03-01", "2026-03-31", "10", "100", "150", "OpenAI"].join(",");
    const bytes = new TextEncoder().encode(`${header}\n${body}\n`);
    const { deps, calls } = fakeDeps();
    await expect(runSubmit(deps, { filename: "f.csv", bytes, expectedSha256: await sha256Hex(bytes) })).rejects.toMatchObject({ code: "blocked" });
    expect(calls).toHaveLength(0);
  });
  it("an unknown extra column is ignored and the row is still staged", async () => {
    const bad = new TextEncoder().encode(`${HEADER.join(",")},S.No,Remarks\n${line("PID-TEST-003", "Acme Test Co", "1", "2")},4,note\n`);
    const { deps, calls } = fakeDeps();
    const preview = await runPreview(deps, { filename: "f.csv", bytes: bad });
    expect(preview.blockers).toEqual([]);
    expect(preview.warnings.map((w) => w.message)).toEqual(['Unknown column "S.No" is ignored.', 'Unknown column "Remarks" is ignored.']);
    const r = await runSubmit(deps, { filename: "f.csv", bytes: bad, expectedSha256: await sha256Hex(bad) });
    expect(r.rows).toBe(1);
    expect(calls[0].p_rows[0].healed).toMatchObject({ potential_id: "PID-TEST-003", cloud_provider: "AWS", selling_cost: "2.00" });
    expect(JSON.stringify(calls[0].p_rows[0].healed)).not.toMatch(/S\.No|Remarks|note/);
  });
  it("a new customer is a warning, not a block", async () => {
    const { deps } = fakeDeps();
    const p = await runPreview(deps, { filename: "f.csv", bytes: GOOD });
    expect(p.customers.newCustomers).toEqual(["Beta Test Ltd"]);
    expect(p.healer?.newCustomers).toEqual(["Beta Test Ltd"]);
    expect(p.warnings.some((w) => /New customer "Beta Test Ltd"/.test(w.message))).toBe(true);
    expect(p.canSubmit).toBe(true);
  });
  it("a repeated file is a WARNING (decided): preview warns; submit WITHOUT acknowledgeRepeatFile is refused, nothing sent", async () => {
    const prior = { id: "00000000-0000-4000-8000-000000000099", importedOn: "2026-09-01" };
    const { deps, calls } = fakeDeps({ priorImport: async () => prior });
    const preview = await runPreview(deps, { filename: "f.csv", bytes: GOOD });
    expect(preview.priorImport).toEqual(prior);
    expect(preview.blockers).toEqual([]);
    expect(preview.canSubmit).toBe(true);
    expect(preview.repeatFileWarning).toMatch(/already imported on 2026-09-01/);
    await expect(runSubmit(deps, await base())).rejects.toMatchObject({
      code: "repeat_file",
      message: expect.stringMatching(/already imported on 2026-09-01 \(batch 00000000-0000-4000-8000-000000000099\)/),
      repeat: { canAcknowledge: true, repeatOf: { source: "batch", id: prior.id, at: "2026-09-01" } },
    });
    await expect(runSubmit(deps, { ...(await base()), acknowledgeRepeatFile: false })).rejects.toMatchObject({ code: "repeat_file" });
    expect(calls).toHaveLength(0);
  });
  it("a repeated file WITH acknowledgeRepeatFile: true is staged and the acknowledgement is sent to the DB", async () => {
    const prior = { id: "00000000-0000-4000-8000-000000000099", importedOn: "2026-09-01" };
    const repeatOf = { source: "batch" as const, id: prior.id, at: "2026-09-01T00:00:00Z" };
    const { deps, calls } = fakeDeps({ priorImport: async () => prior });
    deps.callStage = async (p) => {
      calls.push(p);
      return { stage_id: "s-ack", rows_sha256: "c".repeat(64), expires_at: "x", repeat_of: repeatOf, row_count: p.p_rows.length, repeat_acknowledged: true };
    };
    const r = await runSubmit(deps, { ...(await base()), acknowledgeRepeatFile: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].p_acknowledge_repeat).toBe(true);
    expect(r).toMatchObject({ stageId: "s-ack", repeatOf, repeatAcknowledged: true });
  });
  it("a new file sends p_acknowledge_repeat = false and reports repeatAcknowledged = false", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runSubmit(deps, await base());
    expect(calls[0].p_acknowledge_repeat).toBe(false);
    expect(r.repeatAcknowledged).toBe(false);
  });
  it("a pending upload of the same file is also a warning that needs the acknowledgement", async () => {
    const { deps, calls } = fakeDeps({ pendingImport: async () => ({ id: "s1", importedOn: "2026-10-06" }) });
    const preview = await runPreview(deps, { filename: "f.csv", bytes: GOOD });
    expect(preview.repeatFileWarning).toMatch(/already waiting for approval/);
    await expect(runSubmit(deps, await base())).rejects.toMatchObject({
      code: "repeat_file",
      repeat: { canAcknowledge: true, repeatOf: { source: "stage", id: "s1", status: "pending" } },
    });
    await runSubmit(deps, { ...(await base()), acknowledgeRepeatFile: true });
    expect(calls[0].p_acknowledge_repeat).toBe(true);
  });
  it("the DB's repeat refusals map to repeat_file: unacknowledged (canAcknowledge) vs 'block' (cannot)", async () => {
    const detail = JSON.stringify({ source: "batch", id: "b-1", at: "2026-09-01" });
    const unack = Object.assign(new Error("Repeat file not acknowledged: this exact file was already imported or is waiting for approval"), { details: detail });
    const { deps: d0 } = fakeDeps({ callStage: vi.fn(async () => { throw unack; }) });
    await expect(runSubmit(d0, await base())).rejects.toMatchObject({ code: "repeat_file", repeat: { canAcknowledge: true, repeatOf: { source: "batch", id: "b-1" } } });
    const { deps: d1 } = fakeDeps({ callStage: vi.fn(async () => { throw new Error("This exact file was already imported or is waiting for approval"); }) });
    await expect(runSubmit(d1, { ...(await base()), acknowledgeRepeatFile: true })).rejects.toMatchObject({
      code: "repeat_file",
      repeat: { canAcknowledge: false, repeatOf: null },
    });
    const { deps: d2 } = fakeDeps({ callStage: vi.fn(async () => { throw new Error("Import approval is not configured: no approver is set"); }) });
    await expect(runSubmit(d2, await base())).rejects.toMatchObject({ code: "not_configured" });
  });
  it("database errors are reported as 'nothing was staged'", async () => {
    const { deps } = fakeDeps({ callStage: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(runSubmit(deps, await base())).rejects.toMatchObject({ code: "db_error", message: expect.stringMatching(/nothing was staged/) });
  });
  it("a staging row-count mismatch is surfaced loudly", async () => {
    const { deps } = fakeDeps({
      callStage: async () => ({ stage_id: "s", rows_sha256: "c".repeat(64), expires_at: "x", repeat_of: null, row_count: 2 }),
    });
    await expect(runSubmit(deps, await base())).rejects.toMatchObject({ code: "reconcile" });
  });
  it("is refused for roles without import rights", async () => {
    const { deps, calls } = fakeDeps({ hasImportRole: async () => false });
    await expect(runSubmit(deps, await base())).rejects.toMatchObject({ code: "forbidden" });
    expect(calls).toHaveLength(0);
  });
});

describe("stageRpcError (stage_import errors through the server function)", () => {
  it("passes stage_import's own refusals through unchanged, with DETAIL, so runSubmit can map them", () => {
    const e = stageRpcError({ message: "Repeat file not acknowledged: this exact file was already imported or is waiting for approval", code: "23505", details: '{"source":"batch","id":"b"}' });
    expect(e.message).toMatch(/Repeat file not acknowledged/);
    expect((e as unknown as { details: string }).details).toBe('{"source":"batch","id":"b"}');
    expect(stageRpcError({ message: "Import approval is not configured: no approver is set", code: "55000" }).message).toMatch(/not configured/);
  });
  it("any other database error still gets the friendly message (no table or constraint names)", () => {
    const e = stageRpcError({ message: 'duplicate key value violates unique constraint "customers_pkey"', code: "23505" });
    expect(e.message).toMatch(/^This record already exists\. \(ref [0-9A-F]{8}\)$/);
  });
});
