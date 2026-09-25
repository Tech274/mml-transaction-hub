// Structured MCP error codes shared by tools and clients.
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
