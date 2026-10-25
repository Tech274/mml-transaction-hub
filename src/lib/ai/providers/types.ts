export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
}

export interface ChatRequest {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export interface ChatProvider {
  id: string;
  complete(req: ChatRequest): Promise<ModelTurn>;
}

export class ProviderHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`The model provider returned HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
  }
}
