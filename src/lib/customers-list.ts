// SCRUM-128 C7: the Customers page numbers, moved verbatim out of routes/_authenticated/customers.tsx
// (plan R1: calculations are not touched) so tests can pin them: per-customer totals, the filter,
// the sort and one Excel row.
import { addNullable } from "@/lib/nullable-sum";

export type CustomerBase = {
  id: string;
  customer_name: string;
  is_active: boolean;
  account_manager_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  notes: string | null;
  created_at?: string | null;
  deactivation_reason?: string | null;
};

export type CustomerRow = CustomerBase & {
  count: number;
  users: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type CustomerTxRow = {
  customer_id: string | null;
  total_users: number | null;
  input_cost: number | null;
  selling_cost: number | null;
};

export type CustomerSortKey =
  | "customer_name"
  | "account_manager_name"
  | "count"
  | "users"
  | "revenue"
  | "profit"
  | "margin";

export type CustomerStatusFilter = "all" | "active" | "inactive";

/** Lines, users, revenue, input cost, profit and margin per customer (all non-deleted lines). */
export function customerTotals<C extends CustomerBase>(
  customers: readonly C[] | null | undefined,
  tx: readonly CustomerTxRow[] | null | undefined,
): (C & Omit<CustomerRow, keyof CustomerBase>)[] {
  const map = new Map<string, { count: number; users: number; revenue: number; cost: number }>();
  for (const t of tx ?? []) {
    if (!t.customer_id) continue;
    const e = map.get(t.customer_id) ?? { count: 0, users: 0, revenue: 0, cost: 0 };
    e.count += 1;
    e.users = addNullable(e.users, t.total_users);
    e.revenue = addNullable(e.revenue, t.selling_cost);
    e.cost = addNullable(e.cost, t.input_cost);
    map.set(t.customer_id, e);
  }
  return (customers ?? []).map((c) => {
    const m = map.get(c.id) ?? { count: 0, users: 0, revenue: 0, cost: 0 };
    const profit = m.revenue - m.cost;
    const margin = m.revenue > 0 ? (profit / m.revenue) * 100 : 0;
    return { ...c, ...m, profit, margin };
  });
}

/** Status, account manager ("__all" / "__none" / a name), created-in-last-N-months and search. */
export function filterCustomers<R extends CustomerRow>(
  rows: readonly R[],
  opts: {
    search: string;
    amFilter: string;
    statusFilter: CustomerStatusFilter;
    range?: number;
    now?: Date;
  },
): R[] {
  const q = opts.search.trim().toLowerCase();
  const range = opts.range;
  let cutoff: Date | null = null;
  if (range) {
    cutoff = opts.now ? new Date(opts.now.getTime()) : new Date();
    cutoff.setMonth(cutoff.getMonth() - range);
    cutoff.setHours(0, 0, 0, 0);
  }
  const { statusFilter, amFilter } = opts;
  return rows.filter((r) => {
    if (statusFilter === "active" && !r.is_active) return false;
    if (statusFilter === "inactive" && r.is_active) return false;
    if (amFilter !== "__all") {
      if (amFilter === "__none") {
        if (r.account_manager_name) return false;
      } else if ((r.account_manager_name ?? "") !== amFilter) return false;
    }
    if (cutoff) {
      if (!r.created_at || new Date(r.created_at) < cutoff) return false;
    }
    if (!q) return true;
    return (
      r.customer_name.toLowerCase().includes(q) ||
      (r.account_manager_name ?? "").toLowerCase().includes(q) ||
      (r.industry ?? "").toLowerCase().includes(q) ||
      (r.contact_email ?? "").toLowerCase().includes(q)
    );
  });
}

export function sortCustomers<R extends CustomerRow>(
  filtered: readonly R[],
  sortKey: CustomerSortKey,
  sortDir: "asc" | "desc",
): R[] {
  const arr = [...filtered];
  arr.sort((a, b) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const av: any = (a as any)[sortKey] ?? (typeof (a as any)[sortKey] === "number" ? 0 : "");
    const bv: any = (b as any)[sortKey] ?? (typeof (b as any)[sortKey] === "number" ? 0 : "");
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (typeof av === "number" && typeof bv === "number")
      return sortDir === "asc" ? av - bv : bv - av;
    return sortDir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
  return arr;
}

export function customerExportRow(r: CustomerRow) {
  return {
    Customer: r.customer_name,
    "Account Manager": r.account_manager_name ?? "",
    Industry: r.industry ?? "",
    "Contact Email": r.contact_email ?? "",
    "Contact Phone": r.contact_phone ?? "",
    Status: r.is_active ? "Active" : "Inactive",
    Transactions: r.count,
    "Total Users": r.users,
    "Total Revenue": r.revenue,
    "Total Input Cost": r.cost,
    "Total Profit": r.profit,
    "Margin %": Number(r.margin.toFixed(2)),
  };
}
