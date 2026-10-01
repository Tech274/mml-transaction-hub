import { describe, expect, it } from "vitest";
import { decideRun, shouldTripBreaker, type CapInput } from "../limits";

const base: CapInput = {
  agentsEnabled: true,
  perRunCapUsd: 0.1,
  monthlyCapUsd: 10,
  perAgentMonthCapUsd: 5,
  monthSpendUsd: 0,
  agentMonthSpendUsd: 0,
  agentDayRuns: 0,
  agentDayCap: 200,
  userHourRuns: 0,
  userHourCap: 30,
  runningNow: 0,
  maxConcurrent: 3,
  estimatedRunUsd: 0.01,
};

describe("caps and kill switch", () => {
  it("allows a run inside the default caps", () => {
    expect(decideRun(base)).toEqual({ ok: true });
  });

  it("stops when the kill switch is off", () => {
    expect(decideRun({ ...base, agentsEnabled: false })).toEqual({
      ok: false,
      status: "cancelled",
      reason: "AI agents are switched off by the kill switch.",
    });
  });

  it("refuses a fourth concurrent run", () => {
    expect(decideRun({ ...base, runningNow: 3 }).ok).toBe(false);
  });

  it("blocks when the overall monthly cap would be passed", () => {
    const decision = decideRun({ ...base, monthSpendUsd: 9.995, estimatedRunUsd: 0.01 });
    expect(decision).toMatchObject({ ok: false, status: "budget_blocked" });
  });

  it("blocks a single run over the per-run cap", () => {
    const decision = decideRun({ ...base, estimatedRunUsd: 0.2 });
    expect(decision).toMatchObject({
      ok: false,
      reason: "This run's estimated cost is over the per-run cap.",
    });
  });

  it("trips the breaker on HTTP 402 or five provider errors", () => {
    expect(shouldTripBreaker({ httpStatus: 402, recentProviderErrors: 0 })).toBe(true);
    expect(shouldTripBreaker({ recentProviderErrors: 5 })).toBe(true);
    expect(shouldTripBreaker({ httpStatus: 500, recentProviderErrors: 4 })).toBe(false);
  });
});
