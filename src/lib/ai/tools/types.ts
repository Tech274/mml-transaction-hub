export interface ReadFilter {
  column: string;
  op: "eq" | "in" | "gte" | "lte" | "ilike";
  value: unknown;
}

export interface ReadRequest {
  table: string;
  columns: string;
  filters: ReadFilter[];
  limit: number;
  order?: { column: string; ascending: boolean };
}

export interface UserDataAccess {
  read(req: ReadRequest): Promise<{ rows: Record<string, unknown>[]; error?: string }>;
}

export const TOOL_TABLES = ["freshdesk_tickets", "customers", "transactions", "sync_runs"] as const;

export interface ConversationMessage {
  body_text: string | null;
  from_email: string | null;
}

export interface ToolContext {
  access: UserDataAccess;
  roles: readonly string[];
  moneyVisible: boolean;
  pinnedCompany: string | null;
  fetchConversations?: (ticketId: number) => Promise<ConversationMessage[]>;
}

export interface ToolOutcome {
  access: "rows" | "no_access" | "no_rows" | "invalid" | "pinned" | "error";
  rowCount: number;
  /** What the model is allowed to see. */
  forModel: unknown;
  company: string | null;
  /** Filled by the server for the inbox draft. Never sent to the model. */
  recipient: string | null;
  ticketId: number | null;
  message: string;
  untrusted: boolean;
}
