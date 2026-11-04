import { useEffect, useState, type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { PageSection } from "./page-section";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { getSidebarOpenFromStorage, persistSidebarCollapsed } from "@/lib/sidebar-prefs";
import type { NavSection } from "@/lib/nav";
import { Badge } from "@/components/ui/badge";

// SCRUM-128 (plan §3.1-§3.2, C3): the one shell every in-app page renders. Pages pass
// `{...pageShell("/path")}` from lib/nav.ts, so the title and breadcrumb section always equal the
// sidebar label. The single Toaster lives in routes/__root.tsx (N10).
export function AppShell({
  title,
  section,
  description,
  actions,
  children,
}: {
  /** Page title (h1). Comes from PAGE_META via pageShell(). */
  title: string;
  /** Breadcrumb section for pages inside AI Command Center or MML Lab. */
  section?: NavSection;
  /** At most one line under the header, only where it adds information. */
  description?: string;
  /** At most two `Button size="sm"`; below sm their text should be sr-only. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    getSidebarOpenFromStorage(typeof window !== "undefined" ? window.localStorage : null),
  );
  const isCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());

  useEffect(() => {
    if (typeof window === "undefined") return;
    persistSidebarCollapsed(window.localStorage, !sidebarOpen);
  }, [sidebarOpen]);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      {/* SCRUM-128 (C1): no theme class here. The azure theme is :root in styles.css. */}
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-20">
            <SidebarTrigger />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {section && <PageSection section={section} />}
              <h1 className="text-base font-semibold flex-1 truncate" title={title}>
                {title}
              </h1>
            </div>
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
          <main className="flex-1 min-w-0 p-4 md:p-6 overflow-x-auto">
            <div className="space-y-4">
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
              {isCaptureMode && (
                <Badge variant="info" className="w-fit">
                  Example data
                </Badge>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
