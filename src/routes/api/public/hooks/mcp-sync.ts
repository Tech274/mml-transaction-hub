import { createFileRoute } from "@tanstack/react-router";

// Scheduled snapshot pipeline. Called by pg_cron.
// Auth (SCRUM-89 / G-03): the `x-cron-secret` header must match the Vault
// secret `cron_secret`. The public `apikey` header is no longer accepted.
// Lives under /api/public/* so the scheduler can reach it on the published site.
// SCRUM-72: replies 202 at once; the snapshot runs in the background within
// HOOK_TIMEOUT_SECONDS (default 25). The outcome is recorded in sync_runs.
export const Route = createFileRoute("/api/public/hooks/mcp-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedCronRequest, unauthorizedResponse } = await import(
          "@/lib/cron-auth.server"
        );
        if (!(await isAuthorizedCronRequest(request))) return unauthorizedResponse();

        const { respondThenRun, hookTimeoutMsFromEnv } = await import("@/lib/background-hook");
        return respondThenRun(request, {
          name: "mcp-sync",
          timeoutMs: hookTimeoutMsFromEnv(process.env),
          run: async () => {
            const { runSnapshotSync } = await import("@/lib/sync.server");
            const result = await runSnapshotSync({ trigger_source: "cron" });
            return { ok: result.status === "success", body: result };
          },
        });
      },
    },
  },
});
