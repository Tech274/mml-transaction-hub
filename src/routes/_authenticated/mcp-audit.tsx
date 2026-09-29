import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth-context";
import { requireRouteRoles } from "@/lib/route-guard";
import { listAllMcpAudit, type McpAuditRow } from "@/lib/mcp-audit.functions";
import { format } from "date-fns";
import {
  getSuperadminCaptureModeEnvForClient,
  isSuperadminCaptureModeEnabled,
} from "@/lib/superadmin-capture-mode";

export const Route = createFileRoute("/_authenticated/mcp-audit")({
  beforeLoad: requireRouteRoles("/mcp-audit"),
  component: McpAuditPage,
});

function McpAuditPage() {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["admin"]);

  return (
    <AppShell title="MCP audit log">
      {!isAdmin ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Admin role required.
        </CardContent></Card>
      ) : (
        <AuditView />
      )}
    </AppShell>
  );
}

function AuditView() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(getSuperadminCaptureModeEnvForClient());
  const listFn = useServerFn(listAllMcpAudit);
  const [tool, setTool] = useState<string>("all");
  const [outcome, setOutcome] = useState<string>("all");
  const [clientId, setClientId] = useState("");
  const [selected, setSelected] = useState<McpAuditRow | null>(null);

  const q = useQuery({
    queryKey: ["mcp", "all-audit", tool, outcome, clientId],
    queryFn: () =>
      listFn({
        data: {
          limit: 500,
          tool_name: tool === "all" ? undefined : tool,
          success: outcome === "all" ? undefined : outcome === "success",
          client_id: clientId.trim() || undefined,
        },
      }),
    enabled: !isExampleCaptureMode,
  });
  const rows: McpAuditRow[] = isExampleCaptureMode
    ? [
        { id: "1", user_id: "u1", user_email: "admin.demo@mml.local", client_id: "mcp-client-01", tool_name: "list_transactions", arguments: { month: 9, year: 2026 }, success: true, error_code: null, error_message: null, duration_ms: 182, created_at: "2026-09-29T05:35:00Z" },
        { id: "2", user_id: "u1", user_email: "admin.demo@mml.local", client_id: "mcp-client-02", tool_name: "reports_summary", arguments: { range: "current_month" }, success: true, error_code: null, error_message: null, duration_ms: 141, created_at: "2026-09-29T05:33:00Z" },
        { id: "3", user_id: "u2", user_email: "opslead.demo@mml.local", client_id: "mcp-client-03", tool_name: "list_customers", arguments: { status: "active" }, success: false, error_code: "rate_limited", error_message: "Too many requests", duration_ms: 220, created_at: "2026-09-29T05:32:00Z" },
      ]
    : (q.data ?? []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Tool</Label>
            <Select value={tool} onValueChange={setTool}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tools</SelectItem>
                <SelectItem value="whoami">whoami</SelectItem>
                <SelectItem value="list_customers">list_customers</SelectItem>
                <SelectItem value="list_transactions">list_transactions</SelectItem>
                <SelectItem value="reports_summary">reports_summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Client ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth client id" />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={() => q.refetch()}>Refresh</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent invocations</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
          ) : q.error ? (
            <div className="text-sm text-destructive py-6 text-center">
              {(q.error as Error).message}
              <div className="mt-2"><Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button></div>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">No matching activity.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">User</th>
                    <th className="py-2 pr-3">Tool</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Client</th>
                    <th className="py-2 pr-3">Duration</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b">
                      <td className="py-2 pr-3 whitespace-nowrap">{format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}</td>
                      <td className="py-2 pr-3">{r.user_email ?? r.user_id}</td>
                      <td className="py-2 pr-3 font-mono">{r.tool_name}</td>
                      <td className="py-2 pr-3">
                        {r.success ? <Badge variant="secondary">OK</Badge> : <Badge variant="destructive">{r.error_code ?? "error"}</Badge>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs truncate max-w-[220px]">{r.client_id ?? "—"}</td>
                      <td className="py-2 pr-3">{r.duration_ms ?? 0} ms</td>
                      <td className="py-2"><Button variant="ghost" size="sm" onClick={() => setSelected(r)}>View</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Invocation detail</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <Row k="Tool" v={selected.tool_name} />
              <Row k="User" v={selected.user_email ?? selected.user_id} />
              <Row k="Client ID" v={selected.client_id ?? "—"} />
              <Row k="When" v={format(new Date(selected.created_at), "yyyy-MM-dd HH:mm:ss")} />
              <Row k="Duration" v={`${selected.duration_ms ?? 0} ms`} />
              <Row k="Result" v={selected.success ? "success" : `error (${selected.error_code ?? "unknown"})`} />
              {selected.error_message && <Row k="Error message" v={selected.error_message} />}
              <div>
                <div className="text-xs text-muted-foreground mb-1">Arguments</div>
                <pre className="bg-muted rounded p-2 text-xs overflow-x-auto">{JSON.stringify(selected.arguments, null, 2)}</pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-32 text-xs text-muted-foreground">{k}</div>
      <div className="flex-1 font-mono text-xs break-all">{v}</div>
    </div>
  );
}
