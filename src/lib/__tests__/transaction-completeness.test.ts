import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRANSACTION_COMPLETENESS_FIELDS,
  TRANSACTION_KIND_COMPLETENESS_FIELD,
  isTransactionComplete,
  selectTransactions,
  transactionListPlan,
} from "@/lib/transaction-completeness";

type Row = {
  id: string;
  created_at: string;
  lab_type: "public_cloud" | "private_cloud";
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
  input_cost: number | null;
  selling_cost: number | null;
  cloud_provider: string | null;
  system_config: string | null;
};

function filled(over: Partial<Row> = {}): Row {
  return {
    id: "row",
    created_at: "2026-03-01T00:00:00Z",
    lab_type: "public_cloud",
    potential_id: "PID-1",
    month: 3,
    year: 2026,
    customer_name: "Synthetic Co",
    lab_name: "Lab A",
    line_of_business: "VILT",
    start_date: "2026-03-01",
    end_date: "2026-03-31",
    total_users: 5,
    input_cost: 10,
    selling_cost: 20,
    cloud_provider: "AWS",
    system_config: null,
    ...over,
  };
}

describe("transaction completeness", () => {
  it("a public row is complete when cloud_provider is set, even if system_config is blank", () => {
    expect(isTransactionComplete(filled({ system_config: null }))).toBe(true);
    expect(isTransactionComplete(filled({ system_config: "   " }))).toBe(true);
  });

  it("a public row is incomplete when cloud_provider is empty, even if system_config is set", () => {
    expect(isTransactionComplete(filled({ cloud_provider: null, system_config: "8GB 2vCPUs" }))).toBe(false);
    expect(isTransactionComplete(filled({ cloud_provider: "  ", system_config: "8GB 2vCPUs" }))).toBe(false);
  });

  it("a private row is complete when system_config is set, even if cloud_provider is blank", () => {
    expect(isTransactionComplete(filled({
      lab_type: "private_cloud",
      cloud_provider: null,
      system_config: "8GB 2vCPUs",
    }))).toBe(true);
  });

  it("a private row is incomplete when system_config is empty, even if cloud_provider is set", () => {
    expect(isTransactionComplete(filled({
      lab_type: "private_cloud",
      cloud_provider: "AWS",
      system_config: null,
    }))).toBe(false);
    expect(isTransactionComplete(filled({
      lab_type: "private_cloud",
      cloud_provider: "AWS",
      system_config: " ",
    }))).toBe(false);
  });

  it("a 0 cost counts as a value", () => {
    expect(isTransactionComplete(filled({ input_cost: 0, selling_cost: 0 }))).toBe(true);
  });

  it("blank text counts as empty, and NULL counts as empty", () => {
    expect(isTransactionComplete(filled({ potential_id: "   " }))).toBe(false);
    expect(isTransactionComplete(filled({ customer_name: "" }))).toBe(false);
    expect(isTransactionComplete(filled({ lab_name: null }))).toBe(false);
    expect(isTransactionComplete(filled({ month: null }))).toBe(false);
    expect(isTransactionComplete(filled({ input_cost: null }))).toBe(false);
  });

  it("the pending migration expression names the same fields", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations-pending/scrum103_lenient_import.sql"),
      "utf8",
    );
    const expression = sql.slice(sql.indexOf("ADD COLUMN is_complete"), sql.indexOf("CREATE INDEX transactions_is_complete_live_idx"));
    for (const field of TRANSACTION_COMPLETENESS_FIELDS) expect(expression).toContain(field);
    expect(expression).toContain(TRANSACTION_KIND_COMPLETENESS_FIELD.public_cloud);
    expect(expression).toContain(TRANSACTION_KIND_COMPLETENESS_FIELD.private_cloud);
    expect(sql).toContain("DROP COLUMN IF EXISTS is_complete");
  });

  it("the incomplete filter combines with most-recent sort", () => {
    const plan = transactionListPlan({ completeness: "incomplete", sortMode: "recent", fuzzy: false });
    expect(plan).toEqual({ isComplete: false, serverOrder: { column: "created_at", ascending: false } });

    const rows = [
      filled({ id: "complete-newest", created_at: "2026-03-03T00:00:00Z" }),
      filled({ id: "incomplete-older", created_at: "2026-01-01T00:00:00Z", potential_id: null }),
      filled({ id: "incomplete-newer", created_at: "2026-02-01T00:00:00Z", selling_cost: null }),
    ];
    expect(selectTransactions(rows, { completeness: "incomplete", sortMode: "recent" }).map((r) => r.id))
      .toEqual(["incomplete-newer", "incomplete-older"]);
  });

  it("the incomplete filter combines with relevance sort and leaves complete rows out", () => {
    const plan = transactionListPlan({ completeness: "incomplete", sortMode: "relevance", fuzzy: true });
    expect(plan.isComplete).toBe(false);
    expect(plan.serverOrder).toBeNull();

    const rows = [
      filled({ id: "complete-high", created_at: "2026-01-01T00:00:00Z" }),
      filled({ id: "incomplete-low", created_at: "2026-03-01T00:00:00Z", month: null }),
      filled({ id: "incomplete-high", created_at: "2026-01-15T00:00:00Z", year: null }),
    ];
    const scores: Record<string, number> = { "complete-high": 0.99, "incomplete-low": 0.2, "incomplete-high": 0.8 };
    expect(selectTransactions(rows, {
      completeness: "incomplete",
      sortMode: "relevance",
      scoreOf: (id) => scores[id] ?? 0,
    }).map((r) => r.id)).toEqual(["incomplete-high", "incomplete-low"]);
  });
});
