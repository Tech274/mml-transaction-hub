// SCRUM-131 My uploads: own stages only, cancel only own pending, server fns, gate. Synthetic data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ImportStage } from "@/lib/strict-import/approval";
import {
  EXPIRED_NOTE,
  MY_UPLOADS_QUERY_OPTIONS,
  cancelOutcomeView,
  healerSummaryText,
  myUploadRow,
  myUploadsServer,
  postSubmitLink,
  stageHealerCounts,
  uploaderFlagFrom,
  type ChrisImportApprovalFns,
} from "@/lib/my-uploads";
import {
  authenticatedRouteDecision,
  canSeeMyUploads,
  isWorkspaceNavItemVisible,
} from "@/lib/import-approver-gate";
import { runCancel, type ApprovalDeps } from "@/lib/strict-import/approval";

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const NOW = Date.parse("2026-10-06T02:00:00Z");

/** summary.fixed_by_rule as the contract sends it: all six rules, 0 when unused. */
function byRule(over: Record<string, number> = {}) {
  return {
    "date.reorder_to_iso": 0,
    "customer.match_existing": 0,
    "provider.alias": 0,
    "price.blank_to_zero": 0,
    "price.invalid_to_zero": 0,
    "text.trim": 0,
    ...over,
  };
}

function stage(over: Partial<ImportStage> = {}): ImportStage {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    status: "pending",
    kind: "mixed",
    filename: "synthetic-oct.csv",
    file_sha256: "a".repeat(64),
    rows_sha256: "b".repeat(64),
    template_version: "v3",
    healer_version: "h1",
    row_count: 342,
    warning_row_count: 0,
    correction_count: 695,
    private_count: 336,
    public_count: 6,
    incomplete_count: 12,
    incomplete_selling: 0,
    incomplete_input: 0,
    total_users: 0,
    total_selling: 0,
    total_input: 0,
    summary: {
      fixed_by_rule: byRule({ "date.reorder_to_iso": 684, "customer.match_existing": 11 }),
    },
    repeat_of: null,
    uploaded_by: ME,
    uploaded_at: "2026-10-06T01:20:00Z",
    expires_at: "2026-10-13T01:20:00Z",
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    committed_batch_id: null,
    ...over,
  };
}

function fakeFns(stages: ImportStage[]) {
  // The contract's one shape for every scope: { stages, names, isApprover, userId }.
  const list = vi.fn(async (_: { data: { scope: "mine" } }) => ({
    stages,
    names: {},
    isApprover: false,
    userId: ME,
  }));
  const cancel = vi.fn(async (_: { data: { stageId: string } }) => ({ ok: true as const }));
  const fns: ChrisImportApprovalFns = { listImportStages: list, cancelImport: cancel };
  return { fns, list, cancel };
}

describe("own stages only", () => {
  it("asks Chris's list fn for scope 'mine' and drops anyone else's stage", async () => {
    const { fns, list } = fakeFns([
      stage({ id: "s-mine" }),
      stage({ id: "s-other", uploaded_by: OTHER }),
    ]);
    const res = await myUploadsServer(fns).listOwnStages();
    expect(list).toHaveBeenCalledWith({ data: { scope: "mine" } });
    expect(res.stages.map((s) => s.id)).toEqual(["s-mine"]);
  });
});

describe("cancel: shown only on own pending, calls the server fn", () => {
  it("own + pending → can cancel; own + any other status → cannot", () => {
    expect(myUploadRow(stage(), ME, NOW).canCancel).toBe(true);
    for (const status of ["approved", "committed", "rejected", "expired"] as const) {
      expect(myUploadRow(stage({ status }), ME, NOW).canCancel, status).toBe(false);
    }
  });

  it("someone else's pending stage → cannot cancel", () => {
    expect(myUploadRow(stage({ uploaded_by: OTHER }), ME, NOW).canCancel).toBe(false);
  });

  it("pending but past expiry shows Expired with no cancel, and says what to do", () => {
    const r = myUploadRow(stage({ expires_at: "2026-10-05T00:00:00Z" }), ME, NOW);
    expect(r.status).toBe("expired");
    expect(r.statusLabel).toBe("Expired");
    expect(r.canCancel).toBe(false);
    expect(r.statusNote).toBe(EXPIRED_NOTE);
    expect(r.expiresAt).toBeNull();
  });

  it("the server's 'expired' status (read-only list) shows as Expired with the note", () => {
    const r = myUploadRow(stage({ status: "expired" }), ME, NOW);
    expect([r.status, r.statusLabel, r.canCancel]).toEqual(["expired", "Expired", false]);
    expect(r.statusNote).toMatch(/Upload the file again/);
    expect(myUploadRow(stage(), ME, NOW).statusNote).toBeNull();
  });

  it("cancel goes to cancelImport with the stage id; a server refusal is passed through", async () => {
    const { fns, cancel } = fakeFns([]);
    expect(await myUploadsServer(fns).cancelOwnPending("s-1")).toEqual({ ok: true });
    expect(cancel).toHaveBeenCalledWith({ data: { stageId: "s-1" } });
    const refused: ChrisImportApprovalFns = {
      ...fns,
      cancelImport: async () => ({
        ok: false,
        code: "forbidden",
        message: "Only the uploader can cancel an upload.",
      }),
    };
    expect(await myUploadsServer(refused).cancelOwnPending("s-1")).toEqual({
      ok: false,
      code: "forbidden",
      message: "Only the uploader can cancel an upload.",
    });
  });

  it("cancel results: clear message per contract code; refresh after expired / not_pending", () => {
    const f = "synthetic-oct.csv";
    expect(cancelOutcomeView({ ok: true }, f)).toEqual({
      ok: true,
      message: `Upload cancelled: ${f}`,
      refresh: true,
    });
    const v = (code: string) => cancelOutcomeView({ ok: false, code, message: "server text" }, f);
    expect(v("forbidden")).toEqual({
      ok: false,
      message: "You can only cancel your own uploads.",
      refresh: false,
    });
    expect(v("expired").refresh).toBe(true);
    expect(v("expired").message).toMatch(/already expired, so there is nothing to cancel/);
    expect(v("not_pending").refresh).toBe(true);
    expect(v("not_pending").message).toMatch(/no longer waiting for sign-off/);
    expect(v("db_error")).toEqual({
      ok: false,
      message: "Could not cancel the upload because of a database error. Try again in a moment.",
      refresh: false,
    });
    expect(v("something_new")).toEqual({ ok: false, message: "server text", refresh: false });
  });

  it("the server enforces it: Chris's runCancel refuses another user's or a non-pending stage", async () => {
    const deps = (s: ImportStage): ApprovalDeps => ({
      userId: ME,
      isApprover: async () => false,
      getStage: async () => s,
      approve: async () => {
        throw new Error("never");
      },
      reject: async () => {
        throw new Error("never");
      },
      cancel: vi.fn(async () => {}),
      now: () => NOW,
    });
    await expect(runCancel(deps(stage({ uploaded_by: OTHER })), "s")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(runCancel(deps(stage({ status: "approved" })), "s")).rejects.toMatchObject({
      code: "not_pending",
    });
    const ok = deps(stage());
    await runCancel(ok, "s");
    expect(ok.cancel).toHaveBeenCalledWith("s");
  });
});

describe("row content", () => {
  it("counts, Healer summary, times and batch", () => {
    const r = myUploadRow(stage(), ME, NOW);
    expect([r.rows, r.privateRows, r.publicRows, r.incompleteRows]).toEqual([342, 336, 6, 12]);
    expect(r.healer).toEqual({
      healerFixCount: 695,
      dateFixes: 684,
      nameFixes: 11,
      providerFixes: 0,
      priceFixes: 0,
      textFixes: 0,
    });
    expect(r.healerSummary).toBe("695 fixes: 684 dates · 11 names");
    // SCRUM-131 date fix F1: only an uploader-chosen order shows a note.
    expect(r.dateOrderNote).toBeNull();
    expect(
      myUploadRow(
        stage({ summary: { ...stage().summary, date_order: { order: "mdy_chosen" } } }),
        ME,
        NOW,
      ).dateOrderNote,
    ).toBe("Dates read as MM-DD-YYYY (your choice; nothing in the file proved the order)");
    expect(r.expiresAt).toBe("2026-10-13T01:20:00Z");
    expect(r.batchId).toBeNull();
    const done = myUploadRow(
      stage({
        status: "committed",
        committed_batch_id: "batch-1",
        decided_at: "2026-10-06T03:00:00Z",
      }),
      ME,
      NOW,
    );
    expect(done.batchId).toBe("batch-1");
    expect(done.expiresAt).toBeNull();
    expect(done.statusLabel).toBe("Approved and imported");
  });

  it("price rules add up; all six keys at 0 reads 'No fixes'", () => {
    const c = stageHealerCounts({
      summary: { fixed_by_rule: byRule({ "price.blank_to_zero": 2, "price.invalid_to_zero": 1 }) },
    });
    expect(c.priceFixes).toBe(3);
    expect(c.healerFixCount).toBe(3);
    expect(healerSummaryText(c)).toBe("3 fixes: 3 prices");
    expect(healerSummaryText(stageHealerCounts({ summary: { fixed_by_rule: byRule() } }))).toBe(
      "No fixes",
    );
  });

  it("total = the sum of the six rules (the DB recomputes fixed_by_rule from the corrections)", () => {
    const all = byRule({
      "date.reorder_to_iso": 4,
      "customer.match_existing": 3,
      "provider.alias": 2,
      "price.blank_to_zero": 1,
      "price.invalid_to_zero": 1,
      "text.trim": 5,
    });
    const c = stageHealerCounts({ summary: { fixed_by_rule: all } });
    expect(c).toEqual({
      healerFixCount: 16,
      dateFixes: 4,
      nameFixes: 3,
      providerFixes: 2,
      priceFixes: 2,
      textFixes: 5,
    });
    expect(healerSummaryText(c)).toBe(
      "16 fixes: 4 dates · 3 names · 2 providers · 2 prices · 5 spacing",
    );
    // A missing key or summary reads as 0 (never NaN).
    expect(stageHealerCounts({ summary: {} }).healerFixCount).toBe(0);
  });
});

describe("post-submit link", () => {
  it("approver → the sign-off view; non-approver → My uploads", () => {
    expect(postSubmitLink(true, "s-9")).toEqual({
      to: "/import-approvals/$stageId",
      params: { stageId: "s-9" },
      label: "Open in Import approvals",
    });
    expect(postSubmitLink(false, "s-9")).toEqual({ to: "/my-uploads", label: "Open My uploads" });
  });
});

describe("gate: canSeeMyUploads({ isApprover, uploaderFlag })", () => {
  it("isApprover || uploaderFlag", () => {
    expect(canSeeMyUploads({ isApprover: false, uploaderFlag: false })).toBe(false);
    expect(canSeeMyUploads({ isApprover: true, uploaderFlag: false })).toBe(true);
    expect(canSeeMyUploads({ isApprover: false, uploaderFlag: true })).toBe(true);
  });

  it("uploader flag = getImportApprovalStatus().canUpload (unknown or failed = false)", () => {
    expect(uploaderFlagFrom({ canUpload: true })).toBe(true);
    expect(uploaderFlagFrom({ canUpload: false })).toBe(false);
    expect(uploaderFlagFrom({})).toBe(false);
    expect(uploaderFlagFrom(null)).toBe(false);
    expect(uploaderFlagFrom(undefined)).toBe(false);
  });

  it("route: uploaders (even with leadership) and approvers pass; others are redirected", () => {
    const d = (roles: string[], isApprover: boolean, uploaderFlag: boolean) =>
      authenticatedRouteDecision({
        pathname: "/my-uploads",
        isLeadership: roles.includes("leadership"),
        isAdmin: roles.includes("admin"),
        isApprover,
        uploaderFlag,
      });
    expect(d(["ops_user"], false, true)).toBe("allow");
    expect(d(["leadership", "ops_user"], false, true)).toBe("allow");
    expect(d(["leadership"], true, false)).toBe("allow");
    expect(d(["viewer"], false, false)).toBe("redirect-dashboard");
    expect(d(["leadership"], false, false)).toBe("redirect-dashboard");
  });
});

describe("no poll on My uploads; no expiry write on any status path", () => {
  it("query options: no interval, no focus/reconnect refetch", () => {
    expect(MY_UPLOADS_QUERY_OPTIONS.refetchInterval).toBe(false);
    expect(MY_UPLOADS_QUERY_OPTIONS.refetchOnWindowFocus).toBe(false);
    expect(MY_UPLOADS_QUERY_OPTIONS.refetchOnReconnect).toBe(false);
  });

  it("route guard reads the status (canUpload via uploaderFlagFrom) only on gated paths", () => {
    const route = readFileSync(
      path.resolve(__dirname, "../../routes/_authenticated/route.tsx"),
      "utf8",
    );
    expect(route).toContain(
      "const gated = isImportApprovalsPath(pathname) || isMyUploadsPath(pathname);",
    );
    expect(route).toContain("const uploaderFlag = uploaderFlagFrom(status);");
    expect(route).not.toContain("expire_import_stages");
  });
});

describe("My uploads page (source guards)", () => {
  const page = readFileSync(
    path.resolve(__dirname, "../../routes/_authenticated/my-uploads.tsx"),
    "utf8",
  );

  it("reads through the adapter over Chris's list and cancel fns only", () => {
    expect(page).toContain('createFileRoute("/_authenticated/my-uploads")');
    expect(page).toContain("myUploadsServer({ listImportStages: list, cancelImport: cancel })");
    expect(page).not.toMatch(/approveImport|rejectImport|rpc\(\s*"expire_import_stages"/);
    expect(page).not.toMatch(/to="\/import-approvals/);
  });

  it("Cancel only where the row allows it, behind a confirm dialog", () => {
    expect(page).toMatch(/\{r\.canCancel && \(/);
    expect(page).toContain("server.cancelOwnPending(row.id)");
    expect(page).toContain("Cancel this upload?");
  });

  it("no poll: query uses MY_UPLOADS_QUERY_OPTIONS, refresh is manual", () => {
    expect(page).toContain("...MY_UPLOADS_QUERY_OPTIONS");
    expect(page).not.toMatch(/refetchInterval|refetchOnWindowFocus: true/);
    expect(page).toContain("q.refetch()");
  });

  it("cancel results go through cancelOutcomeView; refresh invalidates the list and the status", () => {
    expect(page).toContain(
      "const view = cancelOutcomeView(await server.cancelOwnPending(row.id), row.filename);",
    );
    expect(page).toContain("if (view.refresh) {");
    expect(page).toContain("queryKey: IMPORT_APPROVAL_STATUS_QUERY_KEY");
    expect(page).toContain("{r.statusNote && (");
  });

  it("loading, error and empty states use the plan's table-row texts", () => {
    expect(page).toContain("Loading uploads…");
    expect(page).toContain("Could not load uploads:");
    expect(page).toContain("Retry");
    expect(page).toContain("No uploads yet.");
    expect(page).toContain('className="py-8 text-center text-sm text-muted-foreground"');
    expect(page).toContain('<AppShell title="My uploads">');
  });
});

describe("nav visibility: My uploads and Import approvals", () => {
  const MY = { to: "/my-uploads", roles: null, gate: "my-uploads" as const };
  const IA = { to: "/import-approvals", roles: null, gate: "import-approver" as const };
  // canUpload comes from getImportApprovalStatus(); roles no longer decide these two items.
  const sees = (
    item: typeof MY | typeof IA,
    roles: string[],
    isApprover: boolean,
    canUpload: boolean,
  ) => isWorkspaceNavItemVisible(item, { roles, can: () => true, isApprover, canUpload });

  it("canUpload sees My uploads but not Import approvals unless on the list", () => {
    for (const r of ["admin", "ops_lead", "ops_user"]) {
      expect(sees(MY, [r], false, true), r).toBe(true);
      expect(sees(IA, [r], false, true), r).toBe(false);
    }
  });

  it("an uploader with leadership too still sees My uploads", () => {
    expect(sees(MY, ["leadership", "ops_user"], false, true)).toBe(true);
  });

  it("a leadership-only approver sees both; nobody without isApprover or canUpload sees either", () => {
    expect(sees(MY, ["leadership"], true, false)).toBe(true);
    expect(sees(IA, ["leadership"], true, false)).toBe(true);
    for (const r of ["viewer", "finance", "leadership", "ops_user"]) {
      expect(sees(MY, [r], false, false), r).toBe(false);
      expect(sees(IA, [r], false, false), r).toBe(false);
    }
  });
});

describe("Bulk Upload confirmation link", () => {
  const src = readFileSync(path.resolve(__dirname, "../../components/strict-import.tsx"), "utf8");
  it("uses postSubmitLink with the shared isApprover (QC P-S1: non-approvers go to My uploads)", () => {
    expect(src).toContain("const { isApprover } = useImportApprovalStatus(true);");
    expect(src).toContain("postSubmitLink(isApprover, submitted.stageId)");
    expect(src).toContain('<Link to="/my-uploads">');
    // The only route to the sign-off view is postSubmitLink's approver branch.
    expect(src).not.toContain('to="/import-approvals/$stageId"');
  });
});
