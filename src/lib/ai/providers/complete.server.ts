import { ProviderHttpError, type ChatProvider, type ChatRequest, type ModelTurn, type ToolCall } from "./types";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 45_000;

async function callOnce(fetchImpl: FetchLike, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signalUsed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let last: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl(url, { ...init, signal: signalUsed });
    if (response.status !== 429 && response.status < 500) return response;
    last = response;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last as Response;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function openAiProvider(opts: { apiKey: string; baseUrl?: string; fetchImpl?: FetchLike; id?: string }): ChatProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    id: opts.id ?? "openai",
    async complete(req: ChatRequest): Promise<ModelTurn> {
      const response = await callOnce(
        fetchImpl,
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: req.model,
            temperature: req.temperature,
            max_tokens: req.maxOutputTokens,
            messages: req.messages.map((message) => ({
              role: message.role === "tool" ? "tool" : message.role,
              content: message.content,
              tool_call_id: message.toolCallId,
            })),
            tools: req.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
          }),
        },
        req.signal,
      );
      if (!response.ok) throw new ProviderHttpError(response.status);
      const body = asObject(await response.json());
      const choice = asObject((body.choices as unknown[] | undefined)?.[0]);
      const message = asObject(choice.message);
      const usage = asObject(body.usage);
      const toolCalls: ToolCall[] = Array.isArray(message.tool_calls)
        ? message.tool_calls.map((call) => {
            const row = asObject(call);
            const fn = asObject(row.function);
            return { id: String(row.id ?? "call"), name: String(fn.name ?? ""), arguments: parseArgs(fn.arguments) };
          })
        : [];
      return {
        text: typeof message.content === "string" ? message.content : "",
        toolCalls: toolCalls.filter((call) => call.name),
        tokensIn: Number(usage.prompt_tokens ?? 0),
        tokensOut: Number(usage.completion_tokens ?? 0),
      };
    },
  };
}

export function anthropicProvider(opts: { apiKey: string; fetchImpl?: FetchLike }): ChatProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: "anthropic",
    async complete(req: ChatRequest): Promise<ModelTurn> {
      const system = req.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
      const messages = req.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.role === "tool" ? `Tool ${message.toolCallId ?? ""} result:\n${message.content}` : message.content,
        }));
      const response = await callOnce(
        fetchImpl,
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: req.model,
            max_tokens: req.maxOutputTokens,
            temperature: req.temperature,
            system,
            messages,
            tools: req.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }),
        },
        req.signal,
      );
      if (!response.ok) throw new ProviderHttpError(response.status);
      const body = asObject(await response.json());
      const blocks = Array.isArray(body.content) ? body.content : [];
      const text = blocks
        .map((block) => asObject(block))
        .filter((block) => block.type === "text")
        .map((block) => String(block.text ?? ""))
        .join("\n");
      const toolCalls: ToolCall[] = blocks
        .map((block) => asObject(block))
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: String(block.id ?? "call"),
          name: String(block.name ?? ""),
          arguments: parseArgs(block.input),
        }))
        .filter((call) => call.name);
      const usage = asObject(body.usage);
      return {
        text,
        toolCalls,
        tokensIn: Number(usage.input_tokens ?? 0),
        tokensOut: Number(usage.output_tokens ?? 0),
      };
    },
  };
}

export function geminiProvider(opts: { apiKey: string; fetchImpl?: FetchLike }): ChatProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: "gemini",
    async complete(req: ChatRequest): Promise<ModelTurn> {
      const system = req.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
      const contents = req.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.role === "tool" ? `Tool result:\n${message.content}` : message.content }],
        }));
      const response = await callOnce(
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": opts.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            contents,
            tools: req.tools.length
              ? [{
                  functionDeclarations: req.tools.map((tool) => ({
                    name: tool.name.replace(/\./g, "_"),
                    description: tool.description,
                    parameters: tool.parameters,
                  })),
                }]
              : undefined,
            generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxOutputTokens },
          }),
        },
        req.signal,
      );
      if (!response.ok) throw new ProviderHttpError(response.status);
      const body = asObject(await response.json());
      const candidate = asObject((body.candidates as unknown[] | undefined)?.[0]);
      const parts = Array.isArray(asObject(candidate.content).parts) ? (asObject(candidate.content).parts as unknown[]) : [];
      const text = parts.map((part) => String(asObject(part).text ?? "")).join("\n");
      const toolCalls: ToolCall[] = parts
        .map((part) => asObject(asObject(part).functionCall))
        .filter((call) => call.name)
        .map((call) => ({
          id: `call_${String(call.name)}`,
          name: String(call.name).replace(/_/g, "."),
          arguments: parseArgs(call.args),
        }));
      const usage = asObject(body.usageMetadata);
      return {
        text,
        toolCalls,
        tokensIn: Number(usage.promptTokenCount ?? 0),
        tokensOut: Number(usage.candidatesTokenCount ?? 0),
      };
    },
  };
}
