// SCRUM-131: the API-side sign-off rules (src/lib/strict-import/approval.ts) with fake deps.
// The database repeats every check (scrum131-approval-db.test.ts); these prove the API refuses first.
import { describe, expect, it, vi } from "vitest";
import { expiresIn, runApprove, runCancel, runReject, type ApprovalDeps, type ImportStage } from "../approval";

const CHIEF = "chief-id";
const OPS = "ops-id";
const NOW = Date.parse("2026-10-06T06:00:00Z");

function stage(over: Partial<ImportStage> = {}): ImportStage {
  return {
    id: "stage-1",
    status: "pending",
    kind: "mixed",
    filename: "synthetic.csv",
    file_sha256: "a".repeat(64),
    rows_sha256: "b".repeat(64),
    template_version: "2.0.0",
    healer_version: "1.0.0",
    row_count: 342,
    warning_row_count: 248,
    correction_count: 695,
    private_count: 336,
    public_count: 6,
    incomplete_count: 248,
    incomplete_selling: "100.00",
    incomplete_input: "0.00",
    total_users: 1710,
    total_selling: "51750.00",
    total_input: "12740.00",
    summary: {},
    repeat_of: null,
    uploaded_by: OPS,
    uploaded_at: "2026-10-05T06:00:00Z",
    expires_at: "2026-10-12T06:00:00Z",
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    committed_batch_id: null,
    ...over,
  };
}

function deps(over: Partial<ApprovalDeps> = {}, s: ImportStage | null = stage()) {
  const approve = vi.fn(async () => ({
    batch_id: "batch-1",
    inserted: 342,
    kind: "mixed" as const,
    private_rows: 336,
    public_rows: 6,
    total_selling: "51750.00",
    total_input: "12740.00",
  }));
  const reject = vi.fn(async () => undefined);
  const cancel = vi.fn(async () => undefined);
  const d: ApprovalDeps = { userId: CHIEF, isApprover: async () => true, getStage: async () => s, approve, reject, cancel, now: () => NOW, ...over };
  return { d, approve, reject, cancel };
}
const input = { stageId: "stage-1", fileSha256: "a".repeat(64), rowsSha256: "b".repeat(64) };

describe("runApprove", () => {
  it("Chief approves a pending stage: commit result reconciled with the stage", async () => {
    const { d, approve } = deps();
    await expect(runApprove(d, { ...input, reason: "  ok  " })).resolves.toMatchObject({ inserted: 342, privateRows: 336, publicRows: 6, batchId: "batch-1" });
    expect(approve).toHaveBeenCalledWith({ stageId: "stage-1", fileSha256: input.fileSha256, rowsSha256: input.rowsSha256, reason: "ok" });
  });

  it("a non-approver is rejected before anything is called", async () => {
    const { d, approve } = deps({ userId: "lead-id", isApprover: async () => false });
    await expect(runApprove(d, input)).rejects.toMatchObject({ code: "forbidden" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("the uploader cannot approve their own upload (even if they are an approver)", async () => {
    const { d, approve } = deps({ userId: OPS });
    await expect(runApprove(d, input)).rejects.toMatchObject({ code: "self_approval" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("an expired pending stage cannot be approved", async () => {
    const { d, approve } = deps({}, stage({ expires_at: "2026-10-06T05:59:59Z" }));
    await expect(runApprove(d, input)).rejects.toMatchObject({ code: "expired" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("non-pending, missing and changed stages are refused", async () => {
    await expect(runApprove(deps({}, stage({ status: "committed" })).d, input)).rejects.toMatchObject({ code: "not_pending" });
    await expect(runApprove(deps({}, null).d, input)).rejects.toMatchObject({ code: "not_found" });
    await expect(runApprove(deps().d, { ...input, rowsSha256: "c".repeat(64) })).rejects.toMatchObject({ code: "changed" });
  });

  it("a DB error is reported as nothing imported; a different DB result is a loud reconcile error", async () => {
    await expect(runApprove(deps({ approve: async () => Promise.reject(new Error("boom")) }).d, input)).rejects.toMatchObject({ code: "db_error" });
    const off = deps({
      approve: async () => ({ batch_id: "b", inserted: 342, kind: "mixed", private_rows: 342, public_rows: 0, total_selling: "51750.00", total_input: "12740.00" }),
    });
    await expect(runApprove(off.d, input)).rejects.toMatchObject({ code: "reconcile" });
  });
});

describe("runReject / runCancel", () => {
  it("Chief rejects with a reason; non-approvers and the uploader cannot reject", async () => {
    const { d, reject } = deps();
    await runReject(d, { stageId: "stage-1", reason: "Wrong month" });
    expect(reject).toHaveBeenCalledWith({ stageId: "stage-1", reason: "Wrong month" });
    await expect(runReject(deps({ isApprover: async () => false }).d, { stageId: "stage-1" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(runReject(deps({ userId: OPS }).d, { stageId: "stage-1" })).rejects.toMatchObject({ code: "self_approval" });
  });

  it("only the uploader cancels, and only while pending", async () => {
    const own = deps({ userId: OPS });
    await runCancel(own.d, "stage-1");
    expect(own.cancel).toHaveBeenCalledWith("stage-1");
    await expect(runCancel(deps().d, "stage-1")).rejects.toMatchObject({ code: "forbidden" });
    await expect(runCancel(deps({ userId: OPS }, stage({ status: "rejected" })).d, "stage-1")).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("expiresIn", () => {
  it("formats the time left", () => {
    expect(expiresIn("2026-10-13T06:00:00Z", NOW)).toBe("expires in 7d 0h");
    expect(expiresIn("2026-10-06T08:30:00Z", NOW)).toBe("expires in 2h 30m");
    expect(expiresIn("2026-10-06T05:00:00Z", NOW)).toBe("expired");
  });
});
