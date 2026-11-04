import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRANSACTION_COMPLETENESS_FIELDS,
  TRANSACTION_KIND_COMPLETENESS_FIELD,
  INCOMPLETE_PRICE_FIELDS,
  REQUIRED_TRANSACTION_FIELDS,
  applyCompletenessQuery,
  completeQueryFilters,
  incompleteQueryOr,
  isIncompleteTransaction,
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

describe("transaction completeness (SCRUM-131 rule: prices > 0 and required fields)", () => {
  it("system_config never decides completeness, for public or private rows", () => {
    expect(isTransactionComplete(filled({ system_config: null }))).toBe(true);
    expect(isTransactionComplete(filled({ system_config: "   " }))).toBe(true);
    expect(
      isTransactionComplete(
        filled({ lab_type: "private_cloud", cloud_provider: "SAP", system_config: null }),
      ),
    ).toBe(true);
  });

  it("a blank cloud_provider (required) makes any row incomplete", () => {
    expect(
      isTransactionComplete(filled({ cloud_provider: null, system_config: "8GB 2vCPUs" })),
    ).toBe(false);
    expect(
      isTransactionComplete(filled({ cloud_provider: "  ", system_config: "8GB 2vCPUs" })),
    ).toBe(false);
    expect(
      isTransactionComplete(
        filled({ lab_type: "private_cloud", cloud_provider: null, system_config: "8GB 2vCPUs" }),
      ),
    ).toBe(false);
  });

  it("a cost of 0 (the import placeholder) or below makes the row incomplete", () => {
    expect(isTransactionComplete(filled({ input_cost: 0, selling_cost: 0 }))).toBe(false);
    expect(isTransactionComplete(filled({ input_cost: 0 }))).toBe(false);
    expect(isTransactionComplete(filled({ selling_cost: -1 }))).toBe(false);
  });

  it("non-critical blanks (LoB, dates, users) do not count", () => {
    expect(
      isTransactionComplete(
        filled({ line_of_business: null, start_date: null, end_date: null, total_users: null }),
      ),
    ).toBe(true);
  });

  it("blank text counts as empty, and NULL counts as empty", () => {
    expect(isTransactionComplete(filled({ potential_id: "   " }))).toBe(false);
    expect(isTransactionComplete(filled({ customer_name: "" }))).toBe(false);
    expect(isTransactionComplete(filled({ lab_name: null }))).toBe(false);
    expect(isTransactionComplete(filled({ month: null }))).toBe(false);
    expect(isTransactionComplete(filled({ input_cost: null }))).toBe(false);
  });

  it("the SCRUM-131 is_complete migration (held back, REQUIRES CHIEF GO) names the required fields and both prices", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../../supabase/migrations-pending/scrum131_is_complete_rule.sql"),
      "utf8",
    );
    expect(sql.split("\n")[0]).toContain("REQUIRES CHIEF GO");
    const at = sql.lastIndexOf("ALTER COLUMN is_complete SET EXPRESSION AS (");
    const expression = sql.slice(at, sql.indexOf(");", at));
    for (const field of [...REQUIRED_TRANSACTION_FIELDS, ...INCOMPLETE_PRICE_FIELDS])
      expect(expression).toContain(field);
    for (const field of [
      "system_config",
      "line_of_business",
      "start_date",
      "end_date",
      "total_users",
    ])
      expect(expression).not.toContain(field);
    // The SCRUM-103 expression it replaces is still on record (rollback restores it).
    const old = readFileSync(
      path.resolve(
        __dirname,
        "../../../supabase/migrations/20260928031000_scrum103_lenient_import.sql",
      ),
      "utf8",
    );
    for (const field of TRANSACTION_COMPLETENESS_FIELDS) expect(old).toContain(field);
    expect(old).toContain(TRANSACTION_KIND_COMPLETENESS_FIELD.private_cloud);
  });

  it("the incomplete filter combines with most-recent sort", () => {
    const plan = transactionListPlan({
      completeness: "incomplete",
      sortMode: "recent",
      fuzzy: false,
    });
    expect(plan).toEqual({
      isComplete: false,
      serverOrder: { column: "created_at", ascending: false },
    });

    const rows = [
      filled({ id: "complete-newest", created_at: "2026-03-03T00:00:00Z" }),
      filled({ id: "incomplete-older", created_at: "2026-01-01T00:00:00Z", potential_id: null }),
      filled({ id: "incomplete-newer", created_at: "2026-02-01T00:00:00Z", selling_cost: null }),
    ];
    expect(
      selectTransactions(rows, { completeness: "incomplete", sortMode: "recent" }).map((r) => r.id),
    ).toEqual(["incomplete-newer", "incomplete-older"]);
  });

  it("the incomplete filter combines with relevance sort and leaves complete rows out", () => {
    const plan = transactionListPlan({
      completeness: "incomplete",
      sortMode: "relevance",
      fuzzy: true,
    });
    expect(plan.isComplete).toBe(false);
    expect(plan.serverOrder).toBeNull();

    const rows = [
      filled({ id: "complete-high", created_at: "2026-01-01T00:00:00Z" }),
      filled({ id: "incomplete-low", created_at: "2026-03-01T00:00:00Z", month: null }),
      filled({ id: "incomplete-high", created_at: "2026-01-15T00:00:00Z", year: null }),
    ];
    const scores: Record<string, number> = {
      "complete-high": 0.99,
      "incomplete-low": 0.2,
      "incomplete-high": 0.8,
    };
    expect(
      selectTransactions(rows, {
        completeness: "incomplete",
        sortMode: "relevance",
        scoreOf: (id) => scores[id] ?? 0,
      }).map((r) => r.id),
    ).toEqual(["incomplete-high", "incomplete-low"]);
  });
});

// The /transactions query filters must select exactly the rows isIncompleteTransaction picks.
// Tiny in-memory evaluator for the PostgREST operators used (SQL NULL semantics: a comparison
// with NULL is not true).
type Op = { column: string; operator: string; value: string };
function evalOp(row: Record<string, unknown>, op: Op): boolean {
  const v = row[op.column];
  const isNull = v == null;
  switch (op.operator) {
    case "is":
      return op.value === "null" && isNull;
    case "not.is":
      return op.value === "null" && !isNull;
    case "gt":
      return !isNull && Number(v) > Number(op.value);
    case "lte":
      return !isNull && Number(v) <= Number(op.value);
    case "match":
      return !isNull && new RegExp(op.value).test(String(v));
    case "not.match":
      return !isNull && !new RegExp(op.value).test(String(v));
    default:
      throw new Error(`operator not covered: ${op.operator}`);
  }
}
function parseOr(or: string): Op[] {
  return or.split(",").map((part) => {
    const [column, operator, ...rest] = part.split(".");
    return { column, operator, value: rest.join(".") };
  });
}

describe("/transactions completeness query = isIncompleteTransaction", () => {
  const variants: Row[] = [
    filled(),
    filled({ input_cost: 0 }),
    filled({ selling_cost: -5 }),
    filled({ selling_cost: null }),
    filled({ potential_id: "  " }),
    filled({ customer_name: "" }),
    filled({ lab_name: null }),
    filled({ cloud_provider: "\t" }),
    filled({ month: null }),
    filled({ year: null }),
    filled({ system_config: null, line_of_business: null, total_users: null }),
    filled({ lab_type: "private_cloud", cloud_provider: "SAP", system_config: null }),
  ];

  it("Incomplete OR-filter picks exactly the incomplete rows", () => {
    const ops = parseOr(incompleteQueryOr());
    for (const row of variants) {
      expect(ops.some((op) => evalOp(row as unknown as Record<string, unknown>, op))).toBe(
        isIncompleteTransaction(row),
      );
    }
  });

  it("Complete AND-filters pick exactly the complete rows", () => {
    const ops = completeQueryFilters();
    for (const row of variants) {
      expect(ops.every((op) => evalOp(row as unknown as Record<string, unknown>, op))).toBe(
        !isIncompleteTransaction(row),
      );
    }
  });

  it("the query uses only the shared constants and never is_complete", () => {
    expect(incompleteQueryOr()).not.toContain("is_complete");
    expect(incompleteQueryOr()).not.toMatch(/[:()]/);
    const cols = new Set(completeQueryFilters().map((f) => f.column));
    expect(cols).toEqual(new Set([...REQUIRED_TRANSACTION_FIELDS, ...INCOMPLETE_PRICE_FIELDS]));
  });

  it("applyCompletenessQuery calls filter() for Complete and or() for Incomplete", () => {
    const calls: string[] = [];
    const q = {
      filter(c: string, o: string, v: string) {
        calls.push(`filter ${c} ${o} ${v}`);
        return q;
      },
      or(f: string) {
        calls.push(`or ${f}`);
        return q;
      },
    };
    applyCompletenessQuery(q, "all");
    expect(calls).toEqual([]);
    applyCompletenessQuery(q, "incomplete");
    expect(calls).toEqual([`or ${incompleteQueryOr()}`]);
    calls.length = 0;
    applyCompletenessQuery(q, "complete");
    expect(calls).toHaveLength(completeQueryFilters().length);
  });
});

describe("Eng QC fix 4 guard: the UI never reads the DB is_complete column", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory())
        return ["__tests__", "integrations"].includes(name) ? [] : walk(p);
      return /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  }
  it("no is_complete reads in src (comments aside)", () => {
    const offenders = walk(path.resolve(__dirname, "../.."))
      .filter((f) => {
        const code = readFileSync(f, "utf8")
          .split("\n")
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
          .join("\n");
        return /["'`.]is_complete\b/.test(code);
      })
      .map((f) => path.relative(path.resolve(__dirname, "../.."), f));
    expect(offenders).toEqual([]);
  });
});
