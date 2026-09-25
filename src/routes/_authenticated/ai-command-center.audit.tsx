import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { listAudit, AGENTS, type AuditItem } from "@/lib/ai-command-center.functions";

export const Route = createFileRoute("/_authenticated/ai-command-center/audit")({
  component: AuditPage,
});

const ACTION_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  run: "secondary",
  propose: "outline",
  confirm: "default",
  reject: "destructive",
};

function AuditPage() {
  const [agentFilter, setAgentFilter] = useState("all");
  const fn = useServerFn(listAudit);
  const q = useQuery({
    queryKey: ["ai-cc", "audit", agentFilter],
    queryFn: () => fn({ data: { agent_key: agentFilter } }) as Promise<AuditItem[]>,
  });

  const agentName = (k: string | null) => AGENTS.find((a) => a.key === k)?.name ?? k ?? "—";

  return (
    <AppShell title="AI Command Center — Audit">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Agent activity trail</CardTitle>
            <CardDescription>
              Every run, proposal and human decision, including the confirm or reject trail for write proposals.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {AGENTS.map((a) => (
                  <SelectItem key={a.key} value={a.key}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {q.isError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Could not load the audit trail</AlertTitle>
              <AlertDescription>{q.error instanceof Error ? q.error.message : "Unknown error"}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead>Run / Item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {q.data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nothing logged yet. Use “Run now” to start an agent.
                  </TableCell>
                </TableRow>
              )}
              {(q.data ?? []).map((a) => {
                const d = a.detail as Record<string, any>;
                const write = d['write_result'] as { performed?: boolean; stubbed?: boolean } | undefined;
                return (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap">{format(new Date(a.created_at), "dd MMM yyyy HH:mm")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.actor_email ?? "system"}</TableCell>
                    <TableCell className="text-xs">{agentName(a.agent_key)}</TableCell>
                    <TableCell>
                      <Badge variant={ACTION_VARIANT[a.action] ?? "outline"}>{a.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-md">
                      <div>{String(d['title'] ?? d['job_hint'] ?? d['item_type'] ?? "—")}</div>
                      {d['note'] ? <div className="text-muted-foreground">Note: {String(d['note'])}</div> : null}
                      {write ? (
                        <div className="text-muted-foreground">
                          Write: {write.performed ? "applied to helpdesk" : write.stubbed ? "stubbed (not applied)" : "none"}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
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
