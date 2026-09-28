import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER, MODEL_CATALOG, PRIMARY_PROVIDERS, PROVIDER_ORDER } from "../model-catalog";
import { PHASE1_TOOL_KEYS, TOOL_CATALOG } from "../tool-catalog";

const schema = readFileSync(
  resolve(__dirname, "../../../../supabase/migrations/20260928130000_scrum64_ai_agents_schema.sql"),
  "utf8",
);
const seed = readFileSync(
  resolve(__dirname, "../../../../supabase/migrations/20260928130100_scrum64_ai_agents_seed.sql"),
  "utf8",
);

describe("catalog matches the migration seed", () => {
  it("lists the same Phase 1 tools", () => {
    expect(PHASE1_TOOL_KEYS).toEqual([
      "tickets.search",
      "tickets.get",
      "tickets.conversation",
      "customers.get",
      "reports.summary",
      "transactions.query",
      "sync.health",
    ]);
    for (const tool of TOOL_CATALOG) {
      expect(schema).toContain(`'${tool.key}'`);
    }
    expect(schema).not.toMatch(/'\s*(transaction_activity_log|customer_audit_log|role_audit_log|permission_audit_log)\s*'/);
  });

  it("lists the same model prices", () => {
    for (const model of MODEL_CATALOG) {
      const input = model.inputPerMtokUsd.toFixed(2);
      const output = model.outputPerMtokUsd.toFixed(2);
      expect(schema).toContain(`'${model.id}', '${model.provider}', ${input}, ${output}`);
    }
  });

  it("puts OpenAI and Anthropic first and seeds the model agents on those providers", () => {
    expect(PROVIDER_ORDER.slice(0, 2)).toEqual(["openai", "anthropic"]);
    expect(PRIMARY_PROVIDERS).toEqual(["openai", "anthropic"]);
    expect(DEFAULT_PROVIDER).toBe("openai");
    expect(DEFAULT_MODEL_ID).toBe("gpt-6-luna");
    expect(MODEL_CATALOG.slice(0, 2).map((model) => model.provider)).toEqual(["openai", "openai"]);
    expect(seed).toContain("'anthropic', 'claude-haiku-4-5'");
    expect(seed).toContain("'openai', 'gpt-6-luna'");
    expect(seed).not.toContain("gemini-3.8-flash");
  });
});
