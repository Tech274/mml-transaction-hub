import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "list_customers",
  title: "List customers",
  description:
    "List customers visible to the signed-in user, optionally filtered by a case-insensitive name substring. Returns up to `limit` rows (max 200).",
  inputSchema: {
    search: z.string().trim().optional().describe("Case-insensitive substring to match against customer name."),
    limit: z.number().int().min(1).max(200).optional().describe("Maximum rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { supabaseForUser } = await import("../supabase-for-user");
    const supabase = supabaseForUser(ctx);
    let q = supabase.from("customers").select("id, name, account_manager").order("name").limit(limit ?? 50);
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { customers: data },
    };
  },
});