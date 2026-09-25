import type { ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase-for-user";
import { makeError, type McpErrorCode } from "./errors";

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
};

/**
 * Wraps a tool handler so every invocation is logged to `mcp_tool_audit_log`
 * and errors are returned in a consistent structured shape. Also enforces
 * per-user client revocation from the Agent integrations page.
 */
export function withAudit<Input>(
  toolName: string,
  fn: (input: Input, ctx: ToolContext) => Promise<ToolResult>,
): (input: Input, ctx: ToolContext) => Promise<ToolResult> {
  return async (input, ctx) => {
    const started = Date.now();

    if (!ctx.isAuthenticated()) {
      return makeError("unauthenticated", "Sign in and reconnect this AI client.");
    }

    const userId = ctx.getUserId();
    if (!userId) return makeError("unauthenticated", "Missing user id in token.");
    const email = ctx.getUserEmail() ?? null;
    const clientId = ctx.getClientId() ?? null;
    const supabase = supabaseForUser(ctx);

    // Check revocation
    if (clientId) {
      const { data: revoked } = await supabase
        .from("mcp_revoked_clients")
        .select("client_id")
        .eq("user_id", userId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (revoked) {
        const result = makeError("revoked", "Client access revoked by user.");
        await logRow(supabase, {
          user_id: userId, user_email: email, client_id: clientId,
          tool_name: toolName, arguments: sanitize(input),
          success: false, error_code: "revoked",
          error_message: "Client access revoked by user.",
          duration_ms: Date.now() - started,
        });
        return result;
      }
    }

    let result: ToolResult;
    let errorCode: McpErrorCode | null = null;
    let errorMessage: string | null = null;

    try {
      result = await fn(input, ctx);
      if (result.isError) {
        const sc = result.structuredContent as { error?: { code?: string; message?: string } } | undefined;
        errorCode = (sc?.error?.code as McpErrorCode) ?? "internal";
        errorMessage = sc?.error?.message ?? result.content?.[0]?.text ?? "unknown error";
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const isNetwork = /fetch|network|ECONN|ETIMEDOUT|socket/i.test(message);
      result = makeError(isNetwork ? "network" : "internal", message);
      errorCode = isNetwork ? "network" : "internal";
      errorMessage = message;
    }

    // Best-effort audit insert; never fail the tool call because of it.
    await logRow(supabase, {
      user_id: userId,
      user_email: email,
      client_id: clientId,
      tool_name: toolName,
      arguments: sanitize(input),
      success: !result.isError,
      error_code: errorCode,
      error_message: errorMessage,
      duration_ms: Date.now() - started,
    });

    return result;
  };
}

function sanitize(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + "…";
    else out[k] = v;
  }
  return out;
}

async function logRow(
  supabase: ReturnType<typeof supabaseForUser>,
  row: {
    user_id: string;
    user_email: string | null;
    client_id: string | null;
    tool_name: string;
    arguments: Record<string, unknown>;
    success: boolean;
    error_code: string | null;
    error_message: string | null;
    duration_ms: number;
  },
) {
  try {
    // Types are regenerated after migration approval; cast until then.
    await supabase.from("mcp_tool_audit_log").insert(row as never);
  } catch {
    // swallow: audit must never break a tool call
  }
}
