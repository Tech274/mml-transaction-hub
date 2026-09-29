// SCRUM-61 (G-21): reusable beforeLoad guard. The role check is done by the
// database (has_any_role), not by client-side state, so it can't be skipped
// by editing local storage.
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { rolesFor, type GuardedRoute } from "@/lib/route-roles";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export function requireRouteRoles(route: GuardedRoute) {
  return async () => {
    if (isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient())) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth", search: { next: "" } });
    const { data: ok, error } = await supabase.rpc("has_any_role", {
      _user_id: user.id,
      _roles: rolesFor(route),
    });
    if (error || ok !== true) throw redirect({ to: "/dashboard" });
  };
}
