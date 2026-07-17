import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "reports_summary",
  title: "Reports summary",
  description:
    "Return aggregate totals (revenue, input cost, profit, margin %, transaction count, user count) for a given year, optionally filtered by cloud_provider and line_of_business.",
  inputSchema: {
    year: z.number().int().min(2000).max(2100),
    cloud_provider: z.string().optional(),
    line_of_business: z.enum(["VILT", "Standalone", "Integrated"]).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ year, cloud_provider, line_of_business }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { supabaseForUser } = await import("../supabase-for-user");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("transactions")
      .select("selling_cost, input_cost, users, start_date, cloud_provider, line_of_business")
      .gte("start_date", `${year}-01-01`)
      .lte("start_date", `${year}-12-31`);
    if (cloud_provider) q = q.eq("cloud_provider", cloud_provider);
    if (line_of_business) q = q.eq("line_of_business", line_of_business);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    const revenue = rows.reduce((a, r) => a + Number(r.selling_cost ?? 0), 0);
    const cost = rows.reduce((a, r) => a + Number(r.input_cost ?? 0), 0);
    const users = rows.reduce((a, r) => a + Number(r.users ?? 0), 0);
    const profit = revenue - cost;
    const margin_pct = revenue > 0 ? (profit / revenue) * 100 : 0;
    const summary = {
      year,
      cloud_provider: cloud_provider ?? null,
      line_of_business: line_of_business ?? null,
      transactions: rows.length,
      users,
      revenue,
      input_cost: cost,
      profit,
      margin_pct: Math.round(margin_pct * 100) / 100,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});