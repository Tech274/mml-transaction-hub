import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { effectiveCost } from "@/lib/cost-calculator";
import { addNullable } from "@/lib/nullable-sum";
import { fmtCurrency, fmtDateTime, fmtNumber } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PrivateBatch = {
  id: string;
  batch_code: string;
  name: string | null;
  status: string;
  revenue_total: number | null;
  estimated_cost_total: number | null;
  actual_cost_total: number | null;
  known_line_count: number | null;
  auto_line_count: number | null;
  updated_at: string;
};

type PrivateBatchLine = {
  id: string;
  potential_id: string | null;
  lab_name: string | null;
  total_users: number | null;
  selling_cost: number | null;
  input_cost: number | null;
  input_cost_auto: number | null;
  input_cost_actual_alloc: number | null;
};

export function PrivateCloudBatchesView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: batches = [] } = useQuery({
    queryKey: ["private-cloud-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_batches")
        .select(
          "id, batch_code, name, status, revenue_total, estimated_cost_total, actual_cost_total, known_line_count, auto_line_count, updated_at",
        )
        .eq("lab_type", "private_cloud")
        .order("batch_code");
      if (error) throw error;
      return (data ?? []) as PrivateBatch[];
    },
  });

  const selectedBatch = batches.find((batch) => batch.id === selectedId) ?? batches[0] ?? null;

  const { data: lines = [] } = useQuery({
    queryKey: ["private-cloud-batch-lines", selectedBatch?.id],
    enabled: !!selectedBatch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select(
          "id, potential_id, lab_name, total_users, selling_cost, input_cost, input_cost_auto, input_cost_actual_alloc",
        )
        .eq("lab_batch_id", selectedBatch!.id)
        .eq("is_deleted", false);
      if (error) throw error;
      return (data ?? []) as PrivateBatchLine[];
    },
  });

  const aggregate = useMemo(() => {
    return batches.reduce(
      (acc, batch) => {
        const estimatedProfit =
          batch.revenue_total != null && batch.estimated_cost_total != null
            ? Number(batch.revenue_total) - Number(batch.estimated_cost_total)
            : null;
        const actualProfit =
          batch.revenue_total != null && batch.actual_cost_total != null
            ? Number(batch.revenue_total) - Number(batch.actual_cost_total)
            : null;

        acc.totalBatches += 1;
        if (batch.status === "open") acc.openBatches += 1;
        acc.revenue = addNullable(acc.revenue, batch.revenue_total);
        acc.estimatedProfit = addNullable(acc.estimatedProfit, estimatedProfit);
        acc.actualProfit = addNullable(acc.actualProfit, actualProfit);
        return acc;
      },
      {
        totalBatches: 0,
        openBatches: 0,
        revenue: 0,
        estimatedProfit: 0,
        actualProfit: 0,
      },
    );
  }, [batches]);

  const lineCostTotal = useMemo(
    () => lines.reduce((sum, line) => addNullable(sum, effectiveCost(line).amount), 0),
    [lines],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Private batches" value={fmtNumber(aggregate.totalBatches)} />
        <KpiCard
          label="Open batches"
          value={fmtNumber(aggregate.openBatches)}
          sublabel={`${fmtNumber(aggregate.totalBatches - aggregate.openBatches)} closed`}
        />
        <KpiCard label="Revenue total" value={fmtCurrency(aggregate.revenue)} />
        <KpiCard
          label="Profit total"
          value={fmtCurrency(aggregate.actualProfit || aggregate.estimatedProfit)}
          sublabel={`Estimated ${fmtCurrency(aggregate.estimatedProfit)} · Actual ${fmtCurrency(aggregate.actualProfit)}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Private cloud batches</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No private cloud batches found.
                    </TableCell>
                  </TableRow>
                )}
                {batches.map((batch) => {
                  const estimatedProfit =
                    batch.revenue_total != null && batch.estimated_cost_total != null
                      ? Number(batch.revenue_total) - Number(batch.estimated_cost_total)
                      : null;
                  const actualProfit =
                    batch.revenue_total != null && batch.actual_cost_total != null
                      ? Number(batch.revenue_total) - Number(batch.actual_cost_total)
                      : null;
                  const displayProfit = actualProfit ?? estimatedProfit;
                  return (
                    <TableRow
                      key={batch.id}
                      className={selectedBatch?.id === batch.id ? "bg-muted/50" : "cursor-pointer hover:bg-muted/40"}
                      onClick={() => setSelectedId(batch.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{batch.batch_code}</div>
                        <div className="text-xs text-muted-foreground">{batch.name ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={batch.status === "open" ? "secondary" : "outline"}>
                          {batch.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmtCurrency(batch.revenue_total)}</TableCell>
                      <TableCell className="text-right">{fmtCurrency(displayProfit)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {selectedBatch ? `${selectedBatch.batch_code} details` : "Batch details"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!selectedBatch && (
              <div className="rounded-md border border-dashed border-border p-4 text-muted-foreground">
                Select a batch to view details.
              </div>
            )}

            {selectedBatch && (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant={selectedBatch.status === "open" ? "secondary" : "outline"}>
                    {selectedBatch.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Updated {fmtDateTime(selectedBatch.updated_at)}
                  </span>
                </div>
                <div>Revenue {fmtCurrency(selectedBatch.revenue_total)}</div>
                <div>
                  Estimated cost {fmtCurrency(selectedBatch.estimated_cost_total)} · Estimated profit{" "}
                  {fmtCurrency(
                    selectedBatch.revenue_total != null && selectedBatch.estimated_cost_total != null
                      ? Number(selectedBatch.revenue_total) - Number(selectedBatch.estimated_cost_total)
                      : null,
                  )}
                </div>
                <div>
                  Actual cost {fmtCurrency(selectedBatch.actual_cost_total)} · Actual profit{" "}
                  {fmtCurrency(
                    selectedBatch.revenue_total != null && selectedBatch.actual_cost_total != null
                      ? Number(selectedBatch.revenue_total) - Number(selectedBatch.actual_cost_total)
                      : null,
                  )}
                </div>
                <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                  Reconciliation: Σ transaction effective cost = {fmtCurrency(lineCostTotal)} · batch
                  estimated cost = {fmtCurrency(selectedBatch.estimated_cost_total)}
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead className="text-right">Users</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                          No transaction lines in this batch.
                        </TableCell>
                      </TableRow>
                    )}
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.lab_name ?? line.potential_id ?? "—"}</TableCell>
                        <TableCell className="text-right">{fmtNumber(line.total_users)}</TableCell>
                        <TableCell className="text-right">
                          {fmtCurrency(effectiveCost(line).amount ?? line.input_cost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {sublabel && <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}
