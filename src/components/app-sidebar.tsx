import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useImportApprovalStatus,
  type ImportApprovalStatusView,
} from "@/lib/import-approval-status";
import {
  isNavItemActive,
  navLinkActiveOptions,
  visibleNavGroups,
  type NavBadge,
  type NavGroup,
} from "@/lib/nav";
import { primaryRoleLabel } from "@/lib/role-labels";

/**
 * SCRUM-131 import-approval state for the "Import approvals" and "My uploads" items (plan §3.3
 * row 3, G11): { isApprover, canUpload, pendingCount } from Peter's useImportApprovalStatus(), one
 * read-only getImportApprovalStatus() query shared with the route guard (polled once a minute for
 * the badge). Asked for every signed-in user whatever their role, so a leadership-only approver
 * sees Import approvals. The visibility rule is Peter's lib/import-approver-gate.ts, applied
 * through lib/nav.ts visibleNavGroups. A failed read hides both items and the badge.
 */
function useImportApprovalNav(enabled: boolean): ImportApprovalStatusView {
  return useImportApprovalStatus(enabled);
}

// SCRUM-128 (plan §3.3-§3.5, C3): the sidebar renders lib/nav.ts with one NavGroup component.
export function AppSidebar() {
  const { state, hoverExpanded, setOpen, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  // The mobile sheet always shows labels, whatever the desktop rail preference is (N2).
  const showLabels = isMobile || state === "expanded" || hoverExpanded;
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { user, roles, signOut } = useAuth();
  const { can } = usePermissions();
  const importApproval = useImportApprovalNav(Boolean(user));
  // Leadership-only: Dashboard, plus Import approvals when on the approver list (any role) and
  // My uploads for approvers or uploaders.
  const groups = visibleNavGroups({
    roles,
    can,
    isImportApprover: importApproval.isApprover,
    canUpload: importApproval.canUpload,
  });
  const badgeCount = (badge: NavBadge | undefined): number =>
    badge === "pending-imports" ? importApproval.pendingCount : 0;

  return (
    <Sidebar collapsible="icon" hoverExpandOnRail>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="h-8 w-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center font-semibold">
            M
          </div>
          {showLabels && (
            <div className="leading-tight">
              <div className="text-sm font-semibold">MakeMyLabs</div>
              <div className="text-xs text-sidebar-foreground/60">Transaction Platform</div>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <NavGroupBlock
            key={group.label}
            group={group}
            pathname={pathname}
            showLabels={showLabels}
            badgeCount={badgeCount}
            onNavigate={() => {
              // The mobile sheet closes after a tap (N3).
              if (isMobile) setOpenMobile(false);
            }}
          />
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {/* The collapse switch does nothing for the mobile sheet, so it is hidden there (N4). */}
        {!isMobile && (
          <div
            className={cn("flex items-center gap-2 px-2 py-1", !showLabels && "justify-center")}
            data-testid="collapse-menu-toggle-row"
          >
            <Switch
              id="collapse-menu-toggle"
              aria-label="Collapse menu"
              checked={collapsed}
              onCheckedChange={(checked) => setOpen(!checked)}
            />
            {showLabels && (
              <Label htmlFor="collapse-menu-toggle" className="text-xs text-sidebar-foreground/70">
                Collapse menu
              </Label>
            )}
          </div>
        )}
        {showLabels && user && (
          <div className="px-2 py-2 text-xs">
            <div className="font-medium truncate" title={user.email ?? undefined}>
              {user.email}
            </div>
            <div className="text-sidebar-foreground/60">{primaryRoleLabel(roles)}</div>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={signOut}
          aria-label={showLabels ? undefined : "Sign out"}
        >
          <LogOut className="h-4 w-4" />
          {showLabels && <span className="ml-2">Sign out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}

function NavGroupBlock({
  group,
  pathname,
  showLabels,
  badgeCount,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  showLabels: boolean;
  badgeCount: (badge: NavBadge | undefined) => number;
  onNavigate: () => void;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="group-data-[hover-expanded=true]:mt-0 group-data-[hover-expanded=true]:opacity-100">
        {group.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => {
            const active = isNavItemActive(pathname, item);
            const count = badgeCount(item.badge);
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  className="group-data-[hover-expanded=true]:!h-8 group-data-[hover-expanded=true]:!w-full group-data-[hover-expanded=true]:!p-2"
                >
                  <Link
                    to={item.to}
                    activeOptions={navLinkActiveOptions(item)}
                    aria-current={active ? "page" : undefined}
                    // Collapsed rail: icons only, so the link needs a name (N12).
                    aria-label={showLabels ? undefined : item.label}
                    onClick={onNavigate}
                  >
                    <item.icon className="h-4 w-4" />
                    {showLabels && <span>{item.label}</span>}
                  </Link>
                </SidebarMenuButton>
                {count > 0 && showLabels && (
                  <SidebarMenuBadge aria-label={`${count} waiting for sign-off`}>
                    {count}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
