import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableStateRow } from "@/components/data-table-parts";
import { ErrorState, LoadingState } from "@/components/page-states";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Copy, PlugZap, ShieldOff, ShieldCheck, ExternalLink, RefreshCw } from "lucide-react";
import {
  listMyMcpClients,
  listMyMcpAudit,
  revokeMcpClient,
  unrevokeMcpClient,
  type McpClientStatus,
  type McpAuditRow,
} from "@/lib/mcp-audit.functions";

export const Route = createFileRoute("/_authenticated/agent-integrations")({
  head: () => pageHead("/agent-integrations"),
  component: AgentIntegrationsPage,
});

function AgentIntegrationsPage() {
  const qc = useQueryClient();
  const listClients = useServerFn(listMyMcpClients);
  const listAudit = useServerFn(listMyMcpAudit);
  const revokeFn = useServerFn(revokeMcpClient);
  const unrevokeFn = useServerFn(unrevokeMcpClient);

  const clientsQ = useQuery({
    queryKey: ["mcp", "my-clients"],
    queryFn: () => listClients(),
  });
  const auditQ = useQuery({
    queryKey: ["mcp", "my-audit"],
    queryFn: () => listAudit({ data: { limit: 25 } }),
  });

  const revoke = useMutation({
    mutationFn: (client_id: string) => revokeFn({ data: { client_id } }),
    onSuccess: () => {
      toast.success("AI client disconnected. New calls from it will be rejected.");
      qc.invalidateQueries({ queryKey: ["mcp"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to disconnect"),
  });
  const unrevoke = useMutation({
    mutationFn: (client_id: string) => unrevokeFn({ data: { client_id } }),
    onSuccess: () => {
      toast.success("Reconnection allowed. The AI client can call tools again.");
      qc.invalidateQueries({ queryKey: ["mcp"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to reconnect"),
  });

  const mcpUrl = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "/mcp";

  return (
    <AppShell {...pageShell("/agent-integrations")}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <PlugZap className="size-4 shrink-0" /> Connect an AI assistant
          </CardTitle>
          <CardDescription>
            Point ChatGPT, Claude, Cursor, or another MCP-compatible client at this URL. You'll sign
            in with your MakeMyLabs account and grant it access as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {mcpUrl}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(mcpUrl);
                toast.success("MCP URL copied");
              }}
            >
              <Copy className="mr-1 size-4" /> Copy
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={mcpUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 size-4" /> Open
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Access is limited by your role. Available tools: <code>whoami</code>,{" "}
            <code>list_customers</code>, <code>list_transactions</code>,{" "}
            <code>reports_summary</code>.
          </p>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="text-sm">Connected clients</CardTitle>
            <CardDescription>
              Each row is an OAuth client that has called your MCP tools.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 self-start"
            onClick={() => qc.invalidateQueries({ queryKey: ["mcp"] })}
          >
            <RefreshCw className="mr-1 size-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {clientsQ.isLoading ? (
            <LoadingState thing="clients" inCard />
          ) : clientsQ.error ? (
            <ErrorState thing="clients" error={clientsQ.error} onRetry={() => clientsQ.refetch()} />
          ) : (clientsQ.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No AI clients have connected yet. Copy the URL above into ChatGPT/Claude/Cursor to get
              started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(clientsQ.data as McpClientStatus[]).map((c) => (
                <div key={c.client_id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-sm" title={c.client_id}>
                        {c.client_id}
                      </span>
                      {/* §4.8: Connected success, Disconnected secondary. */}
                      {c.revoked ? (
                        <Badge variant="secondary" className="shrink-0">
                          Disconnected
                        </Badge>
                      ) : (
                        <Badge variant="success" className="shrink-0">
                          Connected
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Last activity{" "}
                      {formatDistanceToNow(new Date(c.last_seen), { addSuffix: true })} ·{" "}
                      <span className="tabular-nums">
                        {c.success_calls}/{c.total_calls}
                      </span>{" "}
                      successful
                    </div>
                  </div>
                  {c.revoked ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unrevoke.isPending}
                      onClick={() => unrevoke.mutate(c.client_id)}
                    >
                      <ShieldCheck className="mr-1 size-4" /> Reconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(c.client_id)}
                    >
                      <ShieldOff className="mr-1 size-4" /> Disconnect
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">My recent MCP activity</CardTitle>
          <CardDescription>Last 25 tool calls made through connected AI clients.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* #30: shadcn Table instead of a raw <table>. */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQ.isLoading ? (
                <TableStateRow colSpan={5}>Loading activity…</TableStateRow>
              ) : auditQ.error ? (
                <TableStateRow colSpan={5} onRetry={() => auditQ.refetch()}>
                  Could not load activity.
                </TableStateRow>
              ) : (auditQ.data ?? []).length === 0 ? (
                <TableStateRow colSpan={5}>No MCP calls yet.</TableStateRow>
              ) : (
                (auditQ.data as McpAuditRow[]).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="font-mono">{r.tool_name}</TableCell>
                    <TableCell>
                      {r.success ? (
                        <Badge variant="success">OK</Badge>
                      ) : (
                        <Badge variant="destructive">{r.error_code ?? "error"}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-56 truncate font-mono text-xs">
                      {r.client_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.duration_ms ?? 0} ms
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
