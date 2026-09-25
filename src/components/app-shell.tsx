import type { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Toaster } from "@/components/ui/sonner";

export function AppShell({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-20">
            <SidebarTrigger />
            <h1 className="text-base font-semibold flex-1 truncate">{title}</h1>
            <div className="flex items-center gap-2">{actions}</div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-x-auto">{children}</main>
        </div>
      </div>
      <Toaster richColors closeButton position="top-right" />
    </SidebarProvider>
  );
}
