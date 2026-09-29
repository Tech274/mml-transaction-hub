import { useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtCurrency } from "@/lib/format";

type ExampleRow = {
  id: string;
  potentialId: string;
  period: string;
  customer: string;
  lab: string;
  provider: "AWS" | "Azure" | "GCP";
  lob: string;
  users: number;
  inputCost: number;
  sellingCost: number;
  creditAllocated: number;
  actualConsumption: number;
  updatedAt: string;
};

const EXAMPLE_ROWS: ExampleRow[] = [
  { id: "tx-001", potentialId: "DEMO-PUB-001", period: "Sep 2026", customer: "Cognizant", lab: "DevOps Pro", provider: "Azure", lob: "Training", users: 42, inputCost: 48200, sellingCost: 67600, creditAllocated: 52000, actualConsumption: 46850, updatedAt: "29 Sep, 05:18" },
  { id: "tx-002", potentialId: "DEMO-PUB-002", period: "Sep 2026", customer: "Infosys", lab: "Data Engineering", provider: "AWS", lob: "Delivery", users: 30, inputCost: 39100, sellingCost: 57500, creditAllocated: 43000, actualConsumption: 38920, updatedAt: "29 Sep, 05:06" },
  { id: "tx-003", potentialId: "DEMO-PUB-003", period: "Sep 2026", customer: "TCS", lab: "AI Foundations", provider: "Azure", lob: "Training", users: 55, inputCost: 73400, sellingCost: 96500, creditAllocated: 76000, actualConsumption: 72130, updatedAt: "29 Sep, 04:59" },
  { id: "tx-004", potentialId: "DEMO-PUB-004", period: "Sep 2026", customer: "Wipro", lab: "Kubernetes Ops", provider: "GCP", lob: "Support", users: 24, inputCost: 28800, sellingCost: 44600, creditAllocated: 31500, actualConsumption: 28240, updatedAt: "29 Sep, 04:43" },
  { id: "tx-005", potentialId: "DEMO-PUB-005", period: "Sep 2026", customer: "HCL", lab: "Cloud Security", provider: "Azure", lob: "Delivery", users: 33, inputCost: 41900, sellingCost: 63100, creditAllocated: 45500, actualConsumption: 40210, updatedAt: "29 Sep, 04:31" },
  { id: "tx-006", potentialId: "DEMO-PUB-006", period: "Sep 2026", customer: "Capgemini", lab: "Platform SRE", provider: "AWS", lob: "Training", users: 20, inputCost: 22900, sellingCost: 35200, creditAllocated: 25000, actualConsumption: 21980, updatedAt: "29 Sep, 04:19" },
  { id: "tx-007", potentialId: "DEMO-PUB-007", period: "Sep 2026", customer: "Accenture", lab: "API Engineering", provider: "Azure", lob: "Delivery", users: 37, inputCost: 44600, sellingCost: 68600, creditAllocated: 47000, actualConsumption: 44120, updatedAt: "29 Sep, 04:08" },
  { id: "tx-008", potentialId: "DEMO-PUB-008", period: "Sep 2026", customer: "TechM", lab: "Observability", provider: "GCP", lob: "Support", users: 26, inputCost: 31200, sellingCost: 47800, creditAllocated: 33750, actualConsumption: 29890, updatedAt: "29 Sep, 03:58" },
  { id: "tx-009", potentialId: "DEMO-PUB-009", period: "Sep 2026", customer: "LTIMindtree", lab: "Prompt Engineering", provider: "Azure", lob: "Training", users: 46, inputCost: 59200, sellingCost: 87400, creditAllocated: 62000, actualConsumption: 57120, updatedAt: "29 Sep, 03:44" },
  { id: "tx-010", potentialId: "DEMO-PUB-010", period: "Sep 2026", customer: "Persistent", lab: "FinOps", provider: "AWS", lob: "Delivery", users: 29, inputCost: 36100, sellingCost: 54800, creditAllocated: 38800, actualConsumption: 34970, updatedAt: "29 Sep, 03:33" },
];

export function PublicCloudExampleView() {
  const hash = useRouterState({ select: (router) => router.location.hash });
  const windowHash = typeof window !== "undefined" ? window.location.hash : "";
  const [selectedId, setSelectedId] = useState<string>(EXAMPLE_ROWS[0]?.id ?? "");
  const selected = EXAMPLE_ROWS.find((row) => row.id === selectedId) ?? EXAMPLE_ROWS[0];
  const showSidePanel = hash === "#side-panel" || windowHash === "#side-panel";

  const insights = useMemo(() => {
    const txCount = EXAMPLE_ROWS.length;
    const creditAllocated = EXAMPLE_ROWS.reduce((sum, row) => sum + row.creditAllocated, 0);
    const actualConsumption = EXAMPLE_ROWS.reduce((sum, row) => sum + row.actualConsumption, 0);
    const unusedCredit = creditAllocated - actualConsumption;
    const margin = EXAMPLE_ROWS.reduce((sum, row) => sum + (row.sellingCost - row.inputCost), 0);
    return { txCount, creditAllocated, actualConsumption, unusedCredit, margin };
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">Fuzzy search: customer, lab, potential ID</div>
            <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">Hybrid only (0)</div>
            <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">All months · All years</div>
            <div className="rounded-md border border-border bg-card px-3 py-2 text-xs">All customers · All providers</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{EXAMPLE_ROWS.length} records</span>
            <span>Page size: 10</span>
            <span>Page revenue: {fmtCurrency(EXAMPLE_ROWS.reduce((sum, row) => sum + row.sellingCost, 0))}</span>
            <span>Page cost: {fmtCurrency(EXAMPLE_ROWS.reduce((sum, row) => sum + row.inputCost, 0))}</span>
          </div>
        </CardContent>
      </Card>

      <div className={showSidePanel ? "grid gap-4 xl:grid-cols-[1.5fr_1fr]" : "space-y-4"}>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Public cloud transactions (example)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Potential ID</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Lab</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Users</TableHead>
                  <TableHead className="text-right">Input Cost</TableHead>
                  <TableHead className="text-right">Selling Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {EXAMPLE_ROWS.map((row) => (
                  <TableRow
                    key={row.id}
                    className={showSidePanel && row.id === selected.id ? "bg-muted/40" : "cursor-pointer hover:bg-muted/30"}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <TableCell className="font-medium">{row.potentialId}</TableCell>
                    <TableCell>{row.period}</TableCell>
                    <TableCell>{row.customer}</TableCell>
                    <TableCell>{row.lab}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.provider}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{row.users}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(row.inputCost)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(row.sellingCost)}</TableCell>
                    <TableCell className="text-right">{fmtCurrency(row.sellingCost - row.inputCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {showSidePanel && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Transaction side panel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="font-medium">{selected.potentialId}</div>
              <div>Customer: {selected.customer}</div>
              <div>Lab: {selected.lab}</div>
              <div>Provider: {selected.provider}</div>
              <div>LOB: {selected.lob}</div>
              <div>Users: {selected.users}</div>
              <div>Input cost: {fmtCurrency(selected.inputCost)}</div>
              <div>Selling cost: {fmtCurrency(selected.sellingCost)}</div>
              <div>Margin: {fmtCurrency(selected.sellingCost - selected.inputCost)}</div>
              <div className="text-xs text-muted-foreground">Updated {selected.updatedAt}</div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">KPI insights (current page)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Insight label="Transactions shown" value={String(insights.txCount)} />
          <Insight label="Credit allocated" value={fmtCurrency(insights.creditAllocated)} />
          <Insight label="Actual consumption" value={fmtCurrency(insights.actualConsumption)} />
          <Insight label="Unused credit" value={fmtCurrency(insights.unusedCredit)} />
          <Insight label="Actual margin" value={fmtCurrency(insights.margin)} />
        </CardContent>
      </Card>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
