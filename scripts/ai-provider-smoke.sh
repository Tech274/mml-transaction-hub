#!/usr/bin/env bash
# Opt-in live smoke for the AI provider adapter.
# Exits 0 without calling a vendor when no key is set.
# Never prints a key or a response body.
set -euo pipefail

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${GEMINI_API_KEY:-}" && -z "${OPENAI_COMPAT_API_KEY:-}" ]]; then
  echo "No provider key is set. Live smoke skipped."
  exit 0
fi

node --experimental-strip-types <<'NODE'
const key = (name) => (process.env[name] ?? "").trim();

async function once(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const secret = Object.values(headers).join(" ");
  if (secret && response.url.includes(secret)) {
    console.error("provider URL contained a credential");
    process.exit(1);
  }
  console.log(`provider HTTP ${response.status}`);
  if (!response.ok) process.exit(1);
}

const model = process.env.AI_SMOKE_MODEL;

if (key("GEMINI_API_KEY")) {
  const id = model || "gemini-3.8-flash";
  await once(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
    { "x-goog-api-key": key("GEMINI_API_KEY") },
    { contents: [{ role: "user", parts: [{ text: "Reply with the word ok." }] }], generationConfig: { maxOutputTokens: 8 } },
  );
} else if (key("OPENAI_API_KEY")) {
  await once(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${key("OPENAI_API_KEY")}` },
    { model: model || "gpt-6-luna", messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 8 },
  );
} else if (key("ANTHROPIC_API_KEY")) {
  await once(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
    { model: model || "claude-haiku-4-5", max_tokens: 8, messages: [{ role: "user", content: "Reply with the word ok." }] },
  );
} else if (key("OPENAI_COMPAT_API_KEY") && key("OPENAI_COMPAT_BASE_URL")) {
  const base = key("OPENAI_COMPAT_BASE_URL").replace(/\/$/, "");
  await once(
    `${base}/chat/completions`,
    { Authorization: `Bearer ${key("OPENAI_COMPAT_API_KEY")}` },
    { model: model || "compat-default", messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 8 },
  );
} else {
  console.log("A compat key is set without OPENAI_COMPAT_BASE_URL. Live smoke skipped.");
}
NODE
