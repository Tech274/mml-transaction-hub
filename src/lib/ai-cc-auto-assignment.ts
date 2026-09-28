import type { AgentKey } from "@/lib/ai-command-center.functions";

export type AiCcWorkType =
  | "publish"
  | "deploy"
  | "live_write"
  | "task_create"
  | "task_update"
  | "analysis"
  | "other";

export type AiCcWorker = {
  id: string;
  agent_key: AgentKey;
  is_active: boolean;
  current_load: number;
  last_assigned_at: string | null;
};

export const AI_CC_AUTO_ASSIGN_ENV_VAR = "AI_CC_AUTO_ASSIGN_ENABLED" as const;

/** Feature flag OFF by default. Only the exact string "true" enables assignment. */
export function isAiCcAutoAssignEnabled(env: Record<string, string | undefined>): boolean {
  return env[AI_CC_AUTO_ASSIGN_ENV_VAR] === "true";
}

/** Owner publish gate: live-impacting actions always require a human admin approval. */
export function requiresHumanApproval(workType: AiCcWorkType): boolean {
  return workType === "publish" || workType === "deploy" || workType === "live_write";
}

export function statusAfterPreparation(workType: AiCcWorkType): "prepared" | "needs_approval" {
  return requiresHumanApproval(workType) ? "needs_approval" : "prepared";
}

/**
 * Simple least-loaded assignment with deterministic tie-break:
 * 1) lower current load first
 * 2) older last assignment first (round-robin over time)
 * 3) stable id order
 */
export function pickWorkerForAssignment(
  workers: AiCcWorker[],
  requestedAgentKey?: AgentKey | null,
): AiCcWorker | null {
  const active = workers.filter(
    (worker) =>
      worker.is_active &&
      (requestedAgentKey == null || worker.agent_key === requestedAgentKey),
  );
  if (active.length === 0) return null;
  const ts = (iso: string | null): number => (iso == null ? Number.NEGATIVE_INFINITY : Date.parse(iso));
  active.sort((a, b) => {
    if (a.current_load !== b.current_load) return a.current_load - b.current_load;
    const byTime = ts(a.last_assigned_at) - ts(b.last_assigned_at);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
  return active[0];
}
