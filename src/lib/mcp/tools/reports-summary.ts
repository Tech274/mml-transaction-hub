import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { withAudit } from "../audit";
import { makeError, toolDbError } from "../errors";

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
  handler: withAudit("reports_summary", async ({ year, cloud_provider, line_of_business }, ctx) => {
    const { supabaseForUser } = await import("../supabase-for-user");
    const supabase = supabaseForUser(ctx);
    const build = () => {
      let q = supabase
        .from("transactions")
        .select(
          "selling_cost, input_cost, input_cost_auto, input_cost_actual_alloc, total_users, start_date, cloud_provider, line_of_business",
        )
        .eq("is_deleted", false)
        .gte("start_date", `${year}-01-01`)
        .lte("start_date", `${year}-12-31`);
      if (cloud_provider) q = q.eq("cloud_provider", cloud_provider);
      if (line_of_business) q = q.eq("line_of_business", line_of_business);
      return q.order("id");
    };
    type Row = {
      selling_cost: number | null;
      input_cost: number | null;
      input_cost_auto?: number | null;
      input_cost_actual_alloc?: number | null;
      total_users: number | null;
    };
    let rows: Row[];
    try {
      // SCRUM-70: all matching rows, not just the first 1,000.
      const { readAllRows } = await import("../../read-all");
      rows = await readAllRows<Row>(build, "reports_summary");
    } catch (e) {
      return toolDbError(e, "mcp.reports_summary");
    }
    if (rows.length === 0) {
      return makeError("empty_result", `No transactions found for ${year}.`, {
        hint: "Try a different year or clear filters.",
      });
    }
    const { addNullable } = await import("../../nullable-sum");
    const { effectiveCost } = await import("../../cost-calculator");
    const revenue = rows.reduce((a, r) => addNullable(a, r.selling_cost), 0);
    const cost = rows.reduce((a, r) => addNullable(a, effectiveCost(r).amount), 0);
    const users = rows.reduce((a, r) => addNullable(a, r.total_users), 0);
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
  }),
});
