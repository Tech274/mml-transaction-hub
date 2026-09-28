import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "../model-catalog";
import { PHASE1_TOOL_KEYS, TOOL_CATALOG } from "../tool-catalog";

const schema = readFileSync(
  resolve(__dirname, "../../../../supabase/migrations/20260928130000_scrum64_ai_agents_schema.sql"),
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
});
