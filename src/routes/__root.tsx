import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";

// SCRUM-128 (plan §3.6, X1, C3): the 404 and error views use the standalone layout (centred
// Card, Button primitives, the azure :root theme) instead of hand-built buttons and text-7xl.
function StandalonePage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 pt-6 text-center">{children}</CardContent>
      </Card>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <StandalonePage>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </StandalonePage>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <StandalonePage>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Error</p>
        <h1 className="text-xl font-semibold text-foreground">This page didn't load</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
        <Button
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </Button>
      </div>
    </StandalonePage>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MakeMyLabs" },
      {
        name: "description",
        content:
          "MakeMyLabs Transaction Hub is an enterprise platform for tracking transactions, labs, and cloud usage.",
      },
      { name: "author", content: "MakeMyLabs" },
      { property: "og:title", content: "MakeMyLabs" },
      {
        property: "og:description",
        content:
          "MakeMyLabs Transaction Hub is an enterprise platform for tracking transactions, labs, and cloud usage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "MakeMyLabs" },
      {
        name: "twitter:description",
        content:
          "MakeMyLabs Transaction Hub is an enterprise platform for tracking transactions, labs, and cloud usage.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1625c7df-01ef-4f5d-ac0c-099092a59381/id-preview-50f69a92--cf3e24da-03ad-433c-be90-bd7ad878f932.lovable.app-1782298634441.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/1625c7df-01ef-4f5d-ac0c-099092a59381/id-preview-50f69a92--cf3e24da-03ad-433c-be90-bd7ad878f932.lovable.app-1782298634441.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
      {/* SCRUM-128 (N10, R10): the app's only Toaster. Inside the :root theme like every portal;
          no richColors, so toasts use the theme surface. */}
      <Toaster closeButton position="top-right" />
    </QueryClientProvider>
  );
}
