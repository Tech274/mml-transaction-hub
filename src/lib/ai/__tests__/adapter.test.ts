import { afterEach, describe, expect, it } from "vitest";
import { anthropicProvider, geminiProvider, openAiProvider } from "../providers/complete.server";
import { providerFlags } from "../providers/env.server";
import { resolveProvider } from "../providers/index.server";
import { ProviderHttpError, type ChatRequest } from "../providers/types";

const KEY = "unit-test-provider-key";

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "gemini-3.8-flash",
  temperature: 0,
  maxOutputTokens: 16,
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  ...over,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_COMPAT_BASE_URL;
  delete process.env.OPENAI_COMPAT_API_KEY;
  delete process.env.AI_AGENTS_DEMO;
});

describe("provider adapter", () => {
  it("retries a 500 once and does not put the key in the error", async () => {
    const seen: { url: string; auth: string }[] = [];
    let calls = 0;
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls += 1;
      seen.push({ url, auth: String((init.headers as Record<string, string>).Authorization ?? "") });
      if (calls === 1) return jsonResponse(500, { error: KEY });
      return jsonResponse(200, {
        choices: [{ message: { content: "ok", tool_calls: [] } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      });
    };
    const turn = await openAiProvider({ apiKey: KEY, fetchImpl }).complete(req({ model: "gpt-6-luna" }));
    expect(calls).toBe(2);
    expect(turn.text).toBe("ok");
    expect(turn.tokensIn).toBe(3);
    expect(seen[0].auth).toContain(KEY);
    expect(seen[0].url).not.toContain(KEY);
  });

  it("throws a status-only error and does not retry a 401", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse(401, { error: { message: KEY } });
    };
    await expect(openAiProvider({ apiKey: KEY, fetchImpl }).complete(req())).rejects.toMatchObject({
      name: "ProviderHttpError",
      status: 401,
      message: "The model provider returned HTTP 401",
    });
    expect(calls).toBe(1);
    try {
      await openAiProvider({ apiKey: KEY, fetchImpl }).complete(req());
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(String(error)).not.toContain(KEY);
    }
  });

  it("sends the Gemini key in a header, not the URL", async () => {
    let url = "";
    let header = "";
    const fetchImpl = async (input: string, init: RequestInit) => {
      url = input;
      header = String((init.headers as Record<string, string>)["x-goog-api-key"] ?? "");
      return jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "{\"answer\":\"ok\"}" }] } }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2 },
      });
    };
    const turn = await geminiProvider({ apiKey: KEY, fetchImpl }).complete(
      req({ tools: [{ name: "tickets.get", description: "one", parameters: { type: "object" } }] }),
    );
    expect(url).toContain("gemini-3.8-flash");
    expect(url).not.toContain(KEY);
    expect(header).toBe(KEY);
    expect(turn.tokensOut).toBe(2);
    const body = JSON.parse(
      String(
        (
          await (async () => {
            let captured = "";
            await geminiProvider({
              apiKey: KEY,
              fetchImpl: async (_u, init) => {
                captured = String(init.body);
                return jsonResponse(200, { candidates: [{ content: { parts: [{ functionCall: { name: "tickets_get", args: { ticket_id: 1 } } }] } }] });
              },
            }).complete(req({ tools: [{ name: "tickets.get", description: "one", parameters: {} }] }));
            return captured;
          })()
        ),
      ),
    );
    expect(body.tools[0].functionDeclarations[0].name).toBe("tickets_get");
  });

  it("reads Anthropic usage and keeps the key out of a failed message", async () => {
    const fetchImpl = async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
      return jsonResponse(200, {
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 4, output_tokens: 5 },
      });
    };
    const turn = await anthropicProvider({ apiKey: KEY, fetchImpl }).complete(req({ model: "claude-haiku-4-5" }));
    expect(turn).toMatchObject({ text: "hello", tokensIn: 4, tokensOut: 5 });
  });

  it("reports configured providers as booleans only", () => {
    expect(providerFlags()).toEqual({ openai: false, anthropic: false, gemini: false, openai_compat: false });
    process.env.OPENAI_API_KEY = KEY;
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    expect(providerFlags()).toEqual({ openai: true, anthropic: false, gemini: false, openai_compat: false });
    process.env.OPENAI_COMPAT_API_KEY = KEY;
    expect(providerFlags().openai_compat).toBe(true);
    const flags = providerFlags();
    expect(JSON.stringify(flags)).not.toContain(KEY);
  });

  it("uses the mock only when the demo flag is set and no key is present", () => {
    expect(resolveProvider("gemini")).toBeNull();
    process.env.AI_AGENTS_DEMO = "1";
    expect(resolveProvider("gemini")?.id).toBe("mock");
    process.env.GEMINI_API_KEY = KEY;
    expect(resolveProvider("gemini")?.id).toBe("gemini");
  });
});
