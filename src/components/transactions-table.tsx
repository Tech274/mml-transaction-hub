import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { TransactionDetailDrawer } from "./transaction-detail-drawer";
import { fmtCurrency, fmtDate, fmtDateTime, fmtNumber, MONTH_NAMES, YEARS } from "@/lib/format";
import { effectiveCost } from "@/lib/cost-calculator";
import { addNullable } from "@/lib/nullable-sum";
import { exportToExcel } from "@/lib/export-xlsx";
import { Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { usePermissions } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { highlight, tokenize } from "@/lib/highlight";
import {
  isTransactionComplete,
  transactionListPlan,
  sortTransactionRows,
  type CompletenessFilter,
} from "@/lib/transaction-completeness";

export type RepoFilter = "all" | "public_cloud" | "private_cloud";

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

export function TransactionsTable({
  repoFilter = "all",
  showProviderFilter = true,
  initialFilters,
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
  const [completeness, setCompleteness] = useState<CompletenessFilter>("all");
  const pageSize = 25;
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

  const { data, isLoading } = useQuery({
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
      if (plan.isComplete != null) listQuery = listQuery.eq("is_complete", plan.isComplete);
      const countQuery = applyShared(
        supabase.from("transactions").select("id", { count: "exact", head: true }),
      ).eq("is_complete", false);
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

  const rows = data?.rows ?? [];
  const allRows = (data as { allRows?: typeof rows } | undefined)?.allRows ?? rows;
  const scoreMap = data?.scoreMap ?? null;
  const total = data?.count ?? 0;
  const incompleteCount = data?.incompleteCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const searchTokens = useMemo(() => tokenize(filters.search), [filters.search]);
  const isFuzzy = searchTokens.length > 0;

  const summary = useMemo(
    () => ({
      users: rows.reduce((s, r) => addNullable(s, r.total_users), 0),
      revenue: rows.reduce((s, r) => addNullable(s, r.selling_cost), 0),
      cost: rows.reduce((s, r) => addNullable(s, r.input_cost), 0),
      profit: rows.reduce(
        (s, r) => s + addNullable(0, r.selling_cost) - addNullable(0, r.input_cost),
        0,
      ),
    }),
    [rows],
  );

  function exportCurrent() {
    const exportRows = isFuzzy ? allRows : rows;
    exportToExcel(
      repoFilter === "public_cloud"
        ? "public-cloud"
        : repoFilter === "private_cloud"
          ? "private-cloud"
          : "all-transactions",
      exportRows.map((r) => ({
        "Potential ID": r.potential_id,
        Month: r.month ? MONTH_NAMES[r.month - 1] : "",
        Year: r.year,
        Customer: r.customer_name,
        "Lab Name": r.lab_name,
        Repository: r.repository_type,
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
                  ((Number(r.selling_cost) - addNullable(0, r.input_cost)) /
                    Number(r.selling_cost)) *
                  100
                ).toFixed(2),
              )
            : null,
        ...(isFuzzy ? { "Relevance Score": Number((scoreMap?.get(r.id) ?? 0).toFixed(4)) } : {}),
        "Created At": r.created_at,
        "Updated At": r.updated_at,
      })),
      {
        generatedBy: user?.email ?? "—",
        filters: { repository: repoFilter, sortMode, completeness, ...filters },
      },
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="col-span-2 lg:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Fuzzy search: ID, customer, lab, provider, LOB…"
              className="pl-9"
              value={filters.search}
              onChange={(e) => {
                setFilters({ ...filters, search: e.target.value });
                setPage(0);
              }}
            />
          </div>
          {isAdmin && (
            <Button
              type="button"
              variant={hybridOnly ? "default" : "outline"}
              data-testid="hybrid-only"
              onClick={() => {
                setHybridOnly((v) => !v);
                setPage(0);
              }}
            >
              Hybrid only ({hybridIds.length})
            </Button>
          )}
          <Select
            value={filters.month}
            onValueChange={(v) => {
              setFilters({ ...filters, month: v });
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Month" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {MONTH_NAMES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.year}
            onValueChange={(v) => {
              setFilters({ ...filters, year: v });
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.customer}
            onValueChange={(v) => {
              setFilters({ ...filters, customer: v });
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.customer_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.lob}
            onValueChange={(v) => {
              setFilters({ ...filters, lob: v });
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Line of Business" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All LOB</SelectItem>
              {lobs.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showProviderFilter && (
            <Select
              value={filters.provider}
              onValueChange={(v) => {
                setFilters({ ...filters, provider: v });
                setPage(0);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {["AWS", "Azure", "GCP", "MakeMyLabs Private Cloud"].map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {repoFilter !== "public_cloud" && (
            <Select
              value={filters.systemConfig}
              onValueChange={(v) => {
                setFilters({ ...filters, systemConfig: v });
                setPage(0);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="System Config" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All system configs</SelectItem>
                {SYSTEM_CONFIG_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-2">
            <Input
              type="date"
              value={filters.startFrom}
              onChange={(e) => {
                setFilters({ ...filters, startFrom: e.target.value });
                setPage(0);
              }}
            />
            <Input
              type="date"
              value={filters.startTo}
              onChange={(e) => {
                setFilters({ ...filters, startTo: e.target.value });
                setPage(0);
              }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-sm">
          <div className="flex flex-wrap gap-4 text-muted-foreground">
            <span>
              <strong className="text-foreground">{fmtNumber(total)}</strong> records
            </span>
            <span>
              Page users: <strong className="text-foreground">{fmtNumber(summary.users)}</strong>
            </span>
            <span>
              Page revenue:{" "}
              <strong className="text-foreground">{fmtCurrency(summary.revenue)}</strong>
            </span>
            <span>
              Page cost: <strong className="text-foreground">{fmtCurrency(summary.cost)}</strong>
            </span>
            <span>
              Page profit:{" "}
              <strong className={summary.profit < 0 ? "text-destructive" : "text-foreground"}>
                {fmtCurrency(summary.profit)}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={completeness}
              onValueChange={(v) => {
                setCompleteness(v as CompletenessFilter);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[200px]" data-testid="completeness-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="incomplete">
                  Incomplete ({fmtNumber(incompleteCount)})
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={sortMode}
              onValueChange={(v) => {
                setSortMode(v as SortMode);
                setPage(0);
              }}
            >
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Sort: Most recent</SelectItem>
                <SelectItem value="relevance" disabled={!isFuzzy}>
                  Sort: Relevance score
                </SelectItem>
              </SelectContent>
            </Select>
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
                <Download className="h-4 w-4 mr-1" />
                Export{isFuzzy ? ` (${allRows.length})` : ""}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Potential ID</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Lab</TableHead>
                {showProviderFilter && <TableHead>Provider</TableHead>}
                <TableHead>LOB</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead>Cost source</TableHead>
                <TableHead className="text-right">Input Cost</TableHead>
                <TableHead className="text-right">Selling Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                {isFuzzy && <TableHead className="text-right">Score</TableHead>}
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-10">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-10">
                    No transactions match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setOpenId(r.id)}
                >
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      {highlight(r.potential_id, searchTokens)}
                      {(r.is_complete === false ||
                        (r.is_complete == null && !isTransactionComplete(r))) && (
                        <Badge variant="secondary" data-testid="incomplete-badge">
                          Incomplete
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {r.month ? `${MONTH_NAMES[r.month - 1]} ${r.year ?? ""}` : "—"}
                  </TableCell>
                  <TableCell>{highlight(r.customer_name, searchTokens)}</TableCell>
                  <TableCell className="max-w-[240px] truncate">
                    {highlight(r.lab_name, searchTokens)}
                  </TableCell>
                  {showProviderFilter && (
                    <TableCell>
                      <Badge variant="outline">{highlight(r.cloud_provider, searchTokens)}</Badge>
                    </TableCell>
                  )}
                  <TableCell>{highlight(r.line_of_business, searchTokens)}</TableCell>
                  <TableCell>{fmtDate(r.start_date)}</TableCell>
                  <TableCell>{fmtDate(r.end_date)}</TableCell>
                  <TableCell className="text-right">{fmtNumber(r.total_users)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" data-testid="cost-source">
                      {effectiveCost(r).basis === "auto_avg"
                        ? "Auto (avg)"
                        : effectiveCost(r).basis}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtCurrency(effectiveCost(r).amount ?? r.input_cost)}
                  </TableCell>
                  <TableCell className="text-right">{fmtCurrency(r.selling_cost)}</TableCell>
                  <TableCell
                    className={`text-right ${addNullable(0, r.selling_cost) - addNullable(0, r.input_cost) < 0 ? "text-destructive" : ""}`}
                  >
                    {r.selling_cost == null && r.input_cost == null
                      ? "—"
                      : fmtCurrency(addNullable(0, r.selling_cost) - addNullable(0, r.input_cost))}
                  </TableCell>
                  {isFuzzy && (
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                      {(scoreMap?.get(r.id) ?? 0).toFixed(2)}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDateTime(r.updated_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
          <div className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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
