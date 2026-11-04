import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { getCaptureRole } from "@/lib/capture-persona";
import { canLeadershipOpenRoute } from "@/lib/leadership-access";
import { authenticatedRouteDecision, isImportApprovalsPath } from "@/lib/import-approver-gate";
import {
  fetchImportApprovalStatus,
  importApprovalStatusQueryOptions,
  NO_IMPORT_APPROVAL_STATUS,
} from "@/lib/import-approval-status";
import { isMyUploadsPath, uploaderFlagFrom } from "@/lib/my-uploads";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const pathname = location.pathname;
    if (isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient())) {
      const captureRole = getCaptureRole(
        getSuperadminCaptureModeEnvForClient(),
        location.searchStr,
      );
      if (captureRole === "leadership" && !canLeadershipOpenRoute(pathname)) {
        throw redirect({ to: "/dashboard" });
      }
      // Capture mode has no real user, so membership cannot be shown: no Import approvals / My uploads.
      if (isImportApprovalsPath(pathname) || isMyUploadsPath(pathname)) {
        throw redirect({ to: "/dashboard" });
      }
      return { user: null };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { next: "" } });
    const userId = data.user.id;
    const [{ data: isAdmin }, { data: isLeadership }] = await Promise.all([
      supabase.rpc("has_any_role", { _user_id: userId, _roles: ["admin"] }),
      supabase.rpc("has_any_role", { _user_id: userId, _roles: ["leadership"] }),
    ]);
    // SCRUM-131: Import approvals = isApprover (the approver list, any role); My uploads =
    // isApprover || canUpload. Both from getImportApprovalStatus(), the same read-only status query
    // (and cache entry) the sidebar uses. Asked only on those paths; a failed read counts as "no".
    const gated = isImportApprovalsPath(pathname) || isMyUploadsPath(pathname);
    const status = gated
      ? await context.queryClient
          .fetchQuery(importApprovalStatusQueryOptions(fetchImportApprovalStatus))
          .catch(() => NO_IMPORT_APPROVAL_STATUS)
      : NO_IMPORT_APPROVAL_STATUS;
    const isApprover = status.isApprover;
    const uploaderFlag = uploaderFlagFrom(status);
    const decision = authenticatedRouteDecision({
      pathname,
      isLeadership: isLeadership === true,
      isAdmin: isAdmin === true,
      isApprover,
      uploaderFlag,
    });
    if (decision === "redirect-dashboard") throw redirect({ to: "/dashboard" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
