// Structured MCP error codes shared by tools and clients.
import { friendlyMessage, logError } from "../app-error";
export type McpErrorCode =
  | "unauthenticated"
  | "permission_denied"
  | "revoked"
  | "empty_result"
  | "network"
  | "invalid_input"
  | "internal";

export interface McpStructuredError {
  code: McpErrorCode;
  message: string;
  retryable: boolean;
  hint?: string;
}

export function makeError(
  code: McpErrorCode,
  message: string,
  opts: { retryable?: boolean; hint?: string } = {},
): {
  isError: true;
  content: [{ type: "text"; text: string }];
  structuredContent: { error: McpStructuredError };
} {
  const retryable = opts.retryable ?? (code === "network" || code === "internal");
  const err: McpStructuredError = { code, message, retryable, hint: opts.hint };
  const human =
    code === "unauthenticated"
      ? `Not authenticated. ${opts.hint ?? "Reconnect this AI client to the app to continue."}`
      : code === "permission_denied"
        ? `Permission denied. ${opts.hint ?? "Your role does not have access to this data."}`
        : code === "revoked"
          ? `This AI client's access was disconnected by the user. Reconnect from the Agent integrations page.`
          : code === "empty_result"
            ? `No matching records. ${opts.hint ?? "Try broadening filters or check the input values."}`
            : code === "network"
              ? `Network error talking to the backend. ${opts.hint ?? "Retry in a few seconds."}`
              : code === "invalid_input"
                ? `Invalid input. ${message}`
                : `Unexpected error: ${message}`;
  return {
    isError: true,
    content: [{ type: "text", text: human }],
    structuredContent: { error: err },
  };
}

/**
 * SCRUM-59 / SCRUM-96: turn a database error inside a tool into a structured MCP error without
 * sending raw database text (table, column, constraint names) to the AI client. The full error
 * is logged on the server with a ref.
 */
export function toolDbError(err: unknown, where: string) {
  const ref = logError(err, where);
  const msg = typeof (err as { message?: unknown })?.message === "string" ? (err as { message: string }).message : String(err);
  const code = (err as { code?: unknown })?.code;
  const isPerm = code === "42501" || /permission|denied|row-level security|rls/i.test(msg);
  return makeError(isPerm ? "permission_denied" : "internal", `${friendlyMessage(err)} (ref ${ref})`);
}
