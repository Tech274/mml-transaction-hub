import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { getCaptureRole } from "@/lib/capture-persona";
import { canLeadershipOpenRoute } from "@/lib/leadership-access";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const pathname = location.pathname;
    if (isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient())) {
      const captureRole = getCaptureRole(
        getSuperadminCaptureModeEnvForClient(),
        location.searchStr,
      );
      if (captureRole === "leadership" && !canLeadershipOpenRoute(pathname)) {
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
    if (isLeadership === true && isAdmin !== true && !canLeadershipOpenRoute(pathname)) {
      throw redirect({ to: "/dashboard" });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
