import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FRESHDESK_HEALTH, summarizeSyncHealth, type SyncHealth } from "@/lib/sync-health";

export interface SyncRunRow {
  id: string;
  kind: string;
  trigger_source: string;
  status: string;
  customers_count: number;
  transactions_count: number;
  report_rows: number;
  error_message: string | null;
  triggered_by_email: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  /** Freshdesk runs only (SCRUM-74 migration); absent until it is applied. */
  fetched_count?: number | null;
  upserted_count?: number | null;
}

export interface SnapshotRow {
  id: string;
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

export interface SyncOverview {
  runs: SyncRunRow[];
  last_success: SyncRunRow | null;
  live_counts: { customers: number; transactions: number };
  snapshot_rows: number;
  next_cron_at: string;
  /** SCRUM-74: hourly Freshdesk sync, recorded in sync_runs with kind = 'freshdesk'. */
  freshdesk: { runs: SyncRunRow[]; health: SyncHealth };
}

/** Daily schedule: 02:00 UTC. */
function nextCronAt(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export const getSyncOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncOverview> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    const [{ data: runs, error: runsErr }, { data: fdRuns, error: fdErr }, customers, transactions, snaps] = await Promise.all([
      sb.from("sync_runs").select("*").eq("kind", "snapshot").order("started_at", { ascending: false }).limit(50),
      sb.from("sync_runs").select("*").eq("kind", "freshdesk").order("started_at", { ascending: false }).limit(48),
      sb.from("customers").select("id", { count: "exact", head: true }),
      sb.from("transactions").select("id", { count: "exact", head: true }).eq("is_deleted", false),
      sb.from("report_snapshots").select("id", { count: "exact", head: true }),
    ]);
    if (runsErr) throw new Error(runsErr.message);
    if (fdErr) throw new Error(fdErr.message);
    const list = (runs ?? []) as SyncRunRow[];
    const fdList = (fdRuns ?? []) as SyncRunRow[];
    return {
      runs: list,
      last_success: list.find((r) => r.status === "success") ?? null,
      live_counts: {
        customers: Number(customers.count ?? 0),
        transactions: Number(transactions.count ?? 0),
      },
      snapshot_rows: Number(snaps.count ?? 0),
      next_cron_at: nextCronAt(),
      freshdesk: { runs: fdList, health: summarizeSyncHealth(fdList, new Date(), FRESHDESK_HEALTH) },
    };
  });

/** Admin-only manual run. */
export const triggerSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    } as never);
    if (!isAdmin) throw new Error("Only admins can trigger a snapshot run");
    const { runSnapshotSync } = await import("@/lib/sync.server");
    return runSnapshotSync({
      trigger_source: "manual",
      triggered_by: context.userId,
      triggered_by_email: (context.claims as { email?: string } | null)?.email ?? null,
    });
  });

/** Snapshot rows for one run (paged in the UI). */
export const listSnapshotRows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string; limit?: number }) =>
    z.object({ run_id: z.string().uuid(), limit: z.number().int().min(1).max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<SnapshotRow[]> => {
    const sb = context.supabase as unknown as { from: (t: string) => any };
    const { data: rows, error } = await sb
      .from("report_snapshots")
      .select("*")
      .eq("run_id", data.run_id)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) throw new Error(error.message);
    return (rows ?? []) as SnapshotRow[];
  });
