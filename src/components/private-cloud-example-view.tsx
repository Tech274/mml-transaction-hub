import { useMemo, useState } from "react";
import { fmtCurrency, fmtDateTime, fmtNumber } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ExampleBatch = {
  id: string;
  batchCode: string;
  name: string;
  status: "open" | "closed";
  revenue: number;
  estimatedCost: number;
  actualCost: number;
  updatedAt: string;
};

type ExampleLine = {
  id: string;
  labName: string;
  users: number;
  cost: number;
};

const EXAMPLE_BATCHES: ExampleBatch[] = [
  {
    id: "pb-1",
    batchCode: "LB-PRIV-0929-A",
    name: "Azure FinOps Cohort",
    status: "open",
    revenue: 285000,
    estimatedCost: 169500,
    actualCost: 162300,
    updatedAt: "2026-09-29T05:28:00Z",
  },
  {
    id: "pb-2",
    batchCode: "LB-PRIV-0929-B",
    name: "Cloud Security Bootcamp",
    status: "closed",
    revenue: 212000,
    estimatedCost: 132400,
    actualCost: 128000,
    updatedAt: "2026-09-28T15:20:00Z",
  },
  {
    id: "pb-3",
    batchCode: "LB-PRIV-0929-C",
    name: "Data Platform Residency",
    status: "open",
    revenue: 196000,
    estimatedCost: 118000,
    actualCost: 112200,
    updatedAt: "2026-09-27T11:45:00Z",
  },
];

const EXAMPLE_LINES: Record<string, ExampleLine[]> = {
  "pb-1": [
    { id: "pb-1-1", labName: "AKS Foundations", users: 25, cost: 58200 },
    { id: "pb-1-2", labName: "Azure DevSecOps", users: 19, cost: 47200 },
    { id: "pb-1-3", labName: "FinOps Lab", users: 22, cost: 56900 },
  ],
  "pb-2": [
    { id: "pb-2-1", labName: "Threat Modelling", users: 18, cost: 42100 },
    { id: "pb-2-2", labName: "SIEM Operations", users: 20, cost: 43900 },
    { id: "pb-2-3", labName: "Blue Team Drill", users: 14, cost: 42000 },
  ],
  "pb-3": [
    { id: "pb-3-1", labName: "Lakehouse Ops", users: 16, cost: 36200 },
    { id: "pb-3-2", labName: "Spark Performance", users: 15, cost: 38700 },
    { id: "pb-3-3", labName: "Pipeline Reliability", users: 13, cost: 37300 },
  ],
};

export function PrivateCloudExampleView() {
  const [selectedId, setSelectedId] = useState<string>(EXAMPLE_BATCHES[0].id);
  const selected = EXAMPLE_BATCHES.find((batch) => batch.id === selectedId) ?? EXAMPLE_BATCHES[0];
  const lines = EXAMPLE_LINES[selected.id] ?? [];

  const kpis = useMemo(() => {
    const revenue = EXAMPLE_BATCHES.reduce((sum, row) => sum + row.revenue, 0);
    const estimatedProfit = EXAMPLE_BATCHES.reduce((sum, row) => sum + (row.revenue - row.estimatedCost), 0);
    const actualProfit = EXAMPLE_BATCHES.reduce((sum, row) => sum + (row.revenue - row.actualCost), 0);
    return {
      total: EXAMPLE_BATCHES.length,
      open: EXAMPLE_BATCHES.filter((row) => row.status === "open").length,
      revenue,
      estimatedProfit,
      actualProfit,
    };
  }, []);

  const lineCostTotal = lines.reduce((sum, line) => sum + line.cost, 0);
  const isReconciled = Math.abs(lineCostTotal - selected.actualCost) < 0.01;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Private batches" value={fmtNumber(kpis.total)} />
        <KpiCard label="Open batches" value={fmtNumber(kpis.open)} sublabel={`${fmtNumber(kpis.total - kpis.open)} closed`} />
        <KpiCard label="Revenue total" value={fmtCurrency(kpis.revenue)} />
        <KpiCard
          label="Profit total"
          value={fmtCurrency(kpis.actualProfit)}
          sublabel={`Estimated ${fmtCurrency(kpis.estimatedProfit)} · Actual ${fmtCurrency(kpis.actualProfit)}`}
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
                {EXAMPLE_BATCHES.map((batch) => (
                  <TableRow
                    key={batch.id}
                    className={selected.id === batch.id ? "bg-muted/50" : "cursor-pointer hover:bg-muted/40"}
                    onClick={() => setSelectedId(batch.id)}
                  >
                    <TableCell>
                      <div className="font-medium">{batch.batchCode}</div>
                      <div className="text-xs text-muted-foreground">{batch.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={batch.status === "open" ? "secondary" : "outline"}>{batch.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtCurrency(batch.revenue)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(batch.revenue - batch.actualCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{selected.batchCode} details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={selected.status === "open" ? "secondary" : "outline"}>{selected.status}</Badge>
              <span className="text-xs text-muted-foreground">Updated {fmtDateTime(selected.updatedAt)}</span>
            </div>
            <div>Revenue {fmtCurrency(selected.revenue)}</div>
            <div>Estimated cost {fmtCurrency(selected.estimatedCost)} · Estimated profit {fmtCurrency(selected.revenue - selected.estimatedCost)}</div>
            <div>Actual cost {fmtCurrency(selected.actualCost)} · Actual profit {fmtCurrency(selected.revenue - selected.actualCost)}</div>
            <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>
                  Actual reconciliation: Σ line actual cost = {fmtCurrency(lineCostTotal)} · batch actual cost ={" "}
                  {fmtCurrency(selected.actualCost)}
                </span>
                {isReconciled ? <Badge variant="default">Reconciled ✓</Badge> : <Badge variant="destructive">Mismatch</Badge>}
              </div>
              <div className="mt-1">Estimate reference: batch estimated cost = {fmtCurrency(selected.estimatedCost)}</div>
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
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.labName}</TableCell>
                    <TableCell className="text-right">{fmtNumber(line.users)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(line.cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
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
