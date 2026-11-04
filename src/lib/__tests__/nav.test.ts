import { describe, expect, it } from "vitest";
import { ClipboardCheck, FileUp } from "lucide-react";
import type { AppRole } from "@/lib/auth-context";
import {
  NAV_GROUPS,
  PAGE_META,
  isNavItemActive,
  pageDocumentTitle,
  pageHead,
  subPageHead,
  subPageShell,
  visibleNavGroups,
  type NavAccess,
  type PagePath,
} from "@/lib/nav";

// Route sources, read as text, to check every page uses PAGE_META (plan §3.2, #33, N9).
const routeSources = import.meta.glob("/src/routes/_authenticated/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
const PATHS = Object.keys(PAGE_META) as PagePath[];
/**
 * SCRUM-131's My uploads screen (Peter) still passes a literal AppShell title (pinned by Peter's
 * my-uploads.test.ts); SCRUM-131 switches it to pageShell(...) and then removes it from this list.
 * Its tab title already comes from pageHead("/my-uploads") (SCRUM-128 C24), so the head check
 * below has no exception. The two Import approvals files left this list in SCRUM-128 C15 (X4): the
 * queue uses pageShell/pageHead, the sign-off drill-down subPageShell/subPageHead.
 */
const SCRUM131_OWNED_ROUTE_FILES = ["/src/routes/_authenticated/my-uploads.tsx"];
const SCRUM131_OWNED_PATHS: PagePath[] = ["/my-uploads"];

function routeFileFor(path: PagePath): string {
  const base = path.slice(1).replace(/\//g, ".");
  const file = base === "ai-command-center" || base === "import-approvals" ? `${base}.index` : base;
  return `/src/routes/_authenticated/${file}.tsx`;
}

function access(roles: AppRole[], over: Partial<NavAccess> = {}): NavAccess {
  return {
    roles,
    can: () => true,
    isImportApprover: false,
    canUpload: false,
    ...over,
  };
}

describe("nav config (SCRUM-128 §3.3)", () => {
  it("orders the groups Workspace, MML Lab, AI Command Center, with the Dashboard first (D4, N5)", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Workspace", "MML Lab", "AI Command Center"]);
    expect(NAV_GROUPS[0].items[0].to).toBe("/dashboard");
  });

  it("has exactly one nav item per page, and the nav label equals the page title", () => {
    expect(ALL_ITEMS.map((i) => i.to).sort()).toEqual([...PATHS].sort());
    for (const item of ALL_ITEMS) expect(item.label).toBe(PAGE_META[item.to].title);
  });

  it("puts Import approvals third in Workspace, approvers only, with the pending badge (G11)", () => {
    expect(NAV_GROUPS[0].items.slice(0, 3).map((i) => i.to)).toEqual([
      "/dashboard",
      "/entry",
      "/import-approvals",
    ]);
    expect(NAV_GROUPS[0].items[2]).toMatchObject({
      to: "/import-approvals",
      label: "Import approvals",
      icon: ClipboardCheck,
      roles: null,
      gate: "import-approver",
      badge: "pending-imports",
      matchChildren: true,
    });
    // One definition: the item exists once, in this config only.
    expect(ALL_ITEMS.filter((i) => i.to === "/import-approvals")).toHaveLength(1);
  });

  // Ported from Peter's nav-active.test.ts (61aa629 / 4680807): My uploads, right after Import approvals.
  it("puts My uploads fourth in Workspace, gate 'my-uploads', no badge", () => {
    expect(NAV_GROUPS[0].items.slice(0, 4).map((i) => i.to)).toEqual([
      "/dashboard",
      "/entry",
      "/import-approvals",
      "/my-uploads",
    ]);
    expect(NAV_GROUPS[0].items[3]).toEqual({
      to: "/my-uploads",
      label: "My uploads",
      icon: FileUp,
      roles: null,
      gate: "my-uploads",
    });
    expect(ALL_ITEMS.filter((i) => i.to === "/my-uploads")).toHaveLength(1);
  });

  it.each(PATHS)("%s: exactly one nav item is active", (path) => {
    for (const p of [path, `${path}/`]) {
      const active = ALL_ITEMS.filter((i) => isNavItemActive(p, i));
      expect(active.map((i) => i.to)).toEqual([path]);
    }
  });

  it("no nav item sits under a matchChildren item, so drill-downs never light two items", () => {
    for (const parent of ALL_ITEMS.filter((i) => i.matchChildren)) {
      const under = ALL_ITEMS.filter((i) => i.to.startsWith(`${parent.to}/`));
      expect(
        under.map((i) => i.to),
        parent.to,
      ).toEqual([]);
    }
  });

  // Ported from Peter's nav-active.test.ts (f3425a4), which tested lib/nav-active.ts; that helper
  // is replaced by isNavItemActive so there is one active-state rule.
  it.each([
    ["/import-approvals", "/import-approvals"],
    ["/import-approvals/", "/import-approvals"],
    ["/import-approvals/00000000-0000-4000-8000-000000000001", "/import-approvals"],
    ["/my-uploads", "/my-uploads"],
    ["/my-uploads/", "/my-uploads"],
    ["/ai-command-center", "/ai-command-center"],
    ["/ai-command-center/agents", "/ai-command-center/agents"],
    ["/ai-command-center/inbox/", "/ai-command-center/inbox"],
    ["/ai-command-center/run-now", "/ai-command-center/run-now"],
    ["/ai-command-center/audit", "/ai-command-center/audit"],
    ["/mml-lab/batches", "/mml-lab/batches"],
    ["/transactions", "/transactions"],
    ["/dashboard", "/dashboard"],
  ])("%s → exactly %s is active", (pathname, expected) => {
    expect(ALL_ITEMS.filter((i) => isNavItemActive(pathname, i)).map((i) => i.to)).toEqual([
      expected,
    ]);
  });

  it("an unknown path has no active item; a look-alike prefix does not match", () => {
    for (const p of ["/auth", "/import-approvals-old", "/dashboard-old"]) {
      expect(
        ALL_ITEMS.filter((i) => isNavItemActive(p, i)),
        p,
      ).toEqual([]);
    }
  });

  it("AI Command Center Summary is not active on its sub-pages (#34)", () => {
    const summary = ALL_ITEMS.find((i) => i.to === "/ai-command-center")!;
    for (const sub of ["agents", "inbox", "run-now", "audit"]) {
      expect(isNavItemActive(`/ai-command-center/${sub}`, summary)).toBe(false);
    }
    expect(
      isNavItemActive("/ai-command-center/inbox/123", { to: "/ai-command-center/inbox" }),
    ).toBe(false);
    expect(
      isNavItemActive("/ai-command-center/inbox/123", {
        to: "/ai-command-center/inbox",
        matchChildren: true,
      }),
    ).toBe(true);
  });

  it("uses a different icon for every item, so the collapsed rail never shows two alike (N6)", () => {
    const icons = ALL_ITEMS.map((i) => i.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("labels are sentence case apart from MML's proper nouns (P7)", () => {
    const allowedCaps = /\b(MML|MCP|ADR|AI|Command|Center|Lab)\b/g;
    for (const label of [...ALL_ITEMS.map((i) => i.label), ...NAV_GROUPS.map((g) => g.label)]) {
      const rest = label.replace(allowedCaps, "").split(/\s+/).slice(1).join(" ");
      expect(rest, label).toBe(rest.toLowerCase());
    }
    expect(NAV_GROUPS.find((g) => g.label === "AI Command Center")!.items[0].label).toBe("Summary");
  });
});

describe("page titles (N9)", () => {
  it("builds browser tab titles from PAGE_META", () => {
    expect(pageDocumentTitle("/customers")).toBe("Customers · MakeMyLabs");
    expect(pageDocumentTitle("/ai-command-center/inbox")).toBe(
      "Inbox · AI Command Center · MakeMyLabs",
    );
    expect(pageDocumentTitle("/mml-lab/batches")).toBe("Lab batches · MML Lab · MakeMyLabs");
    expect(pageHead("/tickets")).toEqual({ meta: [{ title: "Support tickets · MakeMyLabs" }] });
  });

  it("links the AI Command Center section and leaves MML Lab as plain text", () => {
    expect(PAGE_META["/ai-command-center/audit"].section).toEqual({
      label: "AI Command Center",
      to: "/ai-command-center",
    });
    expect(PAGE_META["/mml-lab/lab-catalog"].section).toEqual({ label: "MML Lab" });
    expect(PAGE_META["/customers"].section).toBeUndefined();
  });

  it.each(PATHS.filter((p) => !SCRUM131_OWNED_PATHS.includes(p)))(
    "%s: the route file takes its AppShell title from PAGE_META",
    (path) => {
      const src = routeSources[routeFileFor(path)];
      expect(src, `${routeFileFor(path)} missing`).toBeDefined();
      expect(src).not.toMatch(/<AppShell\s+title=/);
      expect(src).toContain(`pageShell("${path}")`);
    },
  );

  it.each(PATHS)("%s: the route file takes its head (tab) title from PAGE_META", (path) => {
    const src = routeSources[routeFileFor(path)];
    expect(src, `${routeFileFor(path)} missing`).toBeDefined();
    expect(src).toMatch(
      new RegExp(`(pageHead|pageDocumentTitle)\\("${path.replace(/\//g, "\\/")}"\\)`),
    );
  });

  it("a drill-down page sits under its nav page: breadcrumb link and tab title (C15)", () => {
    expect(subPageShell("Import sign-off", "/import-approvals")).toEqual({
      title: "Import sign-off",
      section: { label: "Import approvals", to: "/import-approvals" },
    });
    expect(subPageHead("Import sign-off", "/import-approvals")).toEqual({
      meta: [{ title: "Import sign-off · Import approvals · MakeMyLabs" }],
    });
    const stage = routeSources["/src/routes/_authenticated/import-approvals.$stageId.tsx"];
    expect(stage).toContain('subPageShell("Import sign-off", "/import-approvals")');
    expect(stage).toContain('subPageHead("Import sign-off", "/import-approvals")');
  });

  it("every PAGE_META path has a route file", () => {
    for (const path of PATHS) expect(routeSources[routeFileFor(path)], path).toBeDefined();
  });

  it("no route file passes a literal title to AppShell", () => {
    for (const [file, src] of Object.entries(routeSources)) {
      if (SCRUM131_OWNED_ROUTE_FILES.includes(file)) continue;
      expect(src, file).not.toMatch(/<AppShell\s+title=/);
    }
  });
});

describe("visibleNavGroups (role rules from 6e7bd5f + SCRUM-131 approver gate)", () => {
  const labels = (a: NavAccess) => visibleNavGroups(a).flatMap((g) => g.items.map((i) => i.to));

  it("admin sees every page except the two SCRUM-131 gated ones unless the status says so", () => {
    expect(labels(access(["admin"]))).toEqual(
      PATHS.filter((p) => p !== "/import-approvals" && p !== "/my-uploads"),
    );
    expect(labels(access(["admin"], { isImportApprover: true }))).toContain("/import-approvals");
    expect(labels(access(["admin"], { isImportApprover: true }))).toContain("/my-uploads");
    expect(labels(access(["admin"], { canUpload: true }))).toContain("/my-uploads");
    expect(labels(access(["admin"], { canUpload: true }))).not.toContain("/import-approvals");
  });

  it("leadership-only users see the Dashboard only, plus Import approvals when on the list", () => {
    expect(labels(access(["leadership"]))).toEqual(["/dashboard"]);
    expect(visibleNavGroups(access(["leadership"])).map((g) => g.label)).toEqual(["Workspace"]);
    // Peter's SCRUM-131 gate (2c2ea7a): the approver list decides, whatever the role (Chief).
    expect(labels(access(["leadership"], { isImportApprover: true }))).toEqual([
      "/dashboard",
      "/import-approvals",
      "/my-uploads",
    ]);
    expect(labels(access(["leadership"], { canUpload: true }))).toEqual([
      "/dashboard",
      "/my-uploads",
    ]);
  });

  it("My uploads follows isApprover || canUpload only, for every role (Peter's 4680807 gate)", () => {
    for (const roles of [
      ["admin"],
      ["finance"],
      ["ops_lead"],
      ["ops_user"],
      ["viewer"],
      [],
    ] as AppRole[][]) {
      expect(labels(access(roles, { canUpload: true })), roles.join()).toContain("/my-uploads");
      expect(labels(access(roles, { isImportApprover: true })), roles.join()).toContain(
        "/my-uploads",
      );
      expect(labels(access(roles)), roles.join()).not.toContain("/my-uploads");
    }
  });

  it("Import approvals follows the approver list only, for every role", () => {
    for (const roles of [
      ["admin"],
      ["finance"],
      ["ops_lead"],
      ["ops_user"],
      ["viewer"],
      [],
    ] as AppRole[][]) {
      expect(labels(access(roles, { isImportApprover: true })), roles.join()).toContain(
        "/import-approvals",
      );
      expect(labels(access(roles)), roles.join()).not.toContain("/import-approvals");
    }
  });

  it("applies roles and permissions", () => {
    const viewer = labels(access(["viewer"], { can: () => false }));
    expect(viewer).not.toContain("/entry");
    expect(viewer).not.toContain("/reports");
    expect(viewer).not.toContain("/mml-lab/lab-catalog");
    expect(viewer).not.toContain("/ai-command-center");
    expect(viewer).toContain("/transactions");
    expect(labels(access(["ops_user"]))).toContain("/entry");
    expect(labels(access(["ops_user"]))).not.toContain("/mcp-audit");
    expect(labels(access(["viewer"]))).not.toContain("/mml-lab/cost-catalog");
  });
});

describe("app-sidebar.tsx renders lib/nav.ts (one definition, ported from nav-active.test.ts)", () => {
  const src = Object.values(
    import.meta.glob("/src/components/app-sidebar.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  )[0] as string;

  it("has no nav items of its own and no per-item prefix match", () => {
    expect(src).not.toMatch(/\bto: "\//);
    expect(src).not.toContain('pathname.startsWith(item.to + "/")');
    expect(src).not.toContain("as string");
    expect(src).toContain("visibleNavGroups(");
    expect(src).toContain("isNavItemActive(pathname, item)");
    expect(src).toContain('aria-current={active ? "page" : undefined}');
  });

  it("reads Import approvals state from getImportApprovalStatus and hides the badge at 0", () => {
    // Peter's 4680807: the query lives in the shared hook (also used by the route guard and the
    // Bulk Upload confirmation link); read-only, so the badge polls it once a minute.
    expect(src).toContain("useImportApprovalStatus(enabled)");
    const hook = Object.values(
      import.meta.glob("/src/lib/import-approval-status.ts", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    )[0] as string;
    expect(hook).toContain("getImportApprovalStatus");
    expect(hook).toContain("refetchInterval: IMPORT_APPROVAL_STATUS_POLL_MS");
    // Asked for every signed-in user (Peter's 2c2ea7a), so a leadership-only approver sees it.
    expect(src).toContain("useImportApprovalNav(Boolean(user))");
    expect(src).toContain("isImportApprover: importApproval.isApprover");
    expect(src).toContain("canUpload: importApproval.canUpload");
    expect(src).toMatch(/badge === "pending-imports" \? importApproval\.pendingCount : 0/);
    expect(src).toMatch(/\{count > 0 && showLabels &&/);
    expect(src).toContain("SidebarMenuBadge");
  });
});
