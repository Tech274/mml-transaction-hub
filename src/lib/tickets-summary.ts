// SCRUM-128 C7: the Support tickets page numbers, moved verbatim out of
// routes/_authenticated/tickets.tsx (plan R1: calculations are not touched) so tests can pin them.
// The only change: one optional `now` (default: the current time, as before) instead of separate
// Date.now() / new Date() calls.
import type { TicketRow } from "@/lib/freshdesk.functions";

export const OPEN_LIKE = ["Open", "Waiting on Customer", "Waiting on Third Party"];
export const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

export type Quick = "all" | "open" | "pending" | "resolved" | "closed" | "overdue" | "escalated";

export function isOverdue(t: TicketRow, now: number = Date.now()) {
  return (
    !!t.due_by &&
    new Date(t.due_by).getTime() < now &&
    !["Resolved", "Closed"].includes(t.status ?? "")
  );
}

export function matchesQuick(t: TicketRow, quick: Quick, now: number = Date.now()) {
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
      return isOverdue(t, now);
  }
}

export type TicketCounts = {
  total: number;
  open: number;
  pending: number;
  resolved: number;
  closed: number;
  overdue: number;
  escalated: number;
};

/** Current-state counts for the summary tiles (all tickets in scope). */
export function ticketCounts(scoped: readonly TicketRow[], now: number = Date.now()): TicketCounts {
  return {
    total: scoped.length,
    open: scoped.filter((r) => OPEN_LIKE.includes(r.status ?? "")).length,
    pending: scoped.filter((r) => r.status === "Pending").length,
    resolved: scoped.filter((r) => r.status === "Resolved").length,
    closed: scoped.filter((r) => r.status === "Closed").length,
    overdue: scoped.filter((r) => isOverdue(r, now)).length,
    escalated: scoped.filter((r) => r.is_escalated).length,
  };
}

export function filterTickets(
  scoped: readonly TicketRow[],
  opts: { q: string; quick: Quick; status: string; priority: string; agent: string },
  now: number = Date.now(),
): TicketRow[] {
  const { q, quick, status, priority, agent } = opts;
  const needle = q.trim().toLowerCase();
  return scoped.filter((r) => {
    if (!matchesQuick(r, quick, now)) return false;
    if (status !== "all" && r.status !== status) return false;
    if (priority !== "all" && r.priority !== priority) return false;
    if (agent !== "all" && (r.agent_name ?? "Unassigned") !== agent) return false;
    if (!needle) return true;
    return [r.subject, r.requester_name, r.requester_email, r.company_name, String(r.id)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });
}

/** My priority queue: open tickets, priority first, then overdue, then due / created date. */
export function priorityQueue(scoped: readonly TicketRow[], now: number = Date.now()): TicketRow[] {
  return scoped
    .filter((r) => !["Resolved", "Closed"].includes(r.status ?? ""))
    .sort((a, b) => {
      const pa = PRIORITY_RANK[a.priority ?? ""] ?? 4;
      const pb = PRIORITY_RANK[b.priority ?? ""] ?? 4;
      if (pa !== pb) return pa - pb;
      const oa = isOverdue(a, now) ? 0 : 1;
      const ob = isOverdue(b, now) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return (a.due_by ?? a.ticket_created_at ?? "").localeCompare(
        b.due_by ?? b.ticket_created_at ?? "",
      );
    })
    .slice(0, 10);
}

export function tallyBy(rows: readonly TicketRow[], key: (row: TicketRow) => string) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

/** Eight weekly buckets ending this week: opened (created) and resolved/closed (updated). */
export function buildWeeklyTrend(rows: readonly TicketRow[], nowDate: Date = new Date()) {
  const now = nowDate;
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

/** The summary card's time-bound metrics, tallies, trend and recent activity. */
export function ticketSummaryMetrics(rows: readonly TicketRow[], nowDate: Date = new Date()) {
  const now = nowDate.getTime();
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
    const current = new Date(now);
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

  const weeklyTrend = buildWeeklyTrend(rows, nowDate);
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
