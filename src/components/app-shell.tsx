import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  getScrum44UiReviewEnvForClient,
  isScrum44UiReviewEnabled,
} from "@/lib/scrum44-ui-review-flag";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const isUiReviewEnabled = isScrum44UiReviewEnabled(getScrum44UiReviewEnvForClient());
  const isCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const KEEP_HOME_SCREEN_UNCHANGED = true;
  const shouldApplyAzureTheme =
    isUiReviewEnabled && (!KEEP_HOME_SCREEN_UNCHANGED || pathname !== "/dashboard");

  return (
    <SidebarProvider>
      <div className={cn("min-h-screen flex w-full bg-background", shouldApplyAzureTheme && "azure-theme")}>
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-20">
            <SidebarTrigger />
            <h1 className="text-base font-semibold flex-1 truncate">{title}</h1>
            <div className="flex items-center gap-2">{actions}</div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-x-auto">
            <div className="space-y-3">
              {isCaptureMode && (
                <div className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
                  EXAMPLE DATA
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
      <Toaster richColors closeButton position="top-right" />
    </SidebarProvider>
  );
}
