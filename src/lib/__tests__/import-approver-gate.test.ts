// SCRUM-131 (John's QC): Import approvals nav + route follow the approver list, not role.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authenticatedRouteDecision,
  canSeeImportApprovals,
  isImportApprovalsPath,
  isWorkspaceNavItemVisible,
  type WorkspaceNavItemRule,
} from "@/lib/import-approver-gate";

const IMPORT_APPROVALS: WorkspaceNavItemRule = {
  to: "/import-approvals",
  roles: null,
  gate: "import-approver",
};
const STAGE = "/import-approvals/00000000-0000-4000-8000-000000000001";
const canAll = () => true;

function navSees(roles: string[], isApprover: boolean) {
  return isWorkspaceNavItemVisible(IMPORT_APPROVALS, {
    roles,
    can: canAll,
    isApprover,
    canUpload: false,
  });
}
function routeFor(pathname: string, roles: string[], isApprover: boolean) {
  return authenticatedRouteDecision({
    pathname,
    isLeadership: roles.includes("leadership"),
    isAdmin: roles.includes("admin"),
    isApprover,
  });
}

describe("Import approvals follows the approver list, whatever the role", () => {
  it("leadership-only and on the list: sees the nav item and passes the guard (list and drill-down)", () => {
    expect(navSees(["leadership"], true)).toBe(true);
    expect(routeFor("/import-approvals", ["leadership"], true)).toBe("allow");
    expect(routeFor("/import-approvals/", ["leadership"], true)).toBe("allow");
    expect(routeFor(STAGE, ["leadership"], true)).toBe("allow");
  });

  it("admin NOT on the list: no nav item, guard redirects (list and drill-down)", () => {
    expect(navSees(["admin"], false)).toBe(false);
    expect(routeFor("/import-approvals", ["admin"], false)).toBe("redirect-dashboard");
    expect(routeFor(STAGE, ["admin"], false)).toBe("redirect-dashboard");
  });

  it.each([
    ["admin"],
    ["finance"],
    ["ops_lead"],
    ["ops_user"],
    ["viewer"],
    ["admin", "leadership"],
  ])("on the list with role %s: sees it and passes", (...roles) => {
    expect(navSees(roles, true)).toBe(true);
    expect(routeFor("/import-approvals", roles, true)).toBe("allow");
    expect(routeFor(STAGE, roles, true)).toBe("allow");
  });

  it.each([["leadership"], ["finance"], ["ops_lead"], ["ops_user"], ["viewer"], []])(
    "not on the list with role %s: hidden and redirected",
    (...roles) => {
      expect(navSees(roles, false)).toBe(false);
      expect(routeFor(STAGE, roles, false)).toBe("redirect-dashboard");
    },
  );

  it("unknown membership counts as not on the list", () => {
    expect(
      authenticatedRouteDecision({ pathname: STAGE, isLeadership: false, isAdmin: true }),
    ).toBe("redirect-dashboard");
    expect(canSeeImportApprovals(false)).toBe(false);
  });
});

describe("everything else is unchanged", () => {
  it("leadership-only still sees only the Dashboard among the other Workspace items", () => {
    const ctx = { roles: ["leadership"], can: canAll, isApprover: true, canUpload: false };
    expect(isWorkspaceNavItemVisible({ to: "/dashboard", roles: null }, ctx)).toBe(true);
    expect(isWorkspaceNavItemVisible({ to: "/transactions", roles: null }, ctx)).toBe(false);
    expect(routeFor("/transactions", ["leadership"], true)).toBe("redirect-dashboard");
    expect(routeFor("/customers", ["leadership"], false)).toBe("allow");
    expect(routeFor("/transactions", ["leadership", "admin"], false)).toBe("allow");
  });

  it("role and permission rules still apply to other items", () => {
    const entry = {
      to: "/entry",
      roles: ["admin", "ops_lead", "ops_user"],
      permission: "feature_master_adr_entry",
    };
    expect(
      isWorkspaceNavItemVisible(entry, {
        roles: ["viewer"],
        can: canAll,
        isApprover: true,
        canUpload: false,
      }),
    ).toBe(false);
    expect(
      isWorkspaceNavItemVisible(entry, {
        roles: ["ops_user"],
        can: () => false,
        isApprover: false,
        canUpload: true,
      }),
    ).toBe(false);
    expect(
      isWorkspaceNavItemVisible(entry, {
        roles: ["ops_user"],
        can: canAll,
        isApprover: false,
        canUpload: true,
      }),
    ).toBe(true);
  });

  it("only Import approvals paths are gated; a look-alike path is not", () => {
    expect(isImportApprovalsPath(STAGE)).toBe(true);
    expect(isImportApprovalsPath("/import-approvals-old")).toBe(false);
    expect(routeFor("/import-approvals-old", ["viewer"], false)).toBe("allow");
  });
});

describe("wiring: nav and route use the same membership source", () => {
  const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");
  const route = read("routes/_authenticated/route.tsx");
  const sidebar = read("components/app-sidebar.tsx");
  // Chris's isImportApprover (269b9f9): the RPC call moved out of import-approvals.functions.ts.
  const queries = read("lib/strict-import/approval-queries.ts");

  it("route guard reads the same status query as the sidebar and decides with the helper", () => {
    // Membership is still Chris's is_import_approver, behind import_approval_status().
    expect(queries).toMatch(/rpc<boolean>\("is_import_approver", \{ p_uid: userId \}\)/);
    expect(route).toContain(
      "context.queryClient\n          .fetchQuery(importApprovalStatusQueryOptions(fetchImportApprovalStatus))",
    );
    expect(route).toContain("const uploaderFlag = uploaderFlagFrom(status);");
    expect(route).toContain("authenticatedRouteDecision(");
    // No separate membership or role RPC for these paths any more.
    expect(route).not.toContain('"is_import_approver"');
    expect(route).not.toContain("UPLOADER_ROLES");
  });

  // SCRUM-128 C3: the nav items and the visibility filter moved from app-sidebar.tsx to lib/nav.ts
  // (visibleNavGroups -> itemVisible -> isWorkspaceNavItemVisible); the sidebar renders them.
  const nav = read("lib/nav.ts");

  it("sidebar asks for every signed-in user (no leadership exclusion) and filters with the helper", () => {
    expect(sidebar).toContain("useImportApprovalNav(Boolean(user))");
    expect(sidebar).toContain("visibleNavGroups(");
    expect(sidebar).toContain("isImportApprover: importApproval.isApprover");
    expect(sidebar).toContain("canUpload: importApproval.canUpload");
    expect(nav).toContain("isWorkspaceNavItemVisible(item,");
    expect(nav).toContain("canUpload: access.canUpload");
    expect(nav).toContain('gate: "import-approver"');
    expect(nav).toContain('gate: "my-uploads"');
    expect(nav).toContain('badge: "pending-imports"');
  });
});
