// SCRUM-131: the UI on Chris's approval contract (SCRUM-131-PR.md "Approval, status and My uploads").
//   - status: getImportApprovalStatus() -> { isApprover, canUpload, pendingCount, unreadNotifications },
//     one read-only query shared by the sidebar badge (polled), the nav gates and the route guard;
//   - expire_import_stages is never on a poll;
//   - repeat file: "Submit anyway (repeat of …)" with acknowledgeRepeatFile when canAcknowledge;
//   - Chris's approve dialog restates the repeat and needs a tick (confirmed, not changed).
// Synthetic data only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMPORT_APPROVAL_STATUS_POLL_MS,
  IMPORT_APPROVAL_STATUS_QUERY_KEY,
  NO_IMPORT_APPROVAL_STATUS,
  importApprovalStatusFrom,
  importApprovalStatusQueryOptions,
} from "@/lib/import-approval-status";
import { authenticatedRouteDecision, isWorkspaceNavItemVisible } from "@/lib/import-approver-gate";
import { uploaderFlagFrom } from "@/lib/my-uploads";
import {
  SIGN_OFF_IDLE,
  canSendForSignOff,
  canSubmitAnyway,
  repeatFileAction,
  repeatOfLabel,
  signOffAfter,
  submittedDetail,
} from "@/lib/strict-import/sign-off";

const SRC = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

/** The text of `export … function name(` / `export const name =` up to the next top-level doc
 *  comment or export (so the next function's comment is not included). */
function exportBlock(src: string, name: string): string {
  const at = src.search(new RegExp(`export (async function|function|const) ${name}\\b`));
  expect(at, name).toBeGreaterThanOrEqual(0);
  const ends = ["\nexport ", "\n/**", "\n// "]
    .map((m) => src.indexOf(m, at + 1))
    .filter((i) => i > 0);
  return src.slice(at, ends.length ? Math.min(...ends) : undefined);
}

/** Source without comments (guards check code, not the comments that explain it). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Files with a query that polls: a refetchInterval whose value is not `false`. */
function polls(src: string): boolean {
  return [...src.matchAll(/refetchInterval:\s*([^,\n]+)/g)].some((m) => m[1].trim() !== "false");
}

describe("status: one read-only query for badge, nav and route", () => {
  it("normalises the contract fields; anything missing or failed is 'no' and 0", () => {
    expect(
      importApprovalStatusFrom({
        isApprover: true,
        canUpload: true,
        pendingCount: 3,
        unreadNotifications: 2,
      }),
    ).toEqual({ isApprover: true, canUpload: true, pendingCount: 3, unreadNotifications: 2 });
    expect(importApprovalStatusFrom(null)).toEqual(NO_IMPORT_APPROVAL_STATUS);
    expect(importApprovalStatusFrom({ pendingCount: -1, unreadNotifications: Number.NaN })).toEqual(
      NO_IMPORT_APPROVAL_STATUS,
    );
  });

  it("query options: the shared key, a 60 s badge poll only while the tab is visible, no retries", async () => {
    const opts = importApprovalStatusQueryOptions(async () => ({
      isApprover: true,
      pendingCount: 4,
    }));
    expect(opts.queryKey).toEqual(IMPORT_APPROVAL_STATUS_QUERY_KEY);
    expect(opts.refetchInterval).toBe(IMPORT_APPROVAL_STATUS_POLL_MS);
    expect(IMPORT_APPROVAL_STATUS_POLL_MS).toBe(60_000);
    expect(opts.refetchIntervalInBackground).toBe(false);
    expect(opts.retry).toBe(false);
    expect(await opts.queryFn()).toEqual({
      isApprover: true,
      canUpload: false,
      pendingCount: 4,
      unreadNotifications: 0,
    });
  });

  it("sidebar hook, route guard and Bulk Upload all read the same options (one cache entry)", () => {
    const hook = read("lib/import-approval-status.ts");
    expect(hook).toContain(
      "useQuery({ ...importApprovalStatusQueryOptions(() => status()), enabled })",
    );
    const route = read("routes/_authenticated/route.tsx");
    expect(route).toContain("importApprovalStatusQueryOptions(fetchImportApprovalStatus)");
    expect(route).toContain(".catch(() => NO_IMPORT_APPROVAL_STATUS)");
    expect(read("components/app-sidebar.tsx")).toContain("useImportApprovalStatus(enabled)");
    expect(read("components/strict-import.tsx")).toContain("useImportApprovalStatus(true)");
  });

  it("badge shows pendingCount and is hidden at 0", () => {
    const sidebar = read("components/app-sidebar.tsx");
    // SCRUM-128 C3: the sidebar renders lib/nav.ts NAV_GROUPS with one NavGroupBlock, so the
    // count comes from one badgeCount() passed to every group instead of three pendingImports props.
    expect(sidebar).toContain('badge === "pending-imports" ? importApproval.pendingCount : 0');
    expect(sidebar).toContain("{count > 0 && showLabels && (");
    expect(sidebar.match(/badgeCount=\{badgeCount\}/g)?.length).toBe(1);
  });

  it("gates: Import approvals = isApprover; My uploads = isApprover || canUpload (nav and route agree)", () => {
    const MY = { to: "/my-uploads", roles: null, gate: "my-uploads" as const };
    const IA = { to: "/import-approvals", roles: null, gate: "import-approver" as const };
    for (const isApprover of [false, true]) {
      for (const canUpload of [false, true]) {
        const status = importApprovalStatusFrom({ isApprover, canUpload });
        const ctx = { roles: ["viewer"], can: () => true, ...status };
        const route = (pathname: string) =>
          authenticatedRouteDecision({
            pathname,
            isLeadership: false,
            isAdmin: false,
            isApprover: status.isApprover,
            uploaderFlag: uploaderFlagFrom(status),
          }) === "allow";
        expect(isWorkspaceNavItemVisible(IA, ctx)).toBe(isApprover);
        expect(route("/import-approvals")).toBe(isApprover);
        expect(isWorkspaceNavItemVisible(MY, ctx)).toBe(isApprover || canUpload);
        expect(route("/my-uploads")).toBe(isApprover || canUpload);
      }
    }
  });
});

describe("expire_import_stages is never on a poll", () => {
  const queries = read("lib/strict-import/approval-queries.ts");
  const fns = read("lib/import-approvals.functions.ts");

  it("the status path (server fn -> readImportApprovalStatus -> import_approval_status) never expires", () => {
    const handler = exportBlock(fns, "getImportApprovalStatus");
    expect(handler).toContain("readImportApprovalStatus(");
    expect(code(handler)).not.toMatch(/expire|listApprovalQueue|getApprovalStageDetail/);
    const reader = exportBlock(queries, "readImportApprovalStatus");
    expect(reader).toContain('"import_approval_status"');
    expect(code(reader)).not.toMatch(/expire/);
    // The "mine" list (My uploads) is read-only too.
    expect(code(exportBlock(queries, "listOwnStagesForMine"))).not.toMatch(/expire/);
  });

  it("every polled query in the UI stays off the expiring reads", () => {
    const polled = walk(SRC).filter((f) => polls(readFileSync(f, "utf8")));
    expect(polled.map((f) => path.relative(SRC, f)).sort()).toEqual(
      [
        // SCRUM-128 C2 deleted the dead components/bulk-import.tsx (plan P04), so it is no longer here.
        "lib/import-approval-status.ts",
        "routes/_authenticated/ai-command-center.inbox.tsx",
      ].sort(),
    );
    for (const f of polled) {
      const src = code(readFileSync(f, "utf8"));
      // listImportStages pending/recent and getImportStage run the lazy expiry on page open.
      expect(src, f).not.toMatch(/expire_import_stages|listImportStages|getImportStage\b/);
    }
  });
});

describe("repeat file: Submit anyway (repeat of …) with acknowledgeRepeatFile", () => {
  const repeat = (canAcknowledge: boolean, source: "batch" | "stage" = "batch") =>
    signOffAfter({
      ok: false,
      code: "repeat_file",
      message: "This file was already imported.",
      reasons: ["This file was already imported."],
      repeatOf: {
        source,
        id: "1a2b3c4d-0000-4000-8000-000000000001",
        at: "2026-10-05T10:00:00Z",
      },
      canAcknowledge,
    });

  it("canAcknowledge true: the button names the earlier batch; the normal button stays final", () => {
    const state = repeat(true);
    expect(state).toMatchObject({
      status: "error",
      code: "repeat_file",
      repeat: { canAcknowledge: true },
    });
    expect(repeatFileAction(state)).toEqual({
      kind: "acknowledge",
      label: "Submit anyway (repeat of batch 1a2b3c4d)",
      note: "Only if this is not a double upload. The approver sees that you confirmed the repeat.",
    });
    expect(canSubmitAnyway(true, state)).toBe(true);
    expect(canSubmitAnyway(false, state)).toBe(false);
    expect(canSendForSignOff(true, state)).toBe(false);
  });

  it("a repeat of an upload still waiting names the upload", () => {
    expect(repeatFileAction(repeat(true, "stage"))).toMatchObject({
      label: "Submit anyway (repeat of upload 1a2b3c4d)",
    });
    expect(repeatOfLabel(null)).toBe("an earlier upload");
  });

  it("canAcknowledge false (policy 'block'): no button; a new file is needed", () => {
    const state = repeat(false);
    expect(repeatFileAction(state)).toEqual({
      kind: "new_file",
      message:
        "This file repeats batch 1a2b3c4d and repeats are blocked. A new file is needed: fix the file or upload a different one.",
    });
    expect(canSubmitAnyway(true, state)).toBe(false);
  });

  it("no repeat details means no acknowledge; other errors and states offer nothing", () => {
    const bare = signOffAfter({ ok: false, code: "repeat_file", message: "m", reasons: [] });
    expect(repeatFileAction(bare)).toMatchObject({ kind: "new_file" });
    expect(
      repeatFileAction(signOffAfter({ ok: false, code: "db_error", message: "m", reasons: [] })),
    ).toBeNull();
    expect(repeatFileAction(SIGN_OFF_IDLE)).toBeNull();
  });

  it("the confirmation says when the repeat was acknowledged", () => {
    const base = { incompleteRows: 0, correctionCount: 0 };
    expect(submittedDetail({ ...base, repeatAcknowledged: true }, "13 Oct")).toContain(
      "Sent as a repeat file you confirmed; the approver sees that.",
    );
    expect(submittedDetail({ ...base, repeatAcknowledged: false }, "13 Oct")).not.toContain(
      "repeat",
    );
  });

  it("the Bulk Upload screen re-sends with acknowledgeRepeatFile: true from the Submit anyway button", () => {
    const src = read("components/strict-import.tsx");
    expect(src).toContain("async function onSendForSignOff(acknowledgeRepeatFile = false)");
    expect(src).toContain("...(acknowledgeRepeatFile ? { acknowledgeRepeatFile: true } : {})");
    expect(src).toContain("onClick={() => void onSendForSignOff(true)}");
    expect(src).toContain('data-testid="submit-anyway"');
    expect(src).toContain('data-testid="repeat-new-file"');
    expect(src).toContain("disabled={!canAcknowledgeRepeat || busy}");
  });
});

describe("approve dialog (Chris's file, QC S4): restates the repeat and needs a tick", () => {
  it("confirmed in import-approvals.$stageId.tsx (not changed here)", () => {
    const page = read("routes/_authenticated/import-approvals.$stageId.tsx");
    expect(page).toContain('{dialog === "approve" && repeat && (');
    expect(page).toContain("I have checked this is not a double upload.");
    expect(page).toContain('disabled={busy || (dialog === "approve" && !!repeat && !repeatAck)}');
    expect(page).toContain("setRepeatAck(false);");
  });
});
