import { describe, it, expect, vi } from "vitest";
import { runCommit, runPreview, StrictImportError, type ImportRpcPayload, type StrictImportDeps } from "../service";
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
  const calls: ImportRpcPayload[] = [];
  const deps: StrictImportDeps = {
    hasImportRole: async () => true,
    findCustomers: async () => [{ customer_name: "Acme Test Co", normalized_name: "acme test co" }],
    priorImport: async () => null,
    callImport: async (p) => {
      calls.push(p);
      const sell = p.p_rows.reduce((a, r) => a + Math.round(Number(r.selling_cost) * 100), 0);
      const inp = p.p_rows.reduce((a, r) => a + Math.round(Number(r.input_cost) * 100), 0);
      return { batch_id: "00000000-0000-4000-8000-000000000001", inserted: p.p_rows.length, total_selling: sell / 100, total_input: inp / 100 };
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

describe("runCommit", () => {
  const base = async () => ({ filename: "f.csv", bytes: GOOD, expectedSha256: await sha256Hex(GOOD), importAnyway: false });

  it("commits one row per input row through the database function", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runCommit(deps, await base());
    expect(r).toMatchObject({ inserted: 3, totalSellingCents: 330100, totalInputCents: 220025 });
    expect(calls).toHaveLength(1);
    expect(calls[0].p_rows.map((x) => x.source_line)).toEqual([2, 3, 4]);
    expect(calls[0].p_customer_names).toEqual(["Beta Test Ltd"]);
    expect(calls[0].p_kind).toBe("public_cloud");
  });
  it("refuses a file that differs from the previewed one", async () => {
    const { deps, calls } = fakeDeps();
    await expect(runCommit(deps, { ...(await base()), expectedSha256: "0".repeat(64) })).rejects.toMatchObject({ code: "file_changed" });
    expect(calls).toHaveLength(0);
  });
  it("re-validates on the server: a blank cost is stored null and still committed", async () => {
    const blankCost = csv(line("PID-TEST-003", "Acme Test Co", "", "100"));
    const { deps, calls } = fakeDeps();
    const r = await runCommit(deps, { filename: "f.csv", bytes: blankCost, expectedSha256: await sha256Hex(blankCost), importAnyway: false });
    expect(r.inserted).toBe(1);
    expect(calls[0].p_rows[0].input_cost).toBeNull();
    expect(calls[0].p_rows[0].selling_cost).toBe("100.00");
  });
  it("an unknown provider does not block the commit", async () => {
    const header = HEADER.join(",");
    const body = ["PID-TEST-003", "3", "2026", "Acme Test Co", "Synthetic Lab A", "VILT", "2026-03-01", "2026-03-31", "10", "100", "150", "OpenAI"].join(",");
    const bytes = new TextEncoder().encode(`${header}\n${body}\n`);
    const { deps, calls } = fakeDeps();
    const r = await runCommit(deps, { filename: "f.csv", bytes, expectedSha256: await sha256Hex(bytes), importAnyway: false });
    expect(r.inserted).toBe(1);
    expect(calls[0].p_rows[0].cloud_provider).toBeNull();
  });
  it("an unknown extra column still never reaches the database", async () => {
    const bad = new TextEncoder().encode(`${HEADER.join(",")},Notes\n${line("PID-TEST-003", "Acme Test Co", "1", "2")},x\n`);
    const { deps, calls } = fakeDeps();
    const err = await runCommit(deps, { filename: "f.csv", bytes: bad, expectedSha256: await sha256Hex(bad), importAnyway: false }).catch((e) => e);
    expect(err).toBeInstanceOf(StrictImportError);
    expect(err.code).toBe("blocked");
    expect(calls).toHaveLength(0);
  });
  it("creates new customers without an approval step", async () => {
    const { deps, calls } = fakeDeps();
    const r = await runCommit(deps, await base());
    expect(r.inserted).toBe(3);
    expect(calls[0].p_customer_names).toEqual(["Beta Test Ltd"]);
  });
  it("refuses a repeated file until Import anyway, then inserts another batch", async () => {
    const prior = { id: "00000000-0000-4000-8000-000000000099", importedOn: "2026-09-01" };
    const { deps, calls } = fakeDeps({ priorImport: async () => prior });
    const preview = await runPreview(deps, { filename: "f.csv", bytes: GOOD });
    expect(preview.priorImport).toEqual(prior);
    expect(preview.blockers).toEqual([]);
    const refused = await runCommit(deps, await base()).catch((e) => e);
    expect(refused).toMatchObject({
      code: "blocked",
      reasons: ["This exact file was already imported on 2026-09-01 (batch 00000000-0000-4000-8000-000000000099)"],
    });
    expect(calls).toHaveLength(0);
    const r = await runCommit(deps, { ...(await base()), importAnyway: true });
    expect(r.inserted).toBe(3);
    expect(calls).toHaveLength(1);
  });
  it("database errors are reported as 'nothing was saved'", async () => {
    const { deps } = fakeDeps({ callImport: vi.fn(async () => { throw new Error("duplicate key value violates unique constraint"); }) });
    await expect(runCommit(deps, await base())).rejects.toMatchObject({ code: "db_error", message: expect.stringMatching(/nothing was saved/) });
  });
  it("a reconciliation mismatch is surfaced loudly", async () => {
    const { deps } = fakeDeps({ callImport: async () => ({ batch_id: "b", inserted: 2, total_selling: "3301.00", total_input: "2200.25" }) });
    await expect(runCommit(deps, await base())).rejects.toMatchObject({ code: "reconcile" });
  });
});
