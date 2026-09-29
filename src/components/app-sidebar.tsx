import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FilePlus2,
  ListTree,
  Cloud,
  Server,
  Users,
  BarChart3,
  Settings,
  LogOut,
  PlugZap,
  ScrollText,
  DatabaseZap,
  LifeBuoy,
  Bot,
  Inbox,
  Play,
  History,
  FlaskConical,
  Calculator,
  Layers,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: AppRole[] | null;
  permission?: string;
};

const nav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: null },
  {
    to: "/entry",
    label: "Master ADR Entry",
    icon: FilePlus2,
    roles: ["admin", "ops_lead", "ops_user"],
    permission: "feature_master_adr_entry",
  },
  { to: "/transactions", label: "All Transactions", icon: ListTree, roles: null },
  { to: "/public-cloud", label: "Public Cloud", icon: Cloud, roles: null },
  { to: "/private-cloud", label: "Private Cloud", icon: Server, roles: null },
  { to: "/customers", label: "Customers", icon: Users, roles: null },
  {
    to: "/reports",
    label: "Reports",
    icon: BarChart3,
    roles: null,
    permission: "feature_reports_access",
  },
  { to: "/tickets", label: "Support Tickets", icon: LifeBuoy, roles: ["admin"] },
  { to: "/agent-integrations", label: "Agent integrations", icon: PlugZap, roles: null },

  { to: "/sync-status", label: "Sync status", icon: DatabaseZap, roles: ["admin"] },
  { to: "/mcp-audit", label: "MCP audit log", icon: ScrollText, roles: ["admin"] },
  { to: "/admin", label: "Admin Settings", icon: Settings, roles: ["admin"] },
];

const mmlLabNav: NavItem[] = [
  {
    to: "/mml-lab/lab-catalog",
    label: "Lab catalog",
    icon: FlaskConical,
    roles: ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"],
    permission: "feature_lab_catalog_view",
  },
  {
    to: "/mml-lab/cost-catalog",
    label: "Cost catalog",
    icon: Calculator,
    roles: ["admin", "leadership", "finance", "ops_lead", "ops_user"],
    permission: "feature_cost_catalog_view",
  },
  {
    to: "/mml-lab/batches",
    label: "Batches",
    icon: Layers,
    roles: ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"],
    permission: "feature_lab_batches_manage",
  },
];

const aiCommandCenterNav: NavItem[] = [
  { to: "/ai-command-center", label: "AI Command Center", icon: Bot, roles: ["admin"] },
  { to: "/ai-command-center/agents", label: "Agents", icon: Bot, roles: ["admin"] },
  { to: "/ai-command-center/inbox", label: "Inbox", icon: Inbox, roles: ["admin"] },
  { to: "/ai-command-center/run-now", label: "Run now", icon: Play, roles: ["admin"] },
  { to: "/ai-command-center/audit", label: "Audit", icon: History, roles: ["admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { hasAnyRole, user, roles, signOut } = useAuth();
  const { can } = usePermissions();
  const visibleAiCommandCenterNav = aiCommandCenterNav.filter((i) => !i.roles || hasAnyRole(i.roles));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="h-8 w-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-bold">
            M
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold">MakeMyLabs</div>
              <div className="text-xs text-sidebar-foreground/60">Transaction Platform</div>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleAiCommandCenterNav.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>AI Command Center</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleAiCommandCenterNav.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + "/");
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.to}>
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup>
          <SidebarGroupLabel>MML Lab</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mmlLabNav
                .filter(
                  (i) => (!i.roles || hasAnyRole(i.roles)) && (!i.permission || can(i.permission)),
                )
                .map((item) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + "/");
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.to}>
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav
                .filter(
                  (i) => (!i.roles || hasAnyRole(i.roles)) && (!i.permission || can(i.permission)),
                )
                .map((item) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + "/");
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <Link to={item.to}>
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && user && (
          <div className="px-2 py-2 text-xs">
            <div className="font-medium truncate">{user.email}</div>
            <div className="text-sidebar-foreground/60 capitalize">
              {roles[0]?.replace("_", " ") ?? "no role"}
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sign out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
