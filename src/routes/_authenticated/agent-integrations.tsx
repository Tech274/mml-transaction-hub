import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    <AppShell title="Agent integrations">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5" /> Connect an AI assistant</CardTitle>
            <CardDescription>
              Point ChatGPT, Claude, Cursor, or another MCP-compatible client at this URL. You'll sign in with your MakeMyLabs account and grant it access as you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">{mcpUrl}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(mcpUrl);
                  toast.success("MCP URL copied");
                }}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={mcpUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" /> Open</a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Access is limited by your role. Available tools: <code>whoami</code>, <code>list_customers</code>, <code>list_transactions</code>, <code>reports_summary</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Connected clients</CardTitle>
              <CardDescription>Each row is an OAuth client that has called your MCP tools.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["mcp"] })}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {clientsQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
            ) : clientsQ.error ? (
              <div className="text-sm text-destructive py-6 text-center">
                Failed to load: {String((clientsQ.error as Error).message)}
                <div className="mt-2"><Button size="sm" variant="outline" onClick={() => clientsQ.refetch()}>Retry</Button></div>
              </div>
            ) : (clientsQ.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No AI clients have connected yet. Copy the URL above into ChatGPT/Claude/Cursor to get started.
              </div>
            ) : (
              <div className="divide-y">
                {(clientsQ.data as McpClientStatus[]).map((c) => (
                  <div key={c.client_id} className="py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm truncate">{c.client_id}</span>
                        {c.revoked ? (
                          <Badge variant="destructive">Disconnected</Badge>
                        ) : (
                          <Badge variant="secondary">Connected</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Last activity {formatDistanceToNow(new Date(c.last_seen), { addSuffix: true })} ·{" "}
                        {c.success_calls}/{c.total_calls} successful
                      </div>
                    </div>
                    {c.revoked ? (
                      <Button size="sm" variant="outline" disabled={unrevoke.isPending} onClick={() => unrevoke.mutate(c.client_id)}>
                        <ShieldCheck className="h-4 w-4 mr-1" /> Reconnect
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(c.client_id)}>
                        <ShieldOff className="h-4 w-4 mr-1" /> Disconnect
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My recent MCP activity</CardTitle>
            <CardDescription>Last 25 tool calls made through connected AI clients.</CardDescription>
          </CardHeader>
          <CardContent>
            {auditQ.isLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
            ) : (auditQ.data ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">No MCP calls yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Tool</th>
                      <th className="py-2 pr-3">Result</th>
                      <th className="py-2 pr-3">Client</th>
                      <th className="py-2 pr-3">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(auditQ.data as McpAuditRow[]).map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</td>
                        <td className="py-2 pr-3 font-mono">{r.tool_name}</td>
                        <td className="py-2 pr-3">
                          {r.success ? <Badge variant="secondary">OK</Badge> : <Badge variant="destructive">{r.error_code ?? "error"}</Badge>}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs truncate max-w-[220px]">{r.client_id ?? "—"}</td>
                        <td className="py-2 pr-3">{r.duration_ms ?? 0} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
