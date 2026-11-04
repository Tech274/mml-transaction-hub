// SCRUM-131 (John's QC, 6 Oct): "Import approvals" (nav item AND the /import-approvals routes,
// including /import-approvals/$stageId) is for anyone on the import approver list, whatever
// their role. A leadership-only approver (Chief) sees it and passes the guard; an admin who is
// not on the list does not.
//
// Source = Chris's read-only status, getImportApprovalStatus() -> { isApprover, canUpload, ... }
// (one STABLE RPC, import_approval_status(); isApprover = is_import_approver, the approver list).
// The sidebar (useImportApprovalStatus) and the route guard (routes/_authenticated/route.tsx) read
// the same cached query, so nav and guard always agree. Everything here takes those booleans.
import { canLeadershipOpenRoute, isLeadershipOnlyRoleSet } from "@/lib/leadership-access";
import { isMyUploadsPath, uploaderFlagFrom } from "@/lib/my-uploads";

export const IMPORT_APPROVALS_PATH = "/import-approvals";

/** /import-approvals, /import-approvals/ and /import-approvals/<stage id>. */
export function isImportApprovalsPath(pathname: string): boolean {
  return pathname === IMPORT_APPROVALS_PATH || pathname.startsWith(`${IMPORT_APPROVALS_PATH}/`);
}

/** Nav item "Import approvals": shown only to approvers. Role plays no part. */
export function canSeeImportApprovals(isApprover: boolean): boolean {
  return isApprover === true;
}

/**
 * My uploads (SCRUM-131, John's Option 2): approvers or uploaders, whatever else their role.
 * uploaderFlag = uploaderFlagFrom(status) = getImportApprovalStatus().canUpload (lib/my-uploads.ts).
 */
export function canSeeMyUploads(input: { isApprover: boolean; uploaderFlag: boolean }): boolean {
  return input.isApprover === true || input.uploaderFlag === true;
}

export type AuthenticatedRouteDecision = "allow" | "redirect-dashboard";

/**
 * The /_authenticated route guard's decision.
 * - Import approvals paths: allowed only for approvers, any role (an unknown membership is "not
 *   on the list").
 * - Every other path: the existing leadership-only rule, unchanged.
 */
export function authenticatedRouteDecision(input: {
  pathname: string;
  isLeadership: boolean;
  isAdmin: boolean;
  /** is_import_approver(auth.uid()); only needed for Import approvals and My uploads paths. */
  isApprover?: boolean;
  /** uploaderFlagFrom(status) (= canUpload); only needed for My uploads paths. */
  uploaderFlag?: boolean;
}): AuthenticatedRouteDecision {
  if (isImportApprovalsPath(input.pathname)) {
    return canSeeImportApprovals(input.isApprover === true) ? "allow" : "redirect-dashboard";
  }
  // My uploads: no leadership-only block; approvers or uploaders only.
  if (isMyUploadsPath(input.pathname)) {
    return canSeeMyUploads({
      isApprover: input.isApprover === true,
      uploaderFlag: input.uploaderFlag === true,
    })
      ? "allow"
      : "redirect-dashboard";
  }
  if (input.isLeadership && !input.isAdmin && !canLeadershipOpenRoute(input.pathname)) {
    return "redirect-dashboard";
  }
  return "allow";
}

export interface WorkspaceNavItemRule {
  to: string;
  roles: readonly string[] | null;
  permission?: string;
  gate?: "import-approver" | "my-uploads";
}

/**
 * Workspace nav visibility (app-sidebar). Role and permission rules are unchanged; the
 * Import approvals item (gate "import-approver") follows the approver list only, and is the one
 * item a leadership-only user sees besides the Dashboard.
 */
export function isWorkspaceNavItemVisible(
  item: WorkspaceNavItemRule,
  ctx: {
    roles: readonly string[];
    can: (permission: string) => boolean;
    isApprover: boolean;
    /** getImportApprovalStatus().canUpload */
    canUpload: boolean;
  },
): boolean {
  if (item.gate === "import-approver") return canSeeImportApprovals(ctx.isApprover);
  if (item.gate === "my-uploads") {
    return canSeeMyUploads({
      isApprover: ctx.isApprover,
      uploaderFlag: uploaderFlagFrom({ canUpload: ctx.canUpload }),
    });
  }
  const roleOk = !item.roles || item.roles.some((r) => ctx.roles.includes(r));
  const permissionOk = !item.permission || ctx.can(item.permission);
  if (!roleOk || !permissionOk) return false;
  return !isLeadershipOnlyRoleSet(ctx.roles) || item.to === "/dashboard";
}
