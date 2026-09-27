import type { ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase-for-user";
import { makeError, type McpErrorCode } from "./errors";
import { logError, logIfError } from "../app-error";
import { redactArguments } from "./redact";

export const REVOCATION_CHECK_FAILED = "Could not confirm this AI client is still allowed. Please try again.";

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

    // Check revocation. SCRUM-59: fail closed. If the lookup fails we can't tell whether the
    // user disconnected this client, so the tool does not run (it used to run anyway).
    if (clientId) {
      const { data: revoked, error: revokedErr } = await supabase
        .from("mcp_revoked_clients")
        .select("client_id")
        .eq("user_id", userId)
        .eq("client_id", clientId)
        .maybeSingle();
      if (revokedErr) {
        const ref = logError(revokedErr, "mcp.audit:revocation_check", { tool: toolName });
        const message = `${REVOCATION_CHECK_FAILED} (ref ${ref})`;
        await logRow(supabase, {
          user_id: userId, user_email: email, client_id: clientId,
          tool_name: toolName, arguments: redactArguments(input),
          success: false, error_code: "internal", error_message: message,
          duration_ms: Date.now() - started,
        });
        return makeError("internal", message);
      }
      if (revoked) {
        const result = makeError("revoked", "Client access revoked by user.");
        await logRow(supabase, {
          user_id: userId, user_email: email, client_id: clientId,
          tool_name: toolName, arguments: redactArguments(input),
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
      // SCRUM-59: the raw text stays in the server log and the admin-only audit row;
      // the AI client gets a generic message with a ref.
      const ref = logError(e, `mcp.tool:${toolName}`);
      result = makeError(isNetwork ? "network" : "internal", `${isNetwork ? "Could not reach the database." : "Something went wrong."} (ref ${ref})`);
      errorCode = isNetwork ? "network" : "internal";
      errorMessage = message;
    }

    // Best-effort audit insert; never fail the tool call because of it.
    await logRow(supabase, {
      user_id: userId,
      user_email: email,
      client_id: clientId,
      tool_name: toolName,
      arguments: redactArguments(input),
      success: !result.isError,
      error_code: errorCode,
      error_message: errorMessage,
      duration_ms: Date.now() - started,
    });

    return result;
  };
}

async function logRow(
  _supabase: ReturnType<typeof supabaseForUser>,
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
  // Audit must never break a tool call, but a failed audit write must not be silent
  // either (SCRUM-96 / G-17): supabase-js returns { error } instead of throwing.
  // SCRUM-77: the row is written by the server (service role), not with the caller's token, so a
  // user can't add or shape audit rows through the API. user_id comes from the verified token.
  try {
    const { supabaseAdmin } = await import("../../integrations/supabase/client.server");
    // Types are regenerated after migration approval; cast until then.
    const res = await (supabaseAdmin as unknown as { from: (t: string) => { insert: (r: never) => PromiseLike<{ error: unknown }> } })
      .from("mcp_tool_audit_log")
      .insert(row as never);
    logIfError(res, `mcp.audit:${row.tool_name}`);
  } catch (e) {
    logError(e, `mcp.audit:${row.tool_name}`);
  }
}
