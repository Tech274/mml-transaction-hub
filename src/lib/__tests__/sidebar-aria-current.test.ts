// SCRUM-128 C21 (Eng QC S2): only the real page's sidebar link carries aria-current="page".
// Renders real TanStack Links (same props as app-sidebar.tsx) through a memory router on the
// server, because Link adds aria-current itself whenever its own matching says it is active.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  Link,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, isNavItemActive, navLinkActiveOptions, type NavItem } from "@/lib/nav";

const ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

async function currentLinks(url: string, withActiveOptions: boolean): Promise<string[]> {
  const pathname = url.split("?")[0];
  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        "nav",
        null,
        ITEMS.map((item) =>
          createElement(
            Link,
            {
              key: item.to,
              to: item.to as never,
              ...(withActiveOptions ? { activeOptions: navLinkActiveOptions(item) } : {}),
              "aria-current": isNavItemActive(pathname, item) ? "page" : undefined,
            } as never,
            item.label,
          ),
        ),
      ),
    notFoundComponent: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  const html = renderToString(createElement(RouterProvider, { router } as never));
  return [...html.matchAll(/<a\b[^>]*>([^<]*)<\/a>/g)]
    .filter((m) => m[0].includes('aria-current="page"'))
    .map((m) => m[1]);
}

const label = (to: string) => ITEMS.find((i) => i.to === to)!.label;

describe("sidebar aria-current (C21, Eng QC S2)", () => {
  it("exactly the matching item is current on every nav path", async () => {
    for (const item of ITEMS) {
      expect(await currentLinks(item.to, true), item.to).toEqual([item.label]);
    }
  });

  it("'Summary' is not current on AI Command Center sub-pages, with or without a query string", async () => {
    for (const url of [
      "/ai-command-center/agents",
      "/ai-command-center/inbox",
      "/ai-command-center/inbox?status=pending",
      "/ai-command-center/run-now",
      "/ai-command-center/audit",
    ]) {
      const current = await currentLinks(url, true);
      expect(current, url).toEqual([label(url.split("?")[0])]);
      expect(current, url).not.toContain("Summary");
    }
    expect(await currentLinks("/ai-command-center", true)).toEqual(["Summary"]);
  });

  it("matchChildren items stay current on their drill-down (Import approvals sign-off)", async () => {
    expect(await currentLinks("/import-approvals/abc-123", true)).toEqual(["Import approvals"]);
  });

  it("without the options Link's default prefix match doubles aria-current (the S2 bug)", async () => {
    expect(await currentLinks("/ai-command-center/inbox", false)).toEqual(["Summary", "Inbox"]);
  });

  it("app-sidebar.tsx passes the options to its Link", () => {
    const src = Object.values(
      import.meta.glob("/src/components/app-sidebar.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    )[0] as string;
    expect(src).toContain("activeOptions={navLinkActiveOptions(item)}");
    expect(src).toContain('aria-current={active ? "page" : undefined}');
  });
});
