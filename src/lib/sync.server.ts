// Snapshot pipeline: aggregates live customers/transactions into
// public.report_snapshots and records the run in public.sync_runs.
// Server-only (uses the service-role client) — never import from a component.
// NULL costs are skipped in the snapshot totals. The transaction row is not updated.
import { addNullable } from "@/lib/nullable-sum";
import { effectiveCost } from "@/lib/cost-calculator";

export interface SyncRunResult {
  run_id: string;
  status: "success" | "error";
  customers_count: number;
  transactions_count: number;
  report_rows: number;
  duration_ms: number;
  error_message?: string;
}

type TxRow = {
  year: number;
  month: number;
  customer_name: string;
  lab_name: string;
  cloud_provider: string;
  line_of_business: string;
  total_users: number | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_auto?: number | null;
  input_cost_actual_alloc?: number | null;
};

const PAGE = 1000;

export async function runSnapshotSync(opts: {
  trigger_source: "cron" | "manual";
  triggered_by?: string | null;
  triggered_by_email?: string | null;
}): Promise<SyncRunResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => any;
  };
  const startedAt = Date.now();

  const { data: runRow, error: runErr } = await admin
    .from("sync_runs")
    .insert({
      kind: "snapshot",
      trigger_source: opts.trigger_source,
      status: "running",
      triggered_by: opts.triggered_by ?? null,
      triggered_by_email: opts.triggered_by_email ?? null,
    })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(runErr?.message ?? "Could not start sync run");
  const runId = runRow.id as string;

  try {
    // Customers count (active + inactive, excluding nothing — mirrors the app).
    const { count: customersCount, error: cErr } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true });
    if (cErr) throw new Error(cErr.message);

    // Page through live transactions.
    const rows: TxRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("transactions")
        .select(
          "year, month, customer_name, lab_name, cloud_provider, line_of_business, total_users, selling_cost, input_cost, input_cost_auto, input_cost_actual_alloc",
        )
        .eq("is_deleted", false)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as TxRow[];
      rows.push(...page);
      if (page.length < PAGE) break;
    }

    const snapshots = aggregateSnapshots(rows);

    // Replace this run's slice: snapshots are append-only per run, so simply insert.
    for (let i = 0; i < snapshots.length; i += 500) {
      const chunk = snapshots.slice(i, i + 500).map((s) => ({ ...s, run_id: runId }));
      const { error } = await admin.from("report_snapshots").insert(chunk);
      if (error) throw new Error(error.message);
    }

    const duration = Date.now() - startedAt;
    await admin
      .from("sync_runs")
      .update({
        status: "success",
        customers_count: customersCount ?? 0,
        transactions_count: rows.length,
        report_rows: snapshots.length,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      })
      .eq("id", runId);

    return {
      run_id: runId,
      status: "success",
      customers_count: customersCount ?? 0,
      transactions_count: rows.length,
      report_rows: snapshots.length,
      duration_ms: duration,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const duration = Date.now() - startedAt;
    await admin
      .from("sync_runs")
      .update({
        status: "error",
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      })
      .eq("id", runId);
    return {
      run_id: runId,
      status: "error",
      customers_count: 0,
      transactions_count: 0,
      report_rows: 0,
      duration_ms: duration,
      error_message: message,
    };
  }
}

/** Group transactions into per-period / customer / lab / provider / LOB metrics. */
export function aggregateSnapshots(rows: TxRow[]) {
  const map = new Map<
    string,
    {
      year: number;
      month: number;
      customer_name: string;
      lab_name: string;
      cloud_provider: string;
      line_of_business: string;
      transactions_count: number;
      total_users: number;
      revenue: number;
      cost: number;
      profit: number;
      margin_pct: number;
    }
  >();
  for (const r of rows) {
    const key = [
      r.year,
      r.month,
      r.customer_name,
      r.lab_name,
      r.cloud_provider,
      r.line_of_business,
    ].join("||");
    const cur = map.get(key) ?? {
      year: r.year,
      month: r.month,
      customer_name: r.customer_name,
      lab_name: r.lab_name,
      cloud_provider: r.cloud_provider,
      line_of_business: r.line_of_business,
      transactions_count: 0,
      total_users: 0,
      revenue: 0,
      cost: 0,
      profit: 0,
      margin_pct: 0,
    };
    cur.transactions_count += 1;
    cur.total_users = addNullable(cur.total_users, r.total_users);
    cur.revenue = addNullable(cur.revenue, r.selling_cost);
    cur.cost = addNullable(cur.cost, effectiveCost(r).amount);
    map.set(key, cur);
  }
  return [...map.values()].map((v) => {
    const profit = v.revenue - v.cost;
    return {
      ...v,
      profit,
      margin_pct: v.revenue > 0 ? (profit / v.revenue) * 100 : 0,
    };
  });
}
