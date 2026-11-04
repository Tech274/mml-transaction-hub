import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterActions, FilterBar, FilterSelect } from "@/components/filter-bar";
import { TableStateRow } from "@/components/data-table-parts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { RefreshCw } from "lucide-react";
import { listAudit, AGENTS, type AuditItem } from "@/lib/ai-command-center.functions";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";
import { requireRouteRoles } from "@/lib/route-guard";

export const Route = createFileRoute("/_authenticated/ai-command-center/audit")({
  head: () => pageHead("/ai-command-center/audit"),
  beforeLoad: requireRouteRoles("/ai-command-center/audit"),
  component: AuditPage,
});

// §4.8: confirm success, reject destructive, run secondary, propose outline.
const ACTION_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  run: "secondary",
  propose: "outline",
  confirm: "success",
  reject: "destructive",
};

function AuditPage() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
  const [agentFilter, setAgentFilter] = useState("all");
  const fn = useServerFn(listAudit);
  const q = useQuery({
    queryKey: ["ai-cc", "audit", agentFilter],
    queryFn: () => fn({ data: { agent_key: agentFilter } }) as Promise<AuditItem[]>,
    enabled: !isExampleCaptureMode,
  });
  const rows: AuditItem[] = isExampleCaptureMode
    ? [
        {
          id: "au-1",
          actor_email: "admin.demo@mml.local",
          agent_key: "support",
          action: "run",
          run_id: "run-901",
          inbox_id: null,
          detail: { title: "Daily support queue sweep", job_hint: "Escalated and overdue tickets" },
          created_at: "2026-09-29T05:31:00Z",
        },
        {
          id: "au-2",
          actor_email: "opslead.demo@mml.local",
          agent_key: "support",
          action: "propose",
          run_id: "run-901",
          inbox_id: "inb-55",
          detail: {
            title: "Ticket #5142 response draft",
            write_result: { performed: false, stubbed: true },
          },
          created_at: "2026-09-29T05:31:14Z",
        },
        {
          id: "au-3",
          actor_email: "admin.demo@mml.local",
          agent_key: "support",
          action: "confirm",
          run_id: "run-901",
          inbox_id: "inb-55",
          detail: { title: "Approved ticket update", write_result: { performed: true } },
          created_at: "2026-09-29T05:33:40Z",
        },
        {
          id: "au-4",
          actor_email: "admin.demo@mml.local",
          agent_key: "generalist",
          action: "propose",
          run_id: "run-902",
          inbox_id: "inb-58",
          detail: { title: "Lab solution guide for Cognizant BPMN cohort" },
          created_at: "2026-09-29T05:35:05Z",
        },
      ]
    : (q.data ?? []);

  const agentName = (k: string | null) => AGENTS.find((a) => a.key === k)?.name ?? k ?? "—";

  return (
    <AppShell {...pageShell("/ai-command-center/audit")}>
      {/* #23: filters in a FilterBar above the card. */}
      <FilterBar>
        <FilterSelect
          label="Agent"
          value={agentFilter}
          onValueChange={setAgentFilter}
          allLabel="All agents"
          width="md"
          options={AGENTS.map((a) => ({ value: a.key, label: a.name }))}
        />
        <FilterActions>
          <Button variant="ghost" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-1 size-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </FilterActions>
      </FilterBar>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">Agent activity trail</CardTitle>
          <CardDescription>
            Every run, proposal and human decision, including the confirm or reject trail for write
            proposals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Run / item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                <TableStateRow colSpan={6}>Loading the audit trail…</TableStateRow>
              ) : q.isError ? (
                <TableStateRow colSpan={6} onRetry={() => q.refetch()}>
                  Could not load the audit trail.{" "}
                  {q.error instanceof Error ? q.error.message : "Unknown error"}
                </TableStateRow>
              ) : (
                rows.length === 0 && (
                  <TableStateRow colSpan={6}>
                    Nothing logged yet. Use “Run now” to start an agent.
                  </TableStateRow>
                )
              )}
              {rows.map((a) => {
                const d = a.detail as Record<string, any>;
                const write = d["write_result"] as
                  | { performed?: boolean; stubbed?: boolean }
                  | undefined;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {format(new Date(a.created_at), "dd MMM yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.actor_email ?? "system"}
                    </TableCell>
                    <TableCell className="text-xs">{agentName(a.agent_key)}</TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[a.action] ?? "outline"}>{a.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md text-xs">
                      <div>{String(d["title"] ?? d["job_hint"] ?? d["item_type"] ?? "—")}</div>
                      {d["note"] ? (
                        <div className="text-muted-foreground">Note: {String(d["note"])}</div>
                      ) : null}
                      {write ? (
                        <div className="text-muted-foreground">
                          Write:{" "}
                          {write.performed
                            ? "applied to helpdesk"
                            : write.stubbed
                              ? "stubbed (not applied)"
                              : "none"}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <div>{a.run_id ? a.run_id.slice(0, 8) : "—"}</div>
                      <div>{a.inbox_id ? a.inbox_id.slice(0, 8) : ""}</div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
