import { createFileRoute } from "@tanstack/react-router";

// Scheduled snapshot pipeline. Called by pg_cron with the `apikey` header.
// Lives under /api/public/* so the scheduler can reach it on the published site.
export const Route = createFileRoute("/api/public/hooks/mcp-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
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
