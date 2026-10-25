#!/usr/bin/env bash
# Opt-in live smoke for the AI provider adapter.
# OpenAI and Anthropic are primary: each key that is set gets one tiny call.
# Gemini and the OpenAI-compatible endpoint run only when neither primary key is set.
# Exits 0 without calling a vendor when no key is set.
# Never prints a key or a response body.
set -euo pipefail

if [[ -z "${OPENAI_API_KEY:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "${GEMINI_API_KEY:-}" && -z "${OPENAI_COMPAT_API_KEY:-}" ]]; then
  echo "No provider key is set. Live smoke skipped."
  exit 0
fi

node --experimental-strip-types <<'NODE'
const key = (name) => (process.env[name] ?? "").trim();

async function once(label, url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const secret = Object.values(headers).join(" ");
  if (secret && response.url.includes(secret)) {
    console.error(`${label} URL contained a credential`);
    process.exit(1);
  }
  console.log(`${label} HTTP ${response.status}`);
  if (!response.ok) process.exit(1);
}

const openaiOn = Boolean(key("OPENAI_API_KEY"));
const anthropicOn = Boolean(key("ANTHROPIC_API_KEY"));
const shared = openaiOn !== anthropicOn ? (process.env.AI_SMOKE_MODEL ?? "").trim() : "";
const openaiModel = (process.env.AI_SMOKE_OPENAI_MODEL ?? "").trim() || shared || "gpt-6-luna";
const anthropicModel = (process.env.AI_SMOKE_ANTHROPIC_MODEL ?? "").trim() || shared || "claude-haiku-4-5";

if (openaiOn) {
  await once(
    "openai",
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${key("OPENAI_API_KEY")}` },
    { model: openaiModel, messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 8 },
  );
}

if (anthropicOn) {
  await once(
    "anthropic",
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
    { model: anthropicModel, max_tokens: 8, messages: [{ role: "user", content: "Reply with the word ok." }] },
  );
}

if (openaiOn || anthropicOn) {
  process.exit(0);
}

const model = (process.env.AI_SMOKE_MODEL ?? "").trim();

if (key("GEMINI_API_KEY")) {
  const id = model || "gemini-3.8-flash";
  await once(
    "gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
    { "x-goog-api-key": key("GEMINI_API_KEY") },
    { contents: [{ role: "user", parts: [{ text: "Reply with the word ok." }] }], generationConfig: { maxOutputTokens: 8 } },
  );
} else if (key("OPENAI_COMPAT_API_KEY") && key("OPENAI_COMPAT_BASE_URL")) {
  const base = key("OPENAI_COMPAT_BASE_URL").replace(/\/$/, "");
  await once(
    "openai_compat",
    `${base}/chat/completions`,
    { Authorization: `Bearer ${key("OPENAI_COMPAT_API_KEY")}` },
    { model: model || "compat-default", messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 8 },
  );
} else {
  console.log("A compat key is set without OPENAI_COMPAT_BASE_URL. Live smoke skipped.");
}
NODE
