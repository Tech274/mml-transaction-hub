// One list of approved models. The builder, the price table and the adapter all read this.
// Prices are list prices cited in the Phase 1 scope (28 Sep 2026). Premium models need a recorded approval.

export type ModelProviderId = "openai" | "anthropic" | "gemini" | "openai_compat";

export interface CatalogModel {
  provider: ModelProviderId;
  id: string;
  label: string;
  inputPerMtokUsd: number;
  outputPerMtokUsd: number;
  premium: boolean;
  sourceUrl: string | null;
}

export const MODEL_CATALOG: readonly CatalogModel[] = [
  {
    provider: "gemini",
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    inputPerMtokUsd: 0.75,
    outputPerMtokUsd: 3.75,
    premium: false,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    provider: "gemini",
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    inputPerMtokUsd: 0.25,
    outputPerMtokUsd: 1.5,
    premium: false,
    sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  {
    provider: "openai",
    id: "gpt-6-luna",
    label: "GPT-6 Luna",
    inputPerMtokUsd: 0.1,
    outputPerMtokUsd: 0.5,
    premium: false,
    sourceUrl: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "openai",
    id: "gpt-6-sol",
    label: "GPT-6 Sol",
    inputPerMtokUsd: 2,
    outputPerMtokUsd: 10,
    premium: true,
    sourceUrl: "https://developers.openai.com/api/docs/pricing",
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    inputPerMtokUsd: 1,
    outputPerMtokUsd: 5,
    premium: false,
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    inputPerMtokUsd: 2,
    outputPerMtokUsd: 10,
    premium: true,
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  {
    provider: "openai_compat",
    id: "compat-default",
    label: "OpenAI-compatible default",
    inputPerMtokUsd: 0.15,
    outputPerMtokUsd: 0.6,
    premium: false,
    sourceUrl: null,
  },
];

export function modelsFor(provider: ModelProviderId): CatalogModel[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}

export function findModel(provider: string, id: string): CatalogModel | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.id === id);
}

export const PROVIDER_LABEL: Record<ModelProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openai_compat: "OpenAI-compatible",
};
