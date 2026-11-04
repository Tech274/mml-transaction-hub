// SCRUM-128 C6: the Agents summary's data shaping, moved verbatim out of agents-summary.tsx
// (plan R1). buildAgentsSummary is the former queryFn body.
import { AGENTS, type AgentSummary } from "@/lib/ai-command-center.functions";

export type InboxRow = {
  id: string;
  agent_key: string;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
  decided_at: string | null;
};

export type RunRow = {
  id: string;
  agent_key: string;
  status: string;
  created_at: string;
  finished_at: string | null;
};

export const EXAMPLE_AGENTS: AgentSummary[] = [
  {
    key: "generalist",
    name: "Generalist (Lab Solution Guide)",
    blurb: "Drafts lab solution guides and response emails.",
    capabilities: [],
    status: "needs confirm",
    pending: 2,
    last_run_at: "2026-09-29T05:22:00Z",
    owns_email_draft: true,
  },
  {
    key: "support",
    name: "Support desk",
    blurb: "Reviews open support tickets and drafts next actions.",
    capabilities: [],
    status: "running",
    pending: 3,
    last_run_at: "2026-09-29T05:31:00Z",
    owns_email_draft: true,
  },
  {
    key: "cost_adr",
    name: "Cost / ADR entry",
    blurb: "Maps confirmed requests into ADR-ready field suggestions.",
    capabilities: [],
    status: "idle",
    pending: 1,
    last_run_at: "2026-09-29T04:55:00Z",
    owns_email_draft: false,
  },
];

export const EXAMPLE_RUNS: RunRow[] = [
  {
    id: "run-901",
    agent_key: "support",
    status: "done",
    created_at: "2026-09-29T05:31:00Z",
    finished_at: "2026-09-29T05:31:28Z",
  },
  {
    id: "run-902",
    agent_key: "generalist",
    status: "done",
    created_at: "2026-09-29T05:21:00Z",
    finished_at: "2026-09-29T05:21:35Z",
  },
  {
    id: "run-903",
    agent_key: "cost_adr",
    status: "done",
    created_at: "2026-09-29T04:55:00Z",
    finished_at: "2026-09-29T04:55:17Z",
  },
  {
    id: "run-904",
    agent_key: "support",
    status: "error",
    created_at: "2026-09-28T12:11:00Z",
    finished_at: "2026-09-28T12:11:19Z",
  },
];

export const EXAMPLE_INBOX: InboxRow[] = [
  {
    id: "inb-1",
    agent_key: "support",
    status: "pending",
    created_at: "2026-09-29T05:31:14Z",
    decided_at: null,
  },
  {
    id: "inb-2",
    agent_key: "support",
    status: "confirmed",
    created_at: "2026-09-29T05:11:14Z",
    decided_at: "2026-09-29T05:15:14Z",
  },
  {
    id: "inb-3",
    agent_key: "generalist",
    status: "confirmed",
    created_at: "2026-09-29T04:41:14Z",
    decided_at: "2026-09-29T04:45:14Z",
  },
  {
    id: "inb-4",
    agent_key: "cost_adr",
    status: "rejected",
    created_at: "2026-09-29T04:21:14Z",
    decided_at: "2026-09-29T04:32:14Z",
  },
  {
    id: "inb-5",
    agent_key: "generalist",
    status: "pending",
    created_at: "2026-09-29T03:41:14Z",
    decided_at: null,
  },
  {
    id: "inb-6",
    agent_key: "cost_adr",
    status: "pending",
    created_at: "2026-09-29T02:51:14Z",
    decided_at: null,
  },
];

export function formatRunStatus(status: string): string {
  const map: Record<string, string> = {
    done: "Completed",
    running: "Running",
    error: "Failed",
    pending: "Pending",
  };
  return map[status] ?? status.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The summary's numbers (was the body of the useQuery queryFn, verbatim). */
export function buildAgentsSummary(
  agents: AgentSummary[] | unknown,
  runsRows: RunRow[] | unknown,
  inboxRows: InboxRow[] | unknown,
) {
  const runs = runsRows as RunRow[];
  const inbox = inboxRows as InboxRow[];
  const pending = inbox.filter((row) => row.status === "pending").length;
  const confirmed = inbox.filter((row) => row.status === "confirmed").length;
  const rejected = inbox.filter((row) => row.status === "rejected").length;
  const decided = confirmed + rejected;
  const confirmationRate = decided > 0 ? (confirmed / decided) * 100 : 0;

  const decisionDurations: number[] = [];
  for (const row of inbox) {
    if (!row.decided_at) continue;
    decisionDurations.push(new Date(row.decided_at).getTime() - new Date(row.created_at).getTime());
  }
  const avgDecisionHours =
    decisionDurations.length === 0
      ? 0
      : decisionDurations.reduce((sum, value) => sum + value, 0) /
        decisionDurations.length /
        (1000 * 60 * 60);

  const byAgent = AGENTS.map((agent) => {
    const agentRuns = runs.filter((row) => row.agent_key === agent.key);
    const agentInbox = inbox.filter((row) => row.agent_key === agent.key);
    const agentConfirmed = agentInbox.filter((row) => row.status === "confirmed").length;
    const agentRejected = agentInbox.filter((row) => row.status === "rejected").length;
    const agentPending = agentInbox.filter((row) => row.status === "pending").length;
    const agentDecided = agentConfirmed + agentRejected;
    const agentDurations = agentInbox
      .filter((row) => row.decided_at)
      .map(
        (row) => new Date(row.decided_at as string).getTime() - new Date(row.created_at).getTime(),
      );
    return {
      key: agent.key,
      name: agent.name,
      runs: agentRuns.length,
      proposals: agentInbox.length,
      pending: agentPending,
      confirmed: agentConfirmed,
      rejected: agentRejected,
      confirmationRate:
        agentDecided > 0 ? Number(((agentConfirmed / agentDecided) * 100).toFixed(1)) : 0,
      avgDecisionHours:
        agentDurations.length > 0
          ? Number(
              (
                agentDurations.reduce((sum, value) => sum + value, 0) /
                agentDurations.length /
                (1000 * 60 * 60)
              ).toFixed(1),
            )
          : 0,
    };
  });

  const runsPerDayMap = new Map<string, Record<string, number>>();
  for (const run of runs.slice(0, 200)) {
    const day = run.created_at.slice(0, 10);
    const bucket = runsPerDayMap.get(day) ?? { generalist: 0, support: 0, cost_adr: 0 };
    if (run.agent_key in bucket) bucket[run.agent_key as keyof typeof bucket] += 1;
    runsPerDayMap.set(day, bucket);
  }
  const runsPerDay = [...runsPerDayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([day, counts]) => ({ day, ...counts }));

  return {
    agents: agents as AgentSummary[],
    byAgent,
    runsPerDay,
    recentRuns: runs.slice(0, 10),
    totalAgents: AGENTS.length,
    totalRuns: runs.length,
    totalProposals: inbox.length,
    pending,
    confirmationRate,
    avgDecisionHours,
  };
}
