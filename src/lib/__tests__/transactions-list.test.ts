// SCRUM-128 C7: pins for the All transactions list numbers, written BEFORE the list UI rewrite.
// The oracles are the pre-C7 inline code of transactions-table.tsx, copied verbatim.
import { describe, expect, it } from "vitest";
import { MONTH_NAMES } from "@/lib/format";
import { addNullable } from "@/lib/nullable-sum";
import { cloudTypeLabel } from "@/lib/cloud-provider";
import {
  transactionExportName,
  transactionExportRow,
  transactionPageSummary,
  transactionRowProfit,
  type RepoFilter,
  type TransactionListRow,
} from "@/lib/transactions-list";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomRows(seed: number): TransactionListRow[] {
  const r = rng(seed);
  const pick = <T>(v: T, p = 0.2): T | null => (r() < p ? null : v);
  return Array.from({ length: Math.floor(r() * 30) }, (_, i) => ({
    id: `t-${seed}-${i}`,
    potential_id: pick(`POT-${i}`),
    month: pick(1 + Math.floor(r() * 12)),
    year: pick(2025 + Math.floor(r() * 2)),
    customer_name: pick("Acme Learning"),
    lab_name: pick("Synthetic lab"),
    repository_type: pick(["public_cloud", "private_cloud", "other"][Math.floor(r() * 3)]),
    cloud_provider: pick("AWS"),
    system_config: r() < 0.5 ? undefined : pick("8GB 2vCPUs"),
    line_of_business: pick("VILT"),
    start_date: pick("2026-04-01"),
    end_date: pick("2026-04-30"),
    total_users: pick(Math.floor(r() * 50)),
    // Includes 0, negatives and strings-as-numbers edge cases the DB numeric type can produce.
    input_cost: pick([0, Math.round(r() * 90000), -500][Math.floor(r() * 3)]),
    selling_cost: pick([0, Math.round(r() * 120000)][Math.floor(r() * 2)]),
    created_at: "2026-04-01T10:00:00Z",
    updated_at: "2026-04-02T10:00:00Z",
  }));
}

// ---- pre-C7 code, verbatim -------------------------------------------------------------------
function oldSummary(rows: TransactionListRow[]) {
  return {
    users: rows.reduce((s, r) => addNullable(s, r.total_users), 0),
    revenue: rows.reduce((s, r) => addNullable(s, r.selling_cost), 0),
    cost: rows.reduce((s, r) => addNullable(s, r.input_cost), 0),
    profit: rows.reduce(
      (s, r) => s + addNullable(0, r.selling_cost) - addNullable(0, r.input_cost),
      0,
    ),
  };
}
function oldProfitCell(r: TransactionListRow) {
  return r.selling_cost == null && r.input_cost == null
    ? "—"
    : addNullable(0, r.selling_cost) - addNullable(0, r.input_cost);
}
function oldExport(
  rows: TransactionListRow[],
  repoFilter: RepoFilter,
  isFuzzy: boolean,
  scoreMap: Map<string, number> | null,
) {
  return rows.map((r) => ({
    "Potential ID": r.potential_id,
    Month: r.month ? MONTH_NAMES[r.month - 1] : "",
    Year: r.year,
    Customer: r.customer_name,
    "Lab Name": r.lab_name,
    "Cloud type": cloudTypeLabel(r.repository_type),
    "Cloud Provider": r.cloud_provider,
    ...(repoFilter !== "public_cloud" ? { "System Config": r.system_config ?? "" } : {}),
    "Line of Business": r.line_of_business,
    "Start Date": r.start_date,
    "End Date": r.end_date,
    "Total Users": r.total_users,
    "Input Cost": r.input_cost,
    "Selling Cost": r.selling_cost,
    Profit:
      r.selling_cost == null && r.input_cost == null
        ? null
        : addNullable(0, r.selling_cost) - addNullable(0, r.input_cost),
    "Margin %":
      r.selling_cost != null && Number(r.selling_cost) > 0
        ? Number(
            (
              ((Number(r.selling_cost) - addNullable(0, r.input_cost)) / Number(r.selling_cost)) *
              100
            ).toFixed(2),
          )
        : null,
    ...(isFuzzy ? { "Relevance Score": Number((scoreMap?.get(r.id) ?? 0).toFixed(4)) } : {}),
    "Created At": r.created_at,
    "Updated At": r.updated_at,
  }));
}
// ----------------------------------------------------------------------------------------------

describe("SCRUM-128 C7 All transactions numbers", () => {
  it("page strip, profit cell and export equal the pre-C7 code on 300 random pages", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rows = randomRows(seed);
      expect(transactionPageSummary(rows)).toEqual(oldSummary(rows));
      for (const row of rows) {
        const p = transactionRowProfit(row);
        expect(p == null ? "—" : p).toEqual(oldProfitCell(row));
      }
      const scores = new Map(rows.map((row, i) => [row.id, (i * 0.137) % 1]));
      for (const repo of ["all", "public_cloud", "private_cloud"] as const)
        for (const fuzzy of [false, true]) {
          expect(
            rows.map((row) => transactionExportRow(row, repo, fuzzy, scores.get(row.id) ?? 0)),
          ).toEqual(oldExport(rows, repo, fuzzy, fuzzy ? scores : null));
        }
    }
  });

  it("literal pins", () => {
    const rows = [
      { total_users: 20, selling_cost: 100000, input_cost: 60000 },
      { total_users: null, selling_cost: null, input_cost: 15000 },
      { total_users: 5, selling_cost: 30000, input_cost: null },
    ];
    expect(transactionPageSummary(rows)).toEqual({
      users: 25,
      revenue: 130000,
      cost: 75000,
      profit: 55000,
    });
    expect(transactionRowProfit({ selling_cost: null, input_cost: null })).toBeNull();
    expect(transactionRowProfit({ selling_cost: 0, input_cost: 500 })).toBe(-500);
    expect(transactionExportName("all")).toBe("all-transactions");
    expect(transactionExportName("public_cloud")).toBe("public-cloud");
    expect(transactionExportName("private_cloud")).toBe("private-cloud");
    const row = randomRows(7)[0];
    const out = transactionExportRow(
      { ...row, selling_cost: 80000, input_cost: 50000, month: 4 },
      "all",
      true,
      0.123456,
    );
    expect(out["Margin %"]).toBe(37.5);
    expect(out.Profit).toBe(30000);
    expect(out.Month).toBe("Apr");
    expect(out["Relevance Score"]).toBe(0.1235);
  });
});
