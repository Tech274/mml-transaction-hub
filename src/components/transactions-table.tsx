// SCRUM-128 C7 (plan P05): the All transactions list on the shared standard: one FilterBar
// (search, selects, actions, page summary), TableStateRow, TablePagination, IncompleteBadge next
// to the customer. The dead showPublicCloudInsights / compactFilters / KpiTile code (C2 → C7) is
// gone. The numbers live in lib/transactions-list.ts (moved verbatim, pinned in its test).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TransactionDetailDrawer } from "./transaction-detail-drawer";
import { fmtCurrency, fmtDate, fmtDateTime, fmtNumber, MONTH_NAMES, YEARS } from "@/lib/format";
import { effectiveCost } from "@/lib/cost-calculator";
import { exportToExcel } from "@/lib/export-xlsx";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { ProviderSelectItems } from "@/components/cloud/provider-select-items";
import { CloudTypeBadge } from "@/components/cloud/cloud-type-badge";
import { IncompleteBadge } from "@/components/status-badges";
import {
  FilterActions,
  FilterBar,
  FilterSearch,
  FilterSelect,
  FilterSummary,
} from "@/components/filter-bar";
import { TablePagination, TableStateRow } from "@/components/data-table-parts";
import { highlight, tokenize } from "@/lib/highlight";
import {
  applyCompletenessQuery,
  incompleteReasons,
  isIncompleteTransaction,
  transactionListPlan,
  sortTransactionRows,
  type CompletenessFilter,
} from "@/lib/transaction-completeness";
import {
  transactionExportName,
  transactionExportRow,
  transactionPageSummary,
  transactionRowProfit,
  type RepoFilter,
} from "@/lib/transactions-list";
import { cn } from "@/lib/utils";

export type { RepoFilter };

interface Filters {
  search: string;
  month: string;
  year: string;
  customer: string;
  provider: string;
  lob: string;
  startFrom: string;
  startTo: string;
  systemConfig: string;
}

type SortMode = "recent" | "relevance";

const initial: Filters = {
  search: "",
  month: "all",
  year: "all",
  customer: "all",
  provider: "all",
  lob: "all",
  startFrom: "",
  startTo: "",
  systemConfig: "all",
};

const SYSTEM_CONFIG_OPTIONS = [
  "8GB 2vCPUs",
  "8GB 4vCPUs",
  "12GB 4vCPUs",
  "16GB 4vCPUs",
  "24GB 6vCPUs",
  "32GB 8vCPUs",
] as const;

const MONTH_OPTIONS = MONTH_NAMES.map((m, i) => ({ value: String(i + 1), label: m }));
const YEAR_OPTIONS = YEARS.map((y) => ({ value: String(y), label: String(y) }));
const SYSTEM_CONFIG_SELECT_OPTIONS = SYSTEM_CONFIG_OPTIONS.map((c) => ({ value: c, label: c }));

export function TransactionsTable({
  repoFilter = "all",
  showProviderFilter = true,
  initialFilters,
  pageSize = 25,
  completeness: completenessProp,
  onCompletenessChange,
}: {
  repoFilter?: RepoFilter;
  showProviderFilter?: boolean;
  initialFilters?: {
    q?: string;
    month?: number;
    year?: number;
    provider?: string;
    lob?: string;
    systemConfig?: string;
  };
  pageSize?: number;
  /** SCRUM-131: controlled by the route's ?completeness= (same param as the cloud views). */
  completeness?: CompletenessFilter;
  onCompletenessChange?: (filter: CompletenessFilter) => void;
}) {
  const [filters, setFilters] = useState<Filters>({
    ...initial,
    search: initialFilters?.q ?? initial.search,
    month: initialFilters?.month ? String(initialFilters.month) : initial.month,
    year: initialFilters?.year ? String(initialFilters.year) : initial.year,
    provider: initialFilters?.provider ?? initial.provider,
    lob: initialFilters?.lob ?? initial.lob,
    systemConfig: initialFilters?.systemConfig ?? initial.systemConfig,
  });

  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  // SCRUM-131 (Eng QC fix 4): Complete/Incomplete uses isIncompleteTransaction only (never the
  // DB is_complete column); the filter lives in the URL when the route passes it.
  const [completenessState, setCompletenessState] = useState<CompletenessFilter>("all");
  const completeness = completenessProp ?? completenessState;
  const setCompleteness = onCompletenessChange ?? setCompletenessState;
  const { user, isAdmin } = useAuth();
  const [hybridOnly, setHybridOnly] = useState(false);
  const { data: hybridIds = [] } = useQuery({
    queryKey: ["hybrid-ids"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_tags")
        .select("transaction_id")
        .eq("tag", "hybrid");
      if (error) return [];
      return (data ?? []).map((t) => t.transaction_id);
    },
  });
  const { can } = usePermissions();

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "all-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, customer_name")
        .order("customer_name");
      return data ?? [];
    },
  });

  const { data: lobs = [] } = useQuery({
    queryKey: ["config", "line_of_business", "labels"],
    queryFn: async () => {
      const { data } = await supabase
        .from("config_master")
        .select("label")
        .eq("category", "line_of_business")
        .eq("is_active", true)
        .order("sort_order");
      return (data ?? []).map((d) => d.label);
    },
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [
      "transactions",
      repoFilter,
      filters,
      page,
      sortMode,
      completeness,
      hybridOnly,
      hybridIds,
    ],
    queryFn: async () => {
      let scoreMap: Map<string, number> | null = null;
      if (filters.search.trim()) {
        const { data: matches, error: rpcErr } = await supabase.rpc("fuzzy_search_transactions", {
          q: filters.search.trim(),
          threshold: 0.25,
          max_rows: 500,
        });
        if (rpcErr) throw rpcErr;
        scoreMap = new Map(
          (matches ?? []).map((m: { id: string; score: number }) => [m.id, Number(m.score)]),
        );
        if (scoreMap.size === 0) return { rows: [], count: 0, scoreMap, incompleteCount: 0 };
      }
      const fuzzy = scoreMap !== null;
      const plan = transactionListPlan({ completeness, sortMode, fuzzy });
      const ids = fuzzy ? Array.from(scoreMap!.keys()) : null;
      // Same predicate for the page and the Incomplete count, so the dropdown
      // number matches the list once that option is chosen. Sort and range
      // happen after the predicate, so pages stay correct.
      const applyShared = <Q extends { eq: Function; gte: Function; lte: Function; in: Function }>(
        query: Q,
      ): Q => {
        let next = query.eq("is_deleted", false);
        if (repoFilter !== "all") next = next.eq("repository_type", repoFilter);
        if (filters.month !== "all") next = next.eq("month", Number(filters.month));
        if (filters.year !== "all") next = next.eq("year", Number(filters.year));
        if (filters.customer !== "all") next = next.eq("customer_id", filters.customer);
        if (filters.provider !== "all") next = next.eq("cloud_provider", filters.provider);
        if (filters.lob !== "all") next = next.eq("line_of_business", filters.lob);
        if (filters.startFrom) next = next.gte("start_date", filters.startFrom);
        if (filters.startTo) next = next.lte("start_date", filters.startTo);
        if (filters.systemConfig !== "all") next = next.eq("system_config", filters.systemConfig);
        if (ids) next = next.in("id", ids);
        if (isAdmin && hybridOnly)
          next = next.in(
            "id",
            hybridIds.length ? hybridIds : ["00000000-0000-0000-0000-000000000000"],
          );
        return next;
      };
      let listQuery = applyShared(supabase.from("transactions").select("*", { count: "exact" }));
      // Same rule as isIncompleteTransaction, applied in the query before pagination.
      listQuery = applyCompletenessQuery(
        listQuery,
        plan.isComplete == null ? null : plan.isComplete ? "complete" : "incomplete",
      );
      const countQuery = applyCompletenessQuery(
        applyShared(supabase.from("transactions").select("id", { count: "exact", head: true })),
        "incomplete",
      );
      if (fuzzy) {
        const [{ data, error }, countResult] = await Promise.all([listQuery, countQuery]);
        if (error) throw error;
        if (countResult.error) throw countResult.error;
        const all = sortTransactionRows(data ?? [], sortMode, (id) => scoreMap!.get(id) ?? 0);
        const start = page * pageSize;
        return {
          rows: all.slice(start, start + pageSize),
          allRows: all,
          count: all.length,
          scoreMap,
          incompleteCount: countResult.count ?? 0,
        };
      }
      const ordered = plan.serverOrder
        ? listQuery.order(plan.serverOrder.column, { ascending: plan.serverOrder.ascending })
        : listQuery;
      const [{ data: pageData, count, error }, countResult] = await Promise.all([
        ordered.range(page * pageSize, page * pageSize + pageSize - 1),
        countQuery,
      ]);
      if (error) throw error;
      if (countResult.error) throw countResult.error;
      return {
        rows: pageData ?? [],
        count: count ?? 0,
        scoreMap: null,
        incompleteCount: countResult.count ?? 0,
      };
    },
  });
  const queryError = error instanceof Error ? error : null;

  const rows = data?.rows ?? [];
  const allRows = (data as { allRows?: typeof rows } | undefined)?.allRows ?? rows;
  const scoreMap = data?.scoreMap ?? null;
  const total = data?.count ?? 0;
  const incompleteCount = data?.incompleteCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const searchTokens = useMemo(() => tokenize(filters.search), [filters.search]);
  const isFuzzy = searchTokens.length > 0;
  const tableColSpan = 14 + (showProviderFilter ? 1 : 0) + (isFuzzy ? 1 : 0);

  const summary = useMemo(() => transactionPageSummary(rows), [rows]);

  function exportCurrent() {
    const exportRows = isFuzzy ? allRows : rows;
    exportToExcel(
      transactionExportName(repoFilter),
      exportRows.map((r) => transactionExportRow(r, repoFilter, isFuzzy, scoreMap?.get(r.id) ?? 0)),
      {
        generatedBy: user?.email ?? "—",
        filters: { repository: repoFilter, sortMode, completeness, ...filters },
      },
    );
  }

  const setFilter = (patch: Partial<Filters>) => {
    setFilters({ ...filters, ...patch });
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <FilterBar
        summary={
          <FilterSummary
            items={[
              { label: "Records", value: fmtNumber(total) },
              { label: "Incomplete", value: fmtNumber(incompleteCount) },
              { label: "Page users", value: fmtNumber(summary.users) },
              { label: "Page revenue", value: fmtCurrency(summary.revenue) },
              { label: "Page cost", value: fmtCurrency(summary.cost) },
              { label: "Page profit", value: fmtCurrency(summary.profit) },
            ]}
          />
        }
      >
        <div className="w-full md:w-72">
          <FilterSearch
            value={filters.search}
            onChange={(search) => setFilter({ search })}
            placeholder="Fuzzy search: ID, customer, lab, provider, LOB…"
            label="Search transactions"
          />
        </div>
        <FilterSelect
          label="Month"
          value={filters.month}
          onValueChange={(month) => setFilter({ month })}
          allLabel="All months"
          options={MONTH_OPTIONS}
        />
        <FilterSelect
          label="Year"
          value={filters.year}
          onValueChange={(year) => setFilter({ year })}
          allLabel="All years"
          options={YEAR_OPTIONS}
        />
        <FilterSelect
          label="Customer"
          width="md"
          value={filters.customer}
          onValueChange={(customer) => setFilter({ customer })}
          allLabel="All customers"
          options={customers.map((c) => ({ value: c.id, label: c.customer_name }))}
        />
        <FilterSelect
          label="LOB"
          value={filters.lob}
          onValueChange={(lob) => setFilter({ lob })}
          allLabel="All LOB"
          options={lobs.map((l) => ({ value: l, label: l }))}
        />
        {showProviderFilter && (
          <FilterSelect
            label="Provider"
            value={filters.provider}
            onValueChange={(provider) => setFilter({ provider })}
            allLabel="All providers"
          >
            {/* SCRUM-129: the six providers, grouped Private / Public. */}
            <ProviderSelectItems />
          </FilterSelect>
        )}
        {repoFilter !== "public_cloud" && (
          <FilterSelect
            label="System config"
            value={filters.systemConfig}
            onValueChange={(systemConfig) => setFilter({ systemConfig })}
            allLabel="All system configs"
            options={SYSTEM_CONFIG_SELECT_OPTIONS}
          />
        )}
        <div className="grid w-full grid-cols-2 gap-2 md:w-auto">
          <div>
            <Label className="sr-only" htmlFor="tx-start-from">
              Start date from
            </Label>
            <Input
              id="tx-start-from"
              type="date"
              title="Start date from"
              value={filters.startFrom}
              onChange={(e) => setFilter({ startFrom: e.target.value })}
            />
          </div>
          <div>
            <Label className="sr-only" htmlFor="tx-start-to">
              Start date to
            </Label>
            <Input
              id="tx-start-to"
              type="date"
              title="Start date to"
              value={filters.startTo}
              onChange={(e) => setFilter({ startTo: e.target.value })}
            />
          </div>
        </div>
        <div data-testid="completeness-filter" className="contents">
          <FilterSelect
            label="Status"
            value={completeness}
            onValueChange={(v) => {
              setCompleteness(v as CompletenessFilter);
              setPage(0);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "complete", label: "Complete" },
              { value: "incomplete", label: `Incomplete (${fmtNumber(incompleteCount)})` },
            ]}
          />
        </div>
        <FilterSelect
          label="Sort"
          value={sortMode}
          onValueChange={(v) => {
            setSortMode(v as SortMode);
            setPage(0);
          }}
          options={[
            { value: "recent", label: "Most recent" },
            // Relevance only applies to a fuzzy search (was a disabled item).
            ...(isFuzzy || sortMode === "relevance"
              ? [{ value: "relevance", label: "Relevance score" }]
              : []),
          ]}
        />
        <FilterActions>
          {isAdmin && (
            <Button
              type="button"
              variant={hybridOnly ? "default" : "outline"}
              size="sm"
              data-testid="hybrid-only"
              onClick={() => {
                setHybridOnly((v) => !v);
                setPage(0);
              }}
            >
              Hybrid only ({hybridIds.length})
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(initial);
              setPage(0);
              setSortMode("recent");
              setCompleteness("all");
            }}
          >
            Reset
          </Button>
          {can("feature_excel_export") && (
            <Button size="sm" onClick={exportCurrent}>
              <Download className="mr-1 size-4" aria-hidden />
              Export{isFuzzy ? ` (${allRows.length})` : ""}
            </Button>
          )}
        </FilterActions>
      </FilterBar>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Potential ID</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Cloud type</TableHead>
              <TableHead>Lab</TableHead>
              {showProviderFilter && <TableHead>Provider</TableHead>}
              <TableHead>LOB</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>End</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead>Cost source</TableHead>
              <TableHead className="text-right">Input cost</TableHead>
              <TableHead className="text-right">Selling cost</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              {isFuzzy && <TableHead className="text-right">Score</TableHead>}
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableStateRow colSpan={tableColSpan}>Loading transactions…</TableStateRow>
            )}
            {!isLoading && queryError && (
              <TableStateRow colSpan={tableColSpan} onRetry={() => void refetch()}>
                Could not load transactions: {queryError.message}
              </TableStateRow>
            )}
            {!isLoading && !queryError && rows.length === 0 && (
              <TableStateRow colSpan={tableColSpan}>
                No transactions match the current filters.
              </TableStateRow>
            )}
            {rows.map((r) => {
              const cost = effectiveCost(r);
              const profit = transactionRowProfit(r);
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setOpenId(r.id)}
                >
                  <TableCell className="whitespace-nowrap font-medium">
                    {highlight(r.potential_id, searchTokens)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.month ? `${MONTH_NAMES[r.month - 1]} ${r.year ?? ""}` : "—"}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      {highlight(r.customer_name, searchTokens)}
                      {isIncompleteTransaction(r) && (
                        <IncompleteBadge reasons={incompleteReasons(r)} className="shrink-0" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <CloudTypeBadge value={r.repository_type} />
                  </TableCell>
                  <TableCell className="max-w-60 truncate" title={r.lab_name ?? undefined}>
                    {highlight(r.lab_name, searchTokens)}
                  </TableCell>
                  {showProviderFilter && (
                    <TableCell>
                      <Badge variant="outline">{highlight(r.cloud_provider, searchTokens)}</Badge>
                    </TableCell>
                  )}
                  <TableCell>{highlight(r.line_of_business, searchTokens)}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.start_date)}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.end_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNumber(r.total_users)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" data-testid="cost-source">
                      {cost.basis === "auto_avg" ? "Auto (avg)" : cost.basis}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtCurrency(cost.amount ?? r.input_cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtCurrency(r.selling_cost)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      profit != null && profit < 0 && "text-destructive",
                    )}
                  >
                    {profit == null ? "—" : fmtCurrency(profit)}
                  </TableCell>
                  {isFuzzy && (
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {(scoreMap?.get(r.id) ?? 0).toFixed(2)}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtDateTime(r.updated_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t border-border px-4 py-3">
          <TablePagination
            page={page + 1}
            pageCount={totalPages}
            onPageChange={(next) => setPage(next - 1)}
            summary={`Page ${page + 1} of ${totalPages}`}
          />
        </div>
      </Card>

      <TransactionDetailDrawer
        transactionId={openId}
        open={!!openId}
        onOpenChange={(b) => !b && setOpenId(null)}
      />
    </div>
  );
}
