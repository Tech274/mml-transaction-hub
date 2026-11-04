// SCRUM-128 C7: pins for the Support tickets numbers, written BEFORE the page rewrite. The oracles
// are the pre-C7 inline code of routes/_authenticated/tickets.tsx, copied verbatim and run with the
// system clock frozen at the same instant the new code receives as `now`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicketRow } from "@/lib/freshdesk.functions";
import {
  buildWeeklyTrend,
  filterTickets,
  priorityQueue,
  ticketCounts,
  ticketSummaryMetrics,
  type Quick,
} from "@/lib/tickets-summary";

const OPEN_LIKE = ["Open", "Waiting on Customer", "Waiting on Third Party"];
const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
const NOW = new Date("2026-10-06T06:30:00Z");

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const STATUSES = [
  "Open",
  "Pending",
  "Waiting on Customer",
  "Waiting on Third Party",
  "Resolved",
  "Closed",
  null,
];
const PRIORITIES = ["Urgent", "High", "Medium", "Low", null];
function iso(r: () => number, spanDays: number) {
  return new Date(NOW.getTime() + (r() - 0.7) * spanDays * 86400000).toISOString();
}
function tickets(seed: number): TicketRow[] {
  const r = rng(seed);
  return Array.from({ length: Math.floor(r() * 50) }, (_, i) => ({
    id: 5000 + i,
    subject: r() < 0.1 ? null : `Lab access issue ${i}`,
    status: STATUSES[Math.floor(r() * STATUSES.length)],
    priority: PRIORITIES[Math.floor(r() * PRIORITIES.length)],
    type: null,
    source: null,
    requester_name: r() < 0.3 ? null : `Learner ${i}`,
    requester_email: r() < 0.3 ? null : `learner${i}@example.test`,
    company_name: r() < 0.3 ? null : ["Acme Learning", "Beta Labs", "Gamma Skills"][i % 3],
    agent_name: r() < 0.3 ? null : ["Agent A", "Agent B"][i % 2],
    group_name: null,
    tags: [],
    due_by: r() < 0.3 ? null : iso(r, 20),
    is_escalated: r() < 0.2,
    ticket_created_at: r() < 0.1 ? null : iso(r, 70),
    ticket_updated_at: r() < 0.1 ? null : iso(r, 14),
    synced_at: NOW.toISOString(),
  }));
}

// ---- pre-C7 code, verbatim -------------------------------------------------------------------
function isOverdue(t: TicketRow) {
  return (
    !!t.due_by &&
    new Date(t.due_by).getTime() < Date.now() &&
    !["Resolved", "Closed"].includes(t.status ?? "")
  );
}
function matchesQuick(t: TicketRow, quick: Quick) {
  switch (quick) {
    case "all":
      return true;
    case "open":
      return OPEN_LIKE.includes(t.status ?? "");
    case "pending":
      return t.status === "Pending";
    case "resolved":
      return t.status === "Resolved";
    case "closed":
      return t.status === "Closed";
    case "escalated":
      return t.is_escalated;
    case "overdue":
      return isOverdue(t);
  }
}
function oldCounts(scoped: TicketRow[]) {
  return {
    total: scoped.length,
    open: scoped.filter((r) => OPEN_LIKE.includes(r.status ?? "")).length,
    pending: scoped.filter((r) => r.status === "Pending").length,
    resolved: scoped.filter((r) => r.status === "Resolved").length,
    closed: scoped.filter((r) => r.status === "Closed").length,
    overdue: scoped.filter(isOverdue).length,
    escalated: scoped.filter((r) => r.is_escalated).length,
  };
}
function oldFiltered(
  scoped: TicketRow[],
  q: string,
  quick: Quick,
  status: string,
  priority: string,
  agent: string,
) {
  const needle = q.trim().toLowerCase();
  return scoped.filter((r) => {
    if (!matchesQuick(r, quick)) return false;
    if (status !== "all" && r.status !== status) return false;
    if (priority !== "all" && r.priority !== priority) return false;
    if (agent !== "all" && (r.agent_name ?? "Unassigned") !== agent) return false;
    if (!needle) return true;
    return [r.subject, r.requester_name, r.requester_email, r.company_name, String(r.id)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });
}
function oldQueue(scoped: TicketRow[]) {
  return scoped
    .filter((r) => !["Resolved", "Closed"].includes(r.status ?? ""))
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority ?? ""] ?? 4;
      const pb = PRIORITY_RANK[b.priority ?? ""] ?? 4;
      if (pa !== pb) return pa - pb;
      const oa = isOverdue(a) ? 0 : 1;
      const ob = isOverdue(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return (a.due_by ?? a.ticket_created_at ?? "").localeCompare(
        b.due_by ?? b.ticket_created_at ?? "",
      );
    })
    .slice(0, 10);
}
function tallyBy(rows: TicketRow[], key: (row: TicketRow) => string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}
function oldWeekly(rows: TicketRow[]) {
  const now = new Date();
  const buckets: { week: string; opened: number; resolved: number }[] = [];
  for (let index = 7; index >= 0; index--) {
    const start = new Date(now);
    start.setDate(now.getDate() - index * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    buckets.push({
      week: `${String(start.getMonth() + 1).padStart(2, "0")}/${String(start.getDate()).padStart(2, "0")}`,
      opened: 0,
      resolved: 0,
    });
    rows.forEach((row) => {
      const created = row.ticket_created_at ? new Date(row.ticket_created_at).getTime() : null;
      const updated = row.ticket_updated_at ? new Date(row.ticket_updated_at).getTime() : null;
      const startTs = start.getTime();
      const endTs = end.getTime() + 24 * 60 * 60 * 1000;
      if (created && created >= startTs && created < endTs) buckets[buckets.length - 1].opened += 1;
      if (
        updated &&
        updated >= startTs &&
        updated < endTs &&
        ["Resolved", "Closed"].includes(row.status ?? "")
      ) {
        buckets[buckets.length - 1].resolved += 1;
      }
    });
  }
  return buckets;
}
function oldSummary(rows: TicketRow[]) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const resolvedLast7 = rows.filter(
    (row) =>
      row.ticket_updated_at &&
      new Date(row.ticket_updated_at).getTime() >= sevenDaysAgo &&
      row.status === "Resolved",
  ).length;
  const closedLast7 = rows.filter(
    (row) =>
      row.ticket_updated_at &&
      new Date(row.ticket_updated_at).getTime() >= sevenDaysAgo &&
      row.status === "Closed",
  ).length;
  const dueResolvedRows = rows.filter(
    (row) =>
      row.ticket_updated_at &&
      row.due_by &&
      ["Resolved", "Closed"].includes(row.status ?? "") &&
      new Date(row.ticket_updated_at).getTime() >= sevenDaysAgo,
  );
  const resolvedWithinDue = dueResolvedRows.filter(
    (row) =>
      new Date(row.ticket_updated_at as string).getTime() <=
      new Date(row.due_by as string).getTime(),
  ).length;
  const resolvedWithinDuePct =
    dueResolvedRows.length > 0 ? Math.round((resolvedWithinDue / dueResolvedRows.length) * 100) : 0;
  const resolutionDurationsHours = rows
    .filter(
      (row) =>
        row.ticket_created_at &&
        row.ticket_updated_at &&
        ["Resolved", "Closed"].includes(row.status ?? "") &&
        new Date(row.ticket_updated_at).getTime() >= sevenDaysAgo,
    )
    .map(
      (row) =>
        (new Date(row.ticket_updated_at as string).getTime() -
          new Date(row.ticket_created_at as string).getTime()) /
        (1000 * 60 * 60),
    );
  const avgResolutionHours =
    resolutionDurationsHours.length > 0
      ? resolutionDurationsHours.reduce((sum, value) => sum + value, 0) /
        resolutionDurationsHours.length
      : 0;
  const dueTodayCount = rows.filter((row) => {
    if (!row.due_by || ["Resolved", "Closed"].includes(row.status ?? "")) return false;
    const due = new Date(row.due_by);
    const current = new Date();
    return (
      due.getUTCFullYear() === current.getUTCFullYear() &&
      due.getUTCMonth() === current.getUTCMonth() &&
      due.getUTCDate() === current.getUTCDate()
    );
  }).length;
  const dueThisWeekCount = rows.filter((row) => {
    if (!row.due_by || ["Resolved", "Closed"].includes(row.status ?? "")) return false;
    const dueTs = new Date(row.due_by).getTime();
    return dueTs >= now && dueTs <= now + 7 * 24 * 60 * 60 * 1000;
  }).length;
  const byPriority = tallyBy(rows, (row) => row.priority ?? "Unassigned");
  const byAgent = tallyBy(rows, (row) => row.agent_name ?? "Unassigned").slice(0, 6);
  const byCustomer = tallyBy(rows, (row) => row.company_name ?? "Unknown").slice(0, 6);
  const weeklyTrend = oldWeekly(rows);
  const recentActivity = [...rows]
    .sort(
      (a, b) =>
        new Date(b.ticket_updated_at ?? b.ticket_created_at ?? 0).getTime() -
        new Date(a.ticket_updated_at ?? a.ticket_created_at ?? 0).getTime(),
    )
    .slice(0, 6);
  return {
    resolvedLast7,
    closedLast7,
    dueResolvedCount: dueResolvedRows.length,
    resolvedWithinDue,
    resolvedWithinDuePct,
    avgResolutionHours,
    dueTodayCount,
    dueThisWeekCount,
    byPriority,
    byAgent,
    byCustomer,
    weeklyTrend,
    recentActivity,
  };
}
// ----------------------------------------------------------------------------------------------

afterEach(() => vi.useRealTimers());

const QUICKS: Quick[] = ["all", "open", "pending", "resolved", "closed", "overdue", "escalated"];

describe("SCRUM-128 C7 Support tickets numbers", () => {
  it("counts, filters, queue, summary metrics and trend equal the pre-C7 code on 200 fixtures", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const now = NOW.getTime();
    for (let seed = 1; seed <= 200; seed += 1) {
      const rows = tickets(seed);
      expect(ticketCounts(rows, now)).toEqual(oldCounts(rows));
      expect(priorityQueue(rows, now)).toEqual(oldQueue(rows));
      expect(ticketSummaryMetrics(rows, NOW)).toEqual(oldSummary(rows));
      expect(buildWeeklyTrend(rows, NOW)).toEqual(oldWeekly(rows));
      for (const quick of QUICKS)
        for (const [q, status, priority, agent] of [
          ["", "all", "all", "all"],
          ["acme", "Open", "all", "all"],
          ["50", "all", "High", "Unassigned"],
          [" LEARNER ", "all", "all", "Agent A"],
        ])
          expect(filterTickets(rows, { q, quick, status, priority, agent }, now)).toEqual(
            oldFiltered(rows, q, quick, status, priority, agent),
          );
    }
  });

  it("literal pins", () => {
    const t = (over: Partial<TicketRow>): TicketRow => ({
      ...tickets(1)[0],
      id: 1,
      is_escalated: false,
      ...over,
    });
    const rows = [
      t({ id: 1, status: "Open", due_by: "2026-10-05T00:00:00Z", priority: "High" }),
      t({ id: 2, status: "Pending", due_by: "2026-10-06T20:00:00Z", is_escalated: true }),
      t({
        id: 3,
        status: "Resolved",
        ticket_created_at: "2026-10-04T06:30:00Z",
        ticket_updated_at: "2026-10-05T06:30:00Z",
        due_by: "2026-10-06T00:00:00Z",
      }),
      t({
        id: 4,
        status: "Closed",
        ticket_created_at: "2026-10-01T06:30:00Z",
        ticket_updated_at: "2026-10-03T06:30:00Z",
        due_by: "2026-10-02T00:00:00Z",
      }),
    ];
    expect(ticketCounts(rows, NOW.getTime())).toEqual({
      total: 4,
      open: 1,
      pending: 1,
      resolved: 1,
      closed: 1,
      overdue: 1,
      escalated: 1,
    });
    const m = ticketSummaryMetrics(rows, NOW);
    expect(m.resolvedLast7).toBe(1);
    expect(m.closedLast7).toBe(1);
    expect(m.resolvedWithinDue).toBe(1);
    expect(m.dueResolvedCount).toBe(2);
    expect(m.resolvedWithinDuePct).toBe(50);
    expect(m.avgResolutionHours).toBe(36);
    expect(m.dueTodayCount).toBe(1);
    expect(m.dueThisWeekCount).toBe(1);
    expect(m.weeklyTrend).toHaveLength(8);
  });
});
