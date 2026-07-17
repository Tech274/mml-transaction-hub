import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description:
    "List transactions visible to the signed-in user. Optional filters: customer_id, lab_type (public/private), cloud_provider, line_of_business, and start/end date (YYYY-MM-DD) on start_date. Returns up to `limit` rows (max 200).",
  inputSchema: {
    customer_id: z.string().uuid().optional(),
    lab_type: z.enum(["public", "private"]).optional(),
    cloud_provider: z.string().optional(),
    line_of_business: z.enum(["VILT", "Standalone", "Integrated"]).optional(),
    start_date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    start_date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { supabaseForUser } = await import("../supabase-for-user");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("transactions")
      .select(
        "id, potential_id, customer_id, lab_type, cloud_provider, line_of_business, start_date, end_date, users, selling_cost, input_cost",
      )
      .order("start_date", { ascending: false })
      .limit(input.limit ?? 50);
    if (input.customer_id) q = q.eq("customer_id", input.customer_id);
    if (input.lab_type) q = q.eq("lab_type", input.lab_type);
    if (input.cloud_provider) q = q.eq("cloud_provider", input.cloud_provider);
    if (input.line_of_business) q = q.eq("line_of_business", input.line_of_business);
    if (input.start_date_from) q = q.gte("start_date", input.start_date_from);
    if (input.start_date_to) q = q.lte("start_date", input.start_date_to);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { transactions: data },
    };
  },
});