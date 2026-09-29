import { describe, expect, it } from "vitest";
import {
  isAiCcAutoAssignEnabled,
  pickWorkerForAssignment,
  requiresHumanApproval,
  statusAfterPreparation,
  type AiCcWorker,
} from "@/lib/ai-cc-auto-assignment";

const workers: AiCcWorker[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    agent_key: "generalist",
    is_active: true,
    current_load: 2,
    last_assigned_at: "2026-09-28T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    agent_key: "generalist",
    is_active: true,
    current_load: 1,
    last_assigned_at: "2026-09-28T11:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    agent_key: "support",
    is_active: true,
    current_load: 1,
    last_assigned_at: "2026-09-28T08:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    agent_key: "support",
    is_active: false,
    current_load: 0,
    last_assigned_at: null,
  },
];

describe("feature flag", () => {
  it("is off unless the exact string true is set", () => {
    expect(isAiCcAutoAssignEnabled({})).toBe(false);
    expect(isAiCcAutoAssignEnabled({ AI_CC_AUTO_ASSIGN_ENABLED: "TRUE" })).toBe(false);
    expect(isAiCcAutoAssignEnabled({ AI_CC_AUTO_ASSIGN_ENABLED: "1" })).toBe(false);
    expect(isAiCcAutoAssignEnabled({ AI_CC_AUTO_ASSIGN_ENABLED: "true" })).toBe(true);
  });
});

describe("worker assignment", () => {
  it("picks the least-loaded active worker", () => {
    const picked = pickWorkerForAssignment(workers);
    expect(picked?.id).toBe("00000000-0000-4000-8000-000000000003");
  });

  it("respects requested agent key", () => {
    const picked = pickWorkerForAssignment(workers, "generalist");
    expect(picked?.id).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("uses oldest assignment timestamp as tie-break", () => {
    const tie: AiCcWorker[] = [
      {
        id: "a",
        agent_key: "generalist",
        is_active: true,
        current_load: 3,
        last_assigned_at: "2026-09-28T12:00:00.000Z",
      },
      {
        id: "b",
        agent_key: "generalist",
        is_active: true,
        current_load: 3,
        last_assigned_at: "2026-09-28T07:00:00.000Z",
      },
    ];
    expect(pickWorkerForAssignment(tie)?.id).toBe("b");
  });

  it("returns null when no active worker matches", () => {
    expect(pickWorkerForAssignment(workers, "cost_adr")).toBeNull();
  });
});

describe("approval gate", () => {
  it("forces publish/deploy/live_write through needs_approval", () => {
    expect(requiresHumanApproval("publish")).toBe(true);
    expect(requiresHumanApproval("deploy")).toBe(true);
    expect(requiresHumanApproval("live_write")).toBe(true);
    expect(statusAfterPreparation("publish")).toBe("needs_approval");
  });

  it("marks non-live tasks as assigned without the approval gate", () => {
    expect(requiresHumanApproval("task_create")).toBe(false);
    expect(requiresHumanApproval("analysis")).toBe(false);
    expect(statusAfterPreparation("task_create")).toBe("assigned");
  });
});
