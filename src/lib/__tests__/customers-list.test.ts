// SCRUM-128 C7: pins for the Customers page numbers, written BEFORE the page rewrite. The oracles
// are the pre-C7 inline code of routes/_authenticated/customers.tsx, copied verbatim.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { addNullable } from "@/lib/nullable-sum";
import {
  customerExportRow,
  customerTotals,
  filterCustomers,
  sortCustomers,
  type CustomerBase,
  type CustomerRow,
  type CustomerSortKey,
  type CustomerTxRow,
} from "@/lib/customers-list";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const AMS = ["Asha Rao", "Vikram Shah", null, "asha rao"];
function fixture(seed: number): { customers: CustomerBase[]; tx: CustomerTxRow[] } {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 15);
  const customers: CustomerBase[] = Array.from({ length: n }, (_, i) => ({
    id: `c-${i}`,
    customer_name:
      ["Acme Learning", "Beta Labs", "Gamma Skills", "delta edu", "Épsilon"][i % 5] + ` ${i}`,
    is_active: r() < 0.7,
    account_manager_name: AMS[Math.floor(r() * AMS.length)],
    contact_email: r() < 0.5 ? `ops${i}@example.test` : null,
    contact_phone: null,
    industry: r() < 0.5 ? "Training" : null,
    notes: null,
    created_at: r() < 0.2 ? null : `2026-0${1 + Math.floor(r() * 9)}-15T10:00:00Z`,
  }));
  const tx: CustomerTxRow[] = Array.from({ length: Math.floor(r() * 60) }, () => ({
    customer_id: r() < 0.1 ? null : `c-${Math.floor(r() * (n + 2))}`,
    total_users: r() < 0.2 ? null : Math.floor(r() * 40),
    input_cost: r() < 0.2 ? null : Math.round(r() * 90000) - 1000,
    selling_cost: r() < 0.2 ? null : Math.round(r() * 120000),
  }));
  return { customers, tx };
}

// ---- pre-C7 code, verbatim -------------------------------------------------------------------
function oldTotals(customers: CustomerBase[], tx: CustomerTxRow[]) {
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
function oldFilter(
  rows: CustomerRow[],
  search: string,
  amFilter: string,
  statusFilter: string,
  range: number | undefined,
  now: Date,
) {
  const q = search.trim().toLowerCase();
  let cutoff: Date | null = null;
  if (range) {
    cutoff = new Date(now.getTime());
    cutoff.setMonth(cutoff.getMonth() - range);
    cutoff.setHours(0, 0, 0, 0);
  }
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
function oldSort(filtered: CustomerRow[], sortKey: CustomerSortKey, sortDir: "asc" | "desc") {
  const arr = [...filtered];
  arr.sort((a, b) => {
    const av: any = (a as any)[sortKey] ?? (typeof (a as any)[sortKey] === "number" ? 0 : "");
    const bv: any = (b as any)[sortKey] ?? (typeof (b as any)[sortKey] === "number" ? 0 : "");
    if (typeof av === "number" && typeof bv === "number")
      return sortDir === "asc" ? av - bv : bv - av;
    return sortDir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });
  return arr;
}
function oldExportRow(r: CustomerRow) {
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
// ----------------------------------------------------------------------------------------------

const NOW = new Date("2026-10-06T06:00:00Z");
const KEYS: CustomerSortKey[] = [
  "customer_name",
  "account_manager_name",
  "count",
  "users",
  "revenue",
  "profit",
  "margin",
];

describe("SCRUM-128 C7 Customers numbers", () => {
  it("totals, filter, sort and export equal the pre-C7 code on 200 random fixtures", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const { customers, tx } = fixture(seed);
      const rows = customerTotals(customers, tx);
      expect(rows).toEqual(oldTotals(customers, tx));
      for (const search of ["", "acme", " Asha ", "example.test"])
        for (const amFilter of ["__all", "__none", "Asha Rao"])
          for (const statusFilter of ["all", "active", "inactive"] as const)
            for (const range of [undefined, 3, 6, 12]) {
              expect(
                filterCustomers(rows, { search, amFilter, statusFilter, range, now: NOW }),
              ).toEqual(oldFilter(rows, search, amFilter, statusFilter, range, NOW));
            }
      for (const key of KEYS)
        for (const dir of ["asc", "desc"] as const)
          expect(sortCustomers(rows, key, dir)).toEqual(oldSort(rows, key, dir));
      expect(rows.map(customerExportRow)).toEqual(rows.map(oldExportRow));
    }
  });

  it("literal pins", () => {
    const base = {
      contact_email: null,
      contact_phone: null,
      industry: null,
      notes: null,
      account_manager_name: null,
      is_active: true,
    };
    const rows = customerTotals(
      [
        { ...base, id: "a", customer_name: "Acme Learning" },
        { ...base, id: "b", customer_name: "Beta Labs" },
      ],
      [
        { customer_id: "a", total_users: 20, input_cost: 60000, selling_cost: 100000 },
        { customer_id: "a", total_users: null, input_cost: 15000, selling_cost: null },
        { customer_id: null, total_users: 99, input_cost: 1, selling_cost: 1 },
      ],
    );
    expect(rows[0]).toMatchObject({
      count: 2,
      users: 20,
      revenue: 100000,
      cost: 75000,
      profit: 25000,
      margin: 25,
    });
    expect(rows[1]).toMatchObject({
      count: 0,
      users: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      margin: 0,
    });
    expect(customerExportRow(rows[0])["Margin %"]).toBe(25);
  });
});
