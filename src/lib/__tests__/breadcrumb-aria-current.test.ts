// SCRUM-128 C25 (Eng QC S4): the header breadcrumb's section link is aria-current only on the
// section's own page, never on the pages under it. Renders the real PageSection (and the sidebar's
// Links, as in sidebar-aria-current.test.ts) through a TanStack memory router on the server.
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import {
  Link,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { PageSection } from "@/components/page-section";
import {
  NAV_GROUPS,
  isNavItemActive,
  navLinkActiveOptions,
  pageShell,
  subPageShell,
  type NavSection,
  type PagePath,
} from "@/lib/nav";

const ACC_PAGES: PagePath[] = [
  "/ai-command-center",
  "/ai-command-center/agents",
  "/ai-command-center/inbox",
  "/ai-command-center/run-now",
  "/ai-command-center/audit",
];
const ITEMS = NAV_GROUPS.flatMap((g) => g.items);

type Current = { label: string; href: string };

async function render(url: string, body: () => ReturnType<typeof createElement>) {
  const rootRoute = createRootRoute({ component: body, notFoundComponent: () => null });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  const html = renderToString(createElement(RouterProvider, { router } as never));
  return [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)]
    .filter((m) => m[1].includes('aria-current="page"'))
    .map((m): Current => ({ label: m[2], href: /href="([^"]*)"/.exec(m[1])?.[1] ?? "" }));
}

const breadcrumb = (section: NavSection) => () => createElement(PageSection, { section });

/** The header breadcrumb plus every sidebar link, with the same props as app-sidebar.tsx. */
const shellLinks = (url: string, section: NavSection) => () =>
  createElement(
    Fragment,
    null,
    createElement(PageSection, { section }),
    ...ITEMS.map((item) =>
      createElement(
        Link,
        {
          key: item.to,
          to: item.to as never,
          activeOptions: navLinkActiveOptions(item),
          "aria-current": isNavItemActive(url.split("?")[0], item) ? "page" : undefined,
        } as never,
        item.label,
      ),
    ),
  );

describe("breadcrumb aria-current (C25, Eng QC S4)", () => {
  it("'AI Command Center' is current only on its own page (Summary), not on the 4 sub-pages", async () => {
    for (const path of ACC_PAGES) {
      const section = pageShell(path).section!;
      expect(section).toEqual({ label: "AI Command Center", to: "/ai-command-center" });
      const current = await render(path, breadcrumb(section));
      expect(current, path).toEqual(
        path === "/ai-command-center" ? [{ label: "AI Command Center", href: path }] : [],
      );
    }
    expect(
      await render(
        "/ai-command-center/inbox?status=pending",
        breadcrumb(pageShell("/ai-command-center/inbox").section!),
      ),
    ).toEqual([]);
  });

  it("on every AI Command Center page, each aria-current link points at the page itself", async () => {
    for (const path of ACC_PAGES) {
      const current = await render(path, shellLinks(path, pageShell(path).section!));
      expect(current.length, path).toBeGreaterThan(0);
      for (const c of current) expect(c.href, `${path}: ${c.label}`).toBe(path);
    }
  });

  it("'Import approvals' is not current on the sign-off drill-down", async () => {
    const section = subPageShell("Import sign-off", "/import-approvals").section!;
    expect(await render("/import-approvals/abc-123", breadcrumb(section))).toEqual([]);
    // The queue page itself has no breadcrumb section.
    expect(pageShell("/import-approvals").section).toBeUndefined();
    // Sidebar + breadcrumb on the drill-down: only the sidebar item (matchChildren) is current.
    expect(
      (
        await render("/import-approvals/abc-123", shellLinks("/import-approvals/abc-123", section))
      ).map((c) => c.label),
    ).toEqual(["Import approvals"]);
  });

  it("MML Lab has no page, so its breadcrumb is plain text with nothing current", async () => {
    const section = pageShell("/mml-lab/batches").section!;
    expect(section.to).toBeUndefined();
    expect(await render("/mml-lab/batches", breadcrumb(section))).toEqual([]);
  });

  it("without exact matching the section link is current on every sub-page (the S4 bug)", async () => {
    const plain = () =>
      createElement(Link, { to: "/ai-command-center" } as never, "AI Command Center");
    expect(await render("/ai-command-center/inbox", plain)).toEqual([
      { label: "AI Command Center", href: "/ai-command-center" },
    ]);
  });

  it("app-shell.tsx renders PageSection, which passes the exact options", () => {
    const raw = import.meta.glob(
      ["/src/components/app-shell.tsx", "/src/components/page-section.tsx"],
      {
        query: "?raw",
        import: "default",
        eager: true,
      },
    ) as Record<string, string>;
    expect(raw["/src/components/app-shell.tsx"]).toContain("<PageSection section={section} />");
    expect(raw["/src/components/page-section.tsx"]).toContain(
      "activeOptions={BREADCRUMB_LINK_ACTIVE_OPTIONS}",
    );
  });
});
