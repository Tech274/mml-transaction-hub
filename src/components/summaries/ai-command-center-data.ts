// SCRUM-128 C6: the AI Command Center summary's data shaping, moved verbatim out of
// ai-command-center-summary.tsx (plan R1). buildAiccSummary is the former queryFn body; the
// one change is an optional `now` (default new Date(), as before) for "AI work volume" (today, UTC).
import { LIVE_ROLES, PARKED_ROLES } from "@/lib/role-rollout";

export type InboxRow = {
  id: string;
  agent_key: string;
  item_type: string;
  title: string;
  summary: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};

export type RunRow = {
  id: string;
  agent_key: string;
  status: string;
  created_at: string;
  finished_at: string | null;
};

export type AuditRow = {
  id: string;
  action: "run" | "propose" | "confirm" | "reject";
  actor_email: string | null;
  created_at: string;
};

export const EXAMPLE_INBOX: InboxRow[] = [
  {
    id: "inb-1",
    agent_key: "support",
    item_type: "ticket_proposal",
    title: "Ticket #5142 proposed update",
    summary: "Priority + assignee + note draft.",
    status: "pending",
    created_at: "2026-09-29T05:31:14Z",
  },
  {
    id: "inb-2",
    agent_key: "generalist",
    item_type: "solution_guide",
    title: "Lab solution guide draft",
    summary: "Cohort proposal for Cognizant.",
    status: "pending",
    created_at: "2026-09-29T05:22:14Z",
  },
  {
    id: "inb-3",
    agent_key: "cost_adr",
    item_type: "adr_field_map",
    title: "ADR field map proposal",
    summary: "Mapped CONFIRMED request LR-2026-093.",
    status: "confirmed",
    created_at: "2026-09-29T04:52:14Z",
  },
  {
    id: "inb-4",
    agent_key: "support",
    item_type: "email_draft",
    title: "Reply draft for ticket #5139",
    summary: "Customer clarification request.",
    status: "rejected",
    created_at: "2026-09-29T04:22:14Z",
  },
];

export const EXAMPLE_RUNS: RunRow[] = [
  {
    id: "run-901",
    agent_key: "support",
    status: "running",
    created_at: "2026-09-29T05:31:00Z",
    finished_at: null,
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
    created_at: "2026-09-29T04:11:00Z",
    finished_at: "2026-09-29T04:11:20Z",
  },
];

export const EXAMPLE_AUDIT: AuditRow[] = [
  {
    id: "au-1",
    action: "run",
    actor_email: "admin.demo@mml.local",
    created_at: "2026-09-29T05:31:00Z",
  },
  {
    id: "au-2",
    action: "propose",
    actor_email: "opslead.demo@mml.local",
    created_at: "2026-09-29T05:31:14Z",
  },
  {
    id: "au-3",
    action: "confirm",
    actor_email: "admin.demo@mml.local",
    created_at: "2026-09-29T05:33:40Z",
  },
  {
    id: "au-4",
    action: "reject",
    actor_email: "admin.demo@mml.local",
    created_at: "2026-09-29T04:33:40Z",
  },
];

export function formatItemType(value: string): string {
  const map: Record<string, string> = {
    ticket_proposal: "Ticket proposal",
    solution_guide: "Solution guide",
    adr_field_map: "ADR field map",
    email_draft: "Email draft",
  };
  return map[value] ?? value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatRoleName(value: string): string {
  const map: Record<string, string> = {
    admin: "Super Admin",
    leadership: "Leadership",
    finance: "Finance",
    ops_lead: "Ops Lead",
    ops_user: "Ops User",
    viewer: "Viewer",
  };
  return map[value] ?? value;
}

/** The summary's numbers (was the body of the useQuery queryFn, verbatim; `now` was new Date()). */
export function buildAiccSummary(
  inbox: InboxRow[],
  runs: RunRow[],
  audit: AuditRow[],
  now: Date = new Date(),
) {
  const pending = inbox.filter((row) => row.status === "pending");
  const confirmed = inbox.filter((row) => row.status === "confirmed").length;
  const rejected = inbox.filter((row) => row.status === "rejected").length;
  const reviewOutcomes = [
    { name: "Confirmed", value: confirmed },
    { name: "Rejected", value: rejected },
    { name: "Pending", value: pending.length },
  ];

  const byTypeMap = new Map<string, number>();
  for (const row of inbox) {
    const label = formatItemType(row.item_type);
    byTypeMap.set(label, (byTypeMap.get(label) ?? 0) + 1);
  }
  const workByType = [...byTypeMap.entries()].map(([name, value]) => ({ name, value }));

  const runsToday = runs.filter(
    (row) => row.created_at.slice(0, 10) === now.toISOString().slice(0, 10),
  ).length;
  const liveWork = runs.filter((row) => row.status === "running").slice(0, 8);
  const alerts = runs.filter((row) => row.status === "error").slice(0, 5);
  const automationHealthy = alerts.length === 0;
  const governance = {
    liveRoles: LIVE_ROLES.map(formatRoleName).join(", "),
    parkedRoles: PARKED_ROLES.map(formatRoleName).join(", "),
    leadershipAccess: "Leadership does not have AI Command Center access.",
  };

  const auditRuns = audit.filter((row) => row.action === "run").length;
  const auditDecisions = audit.filter(
    (row) => row.action === "confirm" || row.action === "reject",
  ).length;

  return {
    pending,
    confirmed,
    rejected,
    runsToday,
    automationHealthy,
    liveWork,
    alerts,
    workByType,
    reviewOutcomes,
    governance,
    auditRuns,
    auditDecisions,
  };
}
