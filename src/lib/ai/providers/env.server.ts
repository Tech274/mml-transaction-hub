// Server-only. Keys are read here and nowhere else. Never log the return value.

export interface ProviderFlags {
  openai: boolean;
  anthropic: boolean;
  gemini: boolean;
  openai_compat: boolean;
}

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}

export function providerFlags(): ProviderFlags {
  return {
    openai: present(process.env.OPENAI_API_KEY),
    anthropic: present(process.env.ANTHROPIC_API_KEY),
    gemini: present(process.env.GEMINI_API_KEY),
    openai_compat: present(process.env.OPENAI_COMPAT_BASE_URL) && present(process.env.OPENAI_COMPAT_API_KEY),
  };
}

export function demoMockEnabled(): boolean {
  return process.env.AI_AGENTS_DEMO === "1";
}

/** For the adapter only. Callers must not log, store or return this object. */
export function readProviderSecrets(): {
  openai?: string;
  anthropic?: string;
  gemini?: string;
  openaiCompatBaseUrl?: string;
  openaiCompatKey?: string;
} {
  const trim = (value: string | undefined) => {
    const next = value?.trim();
    return next ? next : undefined;
  };
  return {
    openai: trim(process.env.OPENAI_API_KEY),
    anthropic: trim(process.env.ANTHROPIC_API_KEY),
    gemini: trim(process.env.GEMINI_API_KEY),
    openaiCompatBaseUrl: trim(process.env.OPENAI_COMPAT_BASE_URL),
    openaiCompatKey: trim(process.env.OPENAI_COMPAT_API_KEY),
  };
}
