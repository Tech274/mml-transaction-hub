// SCRUM-128 (plan §3.2-§3.3, C3): the one place that says what the sidebar shows, in which order,
// and what each page is called. The sidebar label, the header title, the breadcrumb section and
// the browser tab title all come from here, so they cannot drift apart (#33, N5-N9).
//
// Visibility is Peter's SCRUM-131 rule (lib/import-approver-gate.ts, 4680807): role and permission
// rules as at 6e7bd5f, plus Import approvals for anyone on the approver list and My uploads for
// approvers or uploaders. C3 changed only the order (Workspace first, D4), the labels (sentence
// case) and two icons.
import {
  BarChart3,
  Bot,
  BotMessageSquare,
  Calculator,
  ClipboardCheck,
  Cloud,
  DatabaseZap,
  FilePlus2,
  FileUp,
  FlaskConical,
  History,
  Inbox,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListTree,
  Play,
  PlugZap,
  ScrollText,
  Server,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/auth-context";
import { isWorkspaceNavItemVisible } from "@/lib/import-approver-gate";

export const APP_NAME = "MakeMyLabs";

/** Every in-app page path. `/import-approvals` and `/my-uploads` are SCRUM-131's pages (X4). */
export type PagePath =
  | "/dashboard"
  | "/entry"
  | "/import-approvals"
  | "/my-uploads"
  | "/transactions"
  | "/public-cloud"
  | "/private-cloud"
  | "/customers"
  | "/reports"
  | "/tickets"
  | "/agent-integrations"
  | "/sync-status"
  | "/mcp-audit"
  | "/admin"
  | "/mml-lab/lab-catalog"
  | "/mml-lab/cost-catalog"
  | "/mml-lab/batches"
  | "/ai-command-center"
  | "/ai-command-center/agents"
  | "/ai-command-center/inbox"
  | "/ai-command-center/run-now"
  | "/ai-command-center/audit";

export type NavSection = { label: string; to?: PagePath };

export type PageMeta = {
  /** Header h1, sidebar label and the first part of the browser tab title. Sentence case. */
  title: string;
  /** Breadcrumb section for pages inside a section (AI Command Center, MML Lab). */
  section?: NavSection;
};

export const SECTION_AI_COMMAND_CENTER: NavSection = {
  label: "AI Command Center",
  to: "/ai-command-center",
};
/** MML Lab has no page of its own, so its breadcrumb section is plain text. */
export const SECTION_MML_LAB: NavSection = { label: "MML Lab" };

export const PAGE_META: Readonly<Record<PagePath, PageMeta>> = {
  "/dashboard": { title: "Dashboard" },
  "/entry": { title: "Master ADR entry" },
  "/import-approvals": { title: "Import approvals" },
  "/my-uploads": { title: "My uploads" },
  "/transactions": { title: "All transactions" },
  "/public-cloud": { title: "Public cloud" },
  "/private-cloud": { title: "Private cloud" },
  "/customers": { title: "Customers" },
  "/reports": { title: "Reports" },
  "/tickets": { title: "Support tickets" },
  "/agent-integrations": { title: "Agent integrations" },
  "/sync-status": { title: "Sync status" },
  "/mcp-audit": { title: "MCP audit log" },
  "/admin": { title: "Admin settings" },
  "/mml-lab/lab-catalog": { title: "Lab catalog", section: SECTION_MML_LAB },
  "/mml-lab/cost-catalog": { title: "Cost catalog", section: SECTION_MML_LAB },
  "/mml-lab/batches": { title: "Lab batches", section: SECTION_MML_LAB },
  "/ai-command-center": { title: "Summary", section: SECTION_AI_COMMAND_CENTER },
  "/ai-command-center/agents": { title: "Agents", section: SECTION_AI_COMMAND_CENTER },
  "/ai-command-center/inbox": { title: "Inbox", section: SECTION_AI_COMMAND_CENTER },
  "/ai-command-center/run-now": { title: "Run now", section: SECTION_AI_COMMAND_CENTER },
  "/ai-command-center/audit": { title: "Audit", section: SECTION_AI_COMMAND_CENTER },
};

/** Props for `<AppShell {...pageShell(path)}>`: title and breadcrumb section from PAGE_META. */
export function pageShell(path: PagePath): PageMeta {
  return PAGE_META[path];
}

/** "Customers · MakeMyLabs"; section pages: "Inbox · AI Command Center · MakeMyLabs" (N9). */
export function pageDocumentTitle(path: PagePath): string {
  const { title, section } = PAGE_META[path];
  return [title, section?.label, APP_NAME].filter(Boolean).join(" · ");
}

/**
 * SCRUM-128 C15: a drill-down page under a nav page (Import approvals › Import sign-off). The parent
 * page is the breadcrumb section (a link back) and the second part of the tab title.
 */
export function subPageShell(title: string, parent: PagePath): PageMeta {
  return { title, section: { label: PAGE_META[parent].title, to: parent } };
}

/** "Import sign-off · Import approvals · MakeMyLabs" for a drill-down page's `head`. */
export function subPageHead(title: string, parent: PagePath): { meta: Array<{ title: string }> } {
  return { meta: [{ title: [title, PAGE_META[parent].title, APP_NAME].join(" · ") }] };
}

/** For a route's `head`: `head: () => pageHead("/customers")`. */
export function pageHead(path: PagePath): { meta: Array<{ title: string }> } {
  return { meta: [{ title: pageDocumentTitle(path) }] };
}

/**
 * "import-approver": only users on the import approver list (SCRUM-131 `is_import_approver`, read
 * through `getImportApprovalStatus`), whatever their role. "my-uploads": approvers or uploaders
 * (`getImportApprovalStatus().canUpload`), whatever else their role. Rule: lib/import-approver-gate.ts.
 */
export type NavGate = "import-approver" | "my-uploads";
/** A count shown as a `SidebarMenuBadge`, hidden when 0. */
export type NavBadge = "pending-imports";

export type NavItem = {
  to: PagePath;
  label: string;
  icon: LucideIcon;
  /** null = every signed-in role. */
  roles: readonly AppRole[] | null;
  permission?: string;
  gate?: NavGate;
  badge?: NavBadge;
  /**
   * Active on exact match only, unless the item has child routes that are not in the nav
   * (Import approvals: /import-approvals/$stageId). Prefix matching on every item made
   * "AI Command Center" active on every sub-page (#34). nav.test.ts checks that no nav item sits
   * under a matchChildren item, so exactly one item is active on every path.
   */
  matchChildren?: boolean;
};

export type NavGroup = { label: string; items: readonly NavItem[] };

const MML_LAB_VIEW_ROLES: readonly AppRole[] = [
  "admin",
  "leadership",
  "finance",
  "ops_lead",
  "ops_user",
  "viewer",
];

/** Sidebar order (D4): Workspace (Dashboard first), MML Lab, AI Command Center. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: null },
      {
        to: "/entry",
        label: "Master ADR entry",
        icon: FilePlus2,
        roles: ["admin", "ops_lead", "ops_user"],
        permission: "feature_master_adr_entry",
      },
      // SCRUM-131 item (plan §3.3 row 3, G11): approvers only, with the pending count; active on
      // its sign-off drill-down /import-approvals/$stageId too.
      {
        to: "/import-approvals",
        label: "Import approvals",
        icon: ClipboardCheck,
        roles: null,
        gate: "import-approver",
        badge: "pending-imports",
        matchChildren: true,
      },
      // SCRUM-131 (John, Option 2): own uploads, outside the approver gate. Approvers or uploaders.
      {
        to: "/my-uploads",
        label: "My uploads",
        icon: FileUp,
        roles: null,
        gate: "my-uploads",
      },
      { to: "/transactions", label: "All transactions", icon: ListTree, roles: null },
      { to: "/public-cloud", label: "Public cloud", icon: Cloud, roles: null },
      { to: "/private-cloud", label: "Private cloud", icon: Server, roles: null },
      { to: "/customers", label: "Customers", icon: Users, roles: null },
      {
        to: "/reports",
        label: "Reports",
        icon: BarChart3,
        roles: null,
        permission: "feature_reports_access",
      },
      { to: "/tickets", label: "Support tickets", icon: LifeBuoy, roles: ["admin"] },
      { to: "/agent-integrations", label: "Agent integrations", icon: PlugZap, roles: null },
      { to: "/sync-status", label: "Sync status", icon: DatabaseZap, roles: ["admin"] },
      { to: "/mcp-audit", label: "MCP audit log", icon: ScrollText, roles: ["admin"] },
      { to: "/admin", label: "Admin settings", icon: Settings, roles: ["admin"] },
    ],
  },
  {
    label: "MML Lab",
    items: [
      {
        to: "/mml-lab/lab-catalog",
        label: "Lab catalog",
        icon: FlaskConical,
        roles: MML_LAB_VIEW_ROLES,
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
        label: "Lab batches",
        icon: Layers,
        roles: MML_LAB_VIEW_ROLES,
        permission: "feature_lab_batches_manage",
      },
    ],
  },
  {
    label: "AI Command Center",
    items: [
      { to: "/ai-command-center", label: "Summary", icon: Bot, roles: ["admin"] },
      {
        to: "/ai-command-center/agents",
        label: "Agents",
        icon: BotMessageSquare,
        roles: ["admin"],
      },
      { to: "/ai-command-center/inbox", label: "Inbox", icon: Inbox, roles: ["admin"] },
      { to: "/ai-command-center/run-now", label: "Run now", icon: Play, roles: ["admin"] },
      { to: "/ai-command-center/audit", label: "Audit", icon: History, roles: ["admin"] },
    ],
  },
];

/** True when `item` is the nav item for `pathname` (one helper for every group, #34). */
export function isNavItemActive(pathname: string, item: Pick<NavItem, "to" | "matchChildren">) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === item.to) return true;
  return item.matchChildren === true && path.startsWith(`${item.to}/`);
}

/**
 * TanStack Link's own active matching for a nav link (C21, Eng QC S2). Link adds
 * `aria-current="page"` whenever it thinks it is active, over the value we pass, and by default it
 * prefix-matches, so "Summary" (/ai-command-center) was also current on every AI Command Center
 * sub-page. Exact matching (prefix only for matchChildren items) and ignoring the search string
 * make Link's idea of active the same as isNavItemActive, so exactly one link is current.
 */
export function navLinkActiveOptions(item: Pick<NavItem, "matchChildren">) {
  return { exact: item.matchChildren !== true, includeSearch: false } as const;
}

/**
 * The header breadcrumb's section link (C25, Eng QC S4): exact match only, so "AI Command Center"
 * is not aria-current on its sub-pages and "Import approvals" is not on the sign-off drill-down.
 */
export const BREADCRUMB_LINK_ACTIVE_OPTIONS = navLinkActiveOptions({});

export type NavAccess = {
  roles: readonly AppRole[];
  can: (permission: string) => boolean;
  /** The server's is_import_approver for the signed-in user (getImportApprovalStatus). */
  isImportApprover: boolean;
  /** getImportApprovalStatus().canUpload: holds an import role (My uploads). */
  canUpload: boolean;
};

/**
 * One visibility rule, Peter's SCRUM-131 gate (lib/import-approver-gate.ts): roles and permission
 * as before; leadership-only users see the Dashboard only; the "import-approver" item follows the
 * approver list alone, whatever the role; the "my-uploads" item shows for approvers or uploaders. It is the same rule for the MML Lab and AI Command
 * Center items (none is gated, and leadership-only users saw none of them before C3 either).
 */
function itemVisible(item: NavItem, access: NavAccess): boolean {
  return isWorkspaceNavItemVisible(item, {
    roles: access.roles,
    can: access.can,
    isApprover: access.isImportApprover,
    canUpload: access.canUpload,
  });
}

/** The groups and items this user may see; empty groups are dropped. */
export function visibleNavGroups(
  access: NavAccess,
  groups: readonly NavGroup[] = NAV_GROUPS,
): NavGroup[] {
  return groups
    .map((g) => ({ label: g.label, items: g.items.filter((i) => itemVisible(i, access)) }))
    .filter((g) => g.items.length > 0);
}
