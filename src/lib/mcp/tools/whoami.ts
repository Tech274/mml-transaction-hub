import { defineTool } from "@lovable.dev/mcp-js";
import { withAudit } from "../audit";
import { makeError } from "../errors";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description: "Return the signed-in user's id, email, and app roles.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withAudit("whoami", async (_input, ctx) => {
    const { supabaseForUser } = await import("../supabase-for-user");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", ctx.getUserId());
    if (error) return makeError("internal", error.message);
    const info = {
      user_id: ctx.getUserId(),
      email: ctx.getUserEmail(),
      roles: (data ?? []).map((r) => r.role),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      structuredContent: info,
    };
  }),
});