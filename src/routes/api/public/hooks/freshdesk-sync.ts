import { createFileRoute } from "@tanstack/react-router";

// Scheduled Freshdesk ticket sync. Called by pg_cron.
// Auth (SCRUM-89 / G-03): the `x-cron-secret` header must match the Vault
// secret `cron_secret`. The public `apikey` header is no longer accepted.
// The request body is ignored: callers can no longer choose `maxPages`.
export const Route = createFileRoute("/api/public/hooks/freshdesk-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedCronRequest, unauthorizedResponse } = await import(
          "@/lib/cron-auth.server"
        );
        if (!(await isAuthorizedCronRequest(request))) return unauthorizedResponse();

        const { runFreshdeskSync } = await import("@/lib/freshdesk.server");
        const result = await runFreshdeskSync();

        return new Response(JSON.stringify(result), {
          status: result.status === "success" ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
