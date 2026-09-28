import { describe, expect, it } from "vitest";
import { evalGate, runBuiltinEval } from "../evals";
import { runModelLoop } from "../engine";
import { mockProvider } from "../providers/mock";
import { ProviderHttpError } from "../providers/types";
import type { UserDataAccess } from "../tools/types";

const emptyAccess: UserDataAccess = { async read() { return { rows: [] }; } };

describe("model loop", () => {
  it("passes the built-in structural eval for both seeded model agents", async () => {
    const triage = await runBuiltinEval("ticket_triage");
    const qa = await runBuiltinEval("dashboard_qa");
    const failed = [...triage.results, ...qa.results].filter((item) => !item.pass);
    expect(failed).toEqual([]);
    expect(evalGate(triage)).toBe(true);
    expect(evalGate(qa)).toBe(true);
  });

  it("stops before the next model call when the kill switch flips", async () => {
    let checks = 0;
    const result = await runModelLoop({
      provider: mockProvider(),
      agentKey: "ticket_triage",
      purpose: "Ticket triage",
      instructions: "Follow the safety rules.",
      model: "mock",
      temperature: 0,
      maxOutputTokens: 200,
      outputTypes: ["triage_note", "email_draft"],
      toolKeys: ["tickets.get"],
      userText: "Ticket 9001001 cannot access the lab portal",
      price: { inputPerMtokUsd: 0, outputPerMtokUsd: 0 },
      perRunCapUsd: 1,
      maxToolCalls: 6,
      maxTurns: 3,
      isEnabled: () => {
        checks += 1;
        return checks < 2;
      },
      allowMoney: false,
      toolContext: { access: emptyAccess, roles: ["ops_user"], moneyVisible: false, pinnedCompany: null },
    });
    expect(result.status).toBe("cancelled");
    expect(result.inbox).toEqual([]);
    expect(result.error).toContain("kill switch");
  });

  it("records a 402 as a breaker trip and writes nothing to the inbox", async () => {
    const result = await runModelLoop({
      provider: {
        id: "mock",
        async complete() {
          throw new ProviderHttpError(402);
        },
      },
      agentKey: "dashboard_qa",
      purpose: "Dashboard Q&A",
      instructions: "Answer from tools.",
      model: "mock",
      temperature: 0,
      maxOutputTokens: 50,
      outputTypes: ["qa_answer"],
      toolKeys: [],
      userText: "How many transactions?",
      price: { inputPerMtokUsd: 0, outputPerMtokUsd: 0 },
      perRunCapUsd: 1,
      maxToolCalls: 1,
      maxTurns: 1,
      isEnabled: () => true,
      allowMoney: true,
      toolContext: { access: emptyAccess, roles: ["admin"], moneyVisible: true, pinnedCompany: null },
    });
    expect(result.status).toBe("error");
    expect(result.tripBreaker).toBe(true);
    expect(result.inbox).toEqual([]);
    expect(result.error).toBe("The model provider returned HTTP 402");
  });
});
