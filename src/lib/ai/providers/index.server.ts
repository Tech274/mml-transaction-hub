import type { ModelProviderId } from "../model-catalog";
import { anthropicProvider, geminiProvider, openAiProvider } from "./complete.server";
import { demoMockEnabled, readProviderSecrets } from "./env.server";
import { mockProvider } from "./mock";
import type { ChatProvider } from "./types";

/**
 * Picks a server-side provider. Returns null when that provider has no key.
 * In local demo mode (AI_AGENTS_DEMO=1) a mock is used instead of calling a vendor.
 * The returned object cannot reveal the key.
 */
export function resolveProvider(provider: ModelProviderId | "none"): ChatProvider | null {
  if (provider === "none") return null;
  const secrets = readProviderSecrets();
  if (provider === "openai" && secrets.openai) return openAiProvider({ apiKey: secrets.openai });
  if (provider === "anthropic" && secrets.anthropic) return anthropicProvider({ apiKey: secrets.anthropic });
  if (provider === "gemini" && secrets.gemini) return geminiProvider({ apiKey: secrets.gemini });
  if (provider === "openai_compat" && secrets.openaiCompatKey && secrets.openaiCompatBaseUrl) {
    return openAiProvider({ apiKey: secrets.openaiCompatKey, baseUrl: secrets.openaiCompatBaseUrl, id: "openai_compat" });
  }
  if (demoMockEnabled()) return mockProvider();
  return null;
}
