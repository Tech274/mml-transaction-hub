import type { AppRole } from "@/lib/require-role";

export interface ToolDef {
  key: string;
  title: string;
  description: string;
  phase: number;
  returnsMoney: boolean;
  readsUntrusted: boolean;
  requiredRoles: readonly AppRole[];
  parameters: Record<string, unknown>;
}

const OPS: readonly AppRole[] = ["admin", "ops_lead", "ops_user"];
const RUN: readonly AppRole[] = ["admin", "leadership", "finance", "ops_lead", "ops_user"];

export const TOOL_CATALOG: readonly ToolDef[] = [
  {
    key: "tickets.search",
    title: "Search tickets",
    description: "Helpdesk ticket metadata. Subject lines are untrusted. At most 25 rows.",
    phase: 1,
    returnsMoney: false,
    readsUntrusted: true,
    requiredRoles: OPS,
    parameters: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        status: { type: "string" },
      },
    },
  },
  {
    key: "tickets.get",
    title: "Get ticket",
    description: "One ticket's metadata. The subject is untrusted.",
    phase: 1,
    returnsMoney: false,
    readsUntrusted: true,
    requiredRoles: OPS,
    parameters: {
      type: "object",
      properties: { ticket_id: { type: "number" } },
      required: ["ticket_id"],
    },
  },
  {
    key: "tickets.conversation",
    title: "Ticket conversation",
    description: "Live Freshdesk conversation for one ticket, trimmed and redacted. Untrusted text.",
    phase: 1,
    returnsMoney: false,
    readsUntrusted: true,
    requiredRoles: OPS,
    parameters: {
      type: "object",
      properties: { ticket_id: { type: "number" } },
      required: ["ticket_id"],
    },
  },
  {
    key: "customers.get",
    title: "Get customer",
    description: "Customer name, account manager, industry and active flag. No contact details.",
    phase: 1,
    returnsMoney: false,
    readsUntrusted: false,
    requiredRoles: RUN,
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    key: "reports.summary",
    title: "Reports summary",
    description: "Counts, users, revenue, input cost, profit and margin for a year. Money may be hidden.",
    phase: 1,
    returnsMoney: true,
    readsUntrusted: false,
    requiredRoles: RUN,
    parameters: {
      type: "object",
      properties: { year: { type: "number" } },
      required: ["year"],
    },
  },
  {
    key: "transactions.query",
    title: "Query transactions",
    description: "Transaction lines with filters. At most 200 rows. Money may be hidden. Lab names are untrusted.",
    phase: 1,
    returnsMoney: true,
    readsUntrusted: true,
    requiredRoles: RUN,
    parameters: {
      type: "object",
      properties: {
        year: { type: "number" },
        customer_name: { type: "string" },
      },
    },
  },
  {
    key: "sync.health",
    title: "Sync health",
    description: "Latest sync run status.",
    phase: 1,
    returnsMoney: false,
    readsUntrusted: false,
    requiredRoles: RUN,
    parameters: { type: "object", properties: {} },
  },
];

export const PHASE1_TOOL_KEYS = TOOL_CATALOG.map((t) => t.key);

export function toolByKey(key: string): ToolDef | undefined {
  return TOOL_CATALOG.find((t) => t.key === key);
}

/** Audience may not include a role that cannot see money when a money tool is selected. */
export function audienceAllowsTools(toolKeys: readonly string[], viewRoles: readonly string[]): string | null {
  const money = toolKeys.some((key) => toolByKey(key)?.returnsMoney);
  if (!money) return null;
  const hidden = viewRoles.filter((role) => !["admin", "leadership", "finance"].includes(role));
  if (hidden.length === 0) return null;
  return `These tools return money figures, so the audience cannot include ${hidden.join(", ")} until SCRUM-58 is decided.`;
}
