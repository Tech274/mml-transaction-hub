import { createFileRoute } from "@tanstack/react-router";

// Scheduled Freshdesk ticket sync. Called by pg_cron.
// Auth (SCRUM-89 / G-03): the `x-cron-secret` header must match the Vault
// secret `cron_secret`. The public `apikey` header is no longer accepted.
// The request body is ignored: callers can no longer choose `maxPages`.
// SCRUM-72: replies 202 at once; the sync runs in the background within
// HOOK_TIMEOUT_SECONDS (default 25). The outcome is recorded in sync_runs.
export const Route = createFileRoute("/api/public/hooks/freshdesk-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedCronRequest, unauthorizedResponse } = await import(
          "@/lib/cron-auth.server"
        );
        if (!(await isAuthorizedCronRequest(request))) return unauthorizedResponse();

        const { respondThenRun, hookTimeoutMsFromEnv } = await import("@/lib/background-hook");
        return respondThenRun(request, {
          name: "freshdesk-sync",
          timeoutMs: hookTimeoutMsFromEnv(process.env),
          run: async (deadline) => {
            const { runFreshdeskSync } = await import("@/lib/freshdesk.server");
            // SCRUM-74: recorded in sync_runs (kind = 'freshdesk', trigger_source = 'cron').
            const result = await runFreshdeskSync({ trigger_source: "cron", deadline });
            return { ok: result.status === "success", body: result };
          },
        });
      },
    },
  },
});
