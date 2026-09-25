import { createFileRoute } from "@tanstack/react-router";

// Scheduled snapshot pipeline. Called by pg_cron.
// Auth (SCRUM-89 / G-03): the `x-cron-secret` header must match the Vault
// secret `cron_secret`. The public `apikey` header is no longer accepted.
// Lives under /api/public/* so the scheduler can reach it on the published site.
export const Route = createFileRoute("/api/public/hooks/mcp-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedCronRequest, unauthorizedResponse } = await import(
          "@/lib/cron-auth.server"
        );
        if (!(await isAuthorizedCronRequest(request))) return unauthorizedResponse();

        const { runSnapshotSync } = await import("@/lib/sync.server");
        const result = await runSnapshotSync({ trigger_source: "cron" });
        return new Response(JSON.stringify(result), {
          status: result.status === "success" ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
