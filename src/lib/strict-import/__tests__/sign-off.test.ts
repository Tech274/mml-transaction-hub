// SCRUM-131: Bulk Upload "Send {n} rows for sign-off" states. Synthetic data only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SIGN_OFF_IDLE,
  canSendForSignOff,
  signOffAfter,
  signOffAfterThrow,
  signOffButtonLabel,
  signOffCanRetry,
  signOffErrorTitle,
  signOffFootnote,
  submittedDetail,
  submittedTitle,
  type SignOffState,
} from "@/lib/strict-import/sign-off";
import {
  runPreview,
  runSubmit,
  type StageRpcPayload,
  type StrictImportDeps,
} from "@/lib/strict-import/service";

const HEADER =
  "Potential ID,Month,Year,Customer Name,Lab Name,Line of Business,Start Date,End Date,Total Users,Input Cost,Selling Cost,Cloud Provider";
const csv = [
  HEADER,
  "SYN-S-1,3,2026,Acme Test Co,Lab A,VILT,2026-03-01,2026-03-31,5,10,20,OCI",
  "SYN-S-2,3,2026,Acme Test Co,Lab B,VILT,2026-03-01,2026-03-31,5,,20,AWS",
].join("\n");
const bytes = new TextEncoder().encode(csv);

function deps(staged: StageRpcPayload[]): StrictImportDeps {
  return {
    hasImportRole: async () => true,
    listCustomers: async () => [{ customer_name: "Acme Test Co", normalized_name: "acme test co" }],
    priorImport: async () => null,
    callStage: async (payload) => {
      staged.push(payload);
      return {
        stage_id: "00000000-0000-4000-8000-000000000001",
        row_count: payload.p_rows.length,
        rows_sha256: "0".repeat(64),
        expires_at: "2026-10-13T01:20:00Z",
        repeat_of: null,
      };
    },
    loadXlsx: async () => {
      throw new Error("xlsx not used");
    },
  };
}

describe("sign-off button states", () => {
  it("labels for idle, pending and submitted", () => {
    expect(signOffButtonLabel(342, SIGN_OFF_IDLE)).toBe("Send 342 rows for sign-off");
    expect(signOffButtonLabel(1, SIGN_OFF_IDLE)).toBe("Send 1 row for sign-off");
    expect(signOffButtonLabel(342, { status: "pending" })).toBe("Sending for sign-off…");
  });

  it("enabled only when the server allows it and nothing is in flight", () => {
    expect(canSendForSignOff(true, SIGN_OFF_IDLE)).toBe(true);
    expect(canSendForSignOff(false, SIGN_OFF_IDLE)).toBe(false);
    expect(canSendForSignOff(true, { status: "pending" })).toBe(false);
  });

  it("database and network errors can be retried; file errors cannot", () => {
    const err = (code: Extract<SignOffState, { status: "error" }>["code"]): SignOffState => ({
      status: "error",
      code,
      message: "m",
      reasons: [],
    });
    for (const c of ["db_error", "not_configured", "reconcile", "network"] as const) {
      expect(signOffCanRetry(err(c))).toBe(true);
      expect(canSendForSignOff(true, err(c))).toBe(true);
    }
    for (const c of ["file_changed", "blocked", "forbidden", "repeat_file"] as const) {
      expect(signOffCanRetry(err(c))).toBe(false);
      expect(canSendForSignOff(true, err(c))).toBe(false);
    }
    expect(signOffAfterThrow(new Error("Failed to fetch"))).toEqual({
      status: "error",
      code: "network",
      message: "Failed to fetch",
      reasons: [],
    });
  });

  it("server refusal maps to an error state with its reasons", () => {
    const s = signOffAfter({
      ok: false,
      code: "blocked",
      message: "Submit refused",
      reasons: ["Line 3: Cloud Provider is blank."],
    });
    expect(s).toMatchObject({ status: "error", code: "blocked" });
    if (s.status !== "error") throw new Error("expected error");
    expect(signOffErrorTitle(s)).toBe("This file cannot be sent for sign-off");
    expect(s.reasons).toEqual(["Line 3: Cloud Provider is blank."]);
  });

  it("footnote says nothing is saved before sign-off", () => {
    expect(signOffFootnote({ privateCount: 336, publicCount: 6 }, 0)).toBe(
      "All or nothing: after sign-off, 336 Private cloud and 6 Public cloud rows will be saved. Nothing is saved before then.",
    );
    expect(signOffFootnote({ privateCount: 1, publicCount: 0 }, 2)).toBe(
      "All or nothing: any row error stops the whole file.",
    );
  });
});

describe("submitted state from Chris's real runSubmit (fake stage RPC)", () => {
  it("one OCI row + one blank-price AWS row: staged, title and detail from the result", async () => {
    const staged: StageRpcPayload[] = [];
    const d = deps(staged);
    const p = await runPreview(d, { filename: "s.csv", bytes });
    expect(p.canSubmit).toBe(true);
    const result = await runSubmit(d, {
      filename: "s.csv",
      bytes,
      expectedSha256: p.fileSha256,
    });
    const s = signOffAfter({ ok: true, result });
    expect(s.status).toBe("submitted");
    expect(signOffButtonLabel(2, s)).toBe("Sent for sign-off");
    expect(canSendForSignOff(true, s)).toBe(false);
    expect(staged).toHaveLength(1);
    expect(submittedTitle(result)).toBe(
      "2 rows sent for sign-off: 1 Private cloud · 1 Public cloud",
    );
    expect(result.incompleteRows).toBe(1);
    expect(submittedDetail(result, "13 Oct 2026")).toBe(
      `Nothing is saved until an approver signs it off. ${result.correctionCount} Healer fixes sent with it. 1 row will be Incomplete (price missing or 0, or a required field blank). Expires 13 Oct 2026 if nobody signs it off.`,
    );
  });
});

describe("Bulk Upload screen wiring", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../../components/strict-import.tsx"),
    "utf8",
  );
  it("sends for sign-off with submitStrictImport and never calls commitStrictImport", () => {
    expect(src).toMatch(
      /import \{[^}]*\bsubmitStrictImport\b[^}]*\} from "@\/lib\/strict-import\.functions"/,
    );
    expect(src).toContain("useServerFn(submitStrictImport)");
    // Only the header comment may name the old function; no import and no call.
    expect(src).not.toMatch(/import \{[^}]*\bcommitStrictImport\b/);
    expect(src).not.toContain("useServerFn(commitStrictImport)");
    expect(src).toContain("signOffButtonLabel(");
  });
});
