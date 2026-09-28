export const DEFAULT_MONTHLY_CAP_USD = 10;
export const DEFAULT_PER_RUN_CAP_USD = 0.1;
export const DEFAULT_PER_AGENT_MONTH_CAP_USD = 5;
export const DEFAULT_DAY_RUNS = 200;
export const DEFAULT_USER_HOUR_RUNS = 30;
export const DEFAULT_MAX_CONCURRENT = 3;
export const DEFAULT_MAX_TOOL_CALLS = 6;
export const DEFAULT_MAX_TURNS = 3;

export interface CapInput {
  agentsEnabled: boolean;
  perRunCapUsd: number;
  monthlyCapUsd: number;
  perAgentMonthCapUsd: number;
  monthSpendUsd: number;
  agentMonthSpendUsd: number;
  agentDayRuns: number;
  agentDayCap: number;
  userHourRuns: number;
  userHourCap: number;
  runningNow: number;
  maxConcurrent: number;
  estimatedRunUsd: number;
}

export type CapDecision =
  | { ok: true }
  | { ok: false; status: "budget_blocked" | "cancelled"; reason: string };

export function decideRun(input: CapInput): CapDecision {
  if (!input.agentsEnabled) {
    return { ok: false, status: "cancelled", reason: "AI agents are switched off by the kill switch." };
  }
  if (input.runningNow >= input.maxConcurrent) {
    return { ok: false, status: "cancelled", reason: "Three runs are already in progress. Try again in a moment." };
  }
  if (input.userHourRuns >= input.userHourCap) {
    return { ok: false, status: "budget_blocked", reason: "You have reached the hourly run limit." };
  }
  if (input.agentDayRuns >= input.agentDayCap) {
    return { ok: false, status: "budget_blocked", reason: "This agent has reached its daily run limit." };
  }
  if (input.monthSpendUsd + input.estimatedRunUsd > input.monthlyCapUsd) {
    return { ok: false, status: "budget_blocked", reason: "The monthly cap for all agents has been reached." };
  }
  if (input.agentMonthSpendUsd + input.estimatedRunUsd > input.perAgentMonthCapUsd) {
    return { ok: false, status: "budget_blocked", reason: "This agent has reached its monthly cap." };
  }
  if (input.estimatedRunUsd > input.perRunCapUsd) {
    return { ok: false, status: "budget_blocked", reason: "This run's estimated cost is over the per-run cap." };
  }
  return { ok: true };
}

/** A 402 or five provider errors in a short window trips the kill switch. */
export function shouldTripBreaker(input: { httpStatus?: number; recentProviderErrors: number }): boolean {
  return input.httpStatus === 402 || input.recentProviderErrors >= 5;
}

export function costUsd(
  tokensIn: number,
  tokensOut: number,
  price: { inputPerMtokUsd: number; outputPerMtokUsd: number },
): number {
  return (tokensIn * price.inputPerMtokUsd + tokensOut * price.outputPerMtokUsd) / 1_000_000;
}

export function limitsFrom(raw: unknown): {
  perRunUsd: number;
  perDayRuns: number;
  perMonthUsd: number;
  maxToolCalls: number;
  maxTurns: number;
} {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (key: string, fallback: number) => {
    const value = Number(obj[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    perRunUsd: num("per_run_usd", DEFAULT_PER_RUN_CAP_USD),
    perDayRuns: num("per_day_runs", DEFAULT_DAY_RUNS),
    perMonthUsd: num("per_month_usd", DEFAULT_PER_AGENT_MONTH_CAP_USD),
    maxToolCalls: num("max_tool_calls", DEFAULT_MAX_TOOL_CALLS),
    maxTurns: num("max_turns", DEFAULT_MAX_TURNS),
  };
}
