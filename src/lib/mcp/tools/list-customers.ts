import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { withAudit } from "../audit";
import { makeError } from "../errors";

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
  handler: withAudit("list_customers", async ({ search, limit }, ctx) => {
    const { supabaseForUser } = await import("../supabase-for-user");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("customers")
      .select("id, customer_name, account_manager_name, industry, is_active")
      .eq("is_active", true)
      .order("customer_name")
      .limit(limit ?? 50);
    if (search) q = q.ilike("customer_name", `%${search}%`);
    const { data, error } = await q;
    if (error) {
      const isPerm = /permission|denied|rls/i.test(error.message);
      return makeError(isPerm ? "permission_denied" : "internal", error.message);
    }
    if (!data || data.length === 0) {
      return makeError("empty_result", "No customers match your filters.", {
        hint: search ? `Try a shorter or different search term.` : "You may not have any customers visible under your role.",
      });
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { customers: data },
    };
  }),
});
