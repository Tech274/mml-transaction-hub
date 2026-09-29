import { describe, expect, it } from "vitest";

const src = import.meta.glob(["/src/lib/ai-cc-work-items.functions.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const code = src["/src/lib/ai-cc-work-items.functions.ts"];

describe("AI Command Center work-item server flow", () => {
  it("keeps auto-assignment behind the feature flag", () => {
    expect(code).toContain("isAiCcAutoAssignEnabled(process.env)");
  });

  it("routes publish/deploy/live writes to needs_approval", () => {
    expect(code).toContain("statusAfterPreparation");
    expect(code).toContain("\"needs_approval\"");
  });

  it("claims worker load atomically through SQL RPC", () => {
    expect(code).toContain("claim_ai_cc_worker_slot");
    expect(code).toContain("release_ai_cc_worker_slot");
  });

  it("requires admin role for live-work approval", () => {
    expect(code).toContain("requireRole(ctx, [\"admin\"], \"Only admin can approve live AI work\")");
    expect(code).toContain("status: \"approved\"");
  });
});
