import { createFileRoute } from "@tanstack/react-router";

// Scheduled Freshdesk ticket sync. Called by the scheduler with the `apikey` header.
export const Route = createFileRoute("/api/public/hooks/freshdesk-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("Apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Unauthorized", { status: 401 });
        }
        let sinceDays = 7;
        let maxPages: number | undefined;
        try {
          const body = (await request.json()) as { sinceDays?: number; maxPages?: number };
          if (typeof body?.sinceDays === "number") sinceDays = body.sinceDays;
          if (typeof body?.maxPages === "number") maxPages = body.maxPages;
        } catch {
          /* empty body is fine */
        }
        const { runFreshdeskSync } = await import("@/lib/freshdesk.server");
        const result = await runFreshdeskSync({ sinceDays, ...(maxPages ? { maxPages } : {}) });
        return new Response(JSON.stringify(result), {
          status: result.status === "success" ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
