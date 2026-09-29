import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireRouteRoles } from "@/lib/route-guard";

export const Route = createFileRoute("/_authenticated/ai-command-center")({
  beforeLoad: requireRouteRoles("/ai-command-center"),
  component: AiCommandCenterLayout,
});

function AiCommandCenterLayout() {
  return <Outlet />;
}
