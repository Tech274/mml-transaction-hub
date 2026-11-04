import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { pageHead, pageShell } from "@/lib/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterActions, FilterBar, FilterSelect } from "@/components/filter-bar";
import { TableStateRow } from "@/components/data-table-parts";
import { NoAccessState } from "@/components/page-states";
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
  head: () => pageHead("/mcp-audit"),
  beforeLoad: requireRouteRoles("/mcp-audit"),
  component: McpAuditPage,
});

function McpAuditPage() {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(["admin"]);

  return (
    <AppShell {...pageShell("/mcp-audit")}>
      {!isAdmin ? <NoAccessState>Admin role required.</NoAccessState> : <AuditView />}
    </AppShell>
  );
}

function AuditView() {
  const isExampleCaptureMode = isSuperadminCaptureModeEnabled(
    getSuperadminCaptureModeEnvForClient(),
  );
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
        {
          id: "1",
          user_id: "u1",
          user_email: "admin.demo@mml.local",
          client_id: "mcp-client-01",
          tool_name: "list_transactions",
          arguments: { month: 9, year: 2026 },
          success: true,
          error_code: null,
          error_message: null,
          duration_ms: 182,
          created_at: "2026-09-29T05:35:00Z",
        },
        {
          id: "2",
          user_id: "u1",
          user_email: "admin.demo@mml.local",
          client_id: "mcp-client-02",
          tool_name: "reports_summary",
          arguments: { range: "current_month" },
          success: true,
          error_code: null,
          error_message: null,
          duration_ms: 141,
          created_at: "2026-09-29T05:33:00Z",
        },
        {
          id: "3",
          user_id: "u2",
          user_email: "opslead.demo@mml.local",
          client_id: "mcp-client-03",
          tool_name: "list_customers",
          arguments: { status: "active" },
          success: false,
          error_code: "rate_limited",
          error_message: "Too many requests",
          duration_ms: 220,
          created_at: "2026-09-29T05:32:00Z",
        },
      ]
    : (q.data ?? []);

  return (
    <div className="space-y-4">
      {/* #29: FilterBar above the table, no separate "Filters" card. */}
      <FilterBar>
        <FilterSelect
          label="Tool"
          value={tool}
          onValueChange={setTool}
          allLabel="All tools"
          width="md"
          options={[
            { value: "whoami", label: "whoami" },
            { value: "list_customers", label: "list_customers" },
            { value: "list_transactions", label: "list_transactions" },
            { value: "reports_summary", label: "reports_summary" },
          ]}
        />
        <FilterSelect
          label="Outcome"
          value={outcome}
          onValueChange={setOutcome}
          allLabel="All"
          options={[
            { value: "success", label: "Success" },
            { value: "error", label: "Error" },
          ]}
        />
        <div className="w-full md:w-64">
          <Label className="sr-only" htmlFor="mcp-audit-client">
            Client ID
          </Label>
          <Input
            id="mcp-audit-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="OAuth client id"
          />
        </div>
        <FilterActions>
          <Button variant="ghost" size="sm" onClick={() => q.refetch()}>
            Refresh
          </Button>
        </FilterActions>
      </FilterBar>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">Recent invocations</CardTitle>
        </CardHeader>
        <CardContent>
          {/* #30: shadcn Table instead of a raw <table>. */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>
                  <span className="sr-only">Detail</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                <TableStateRow colSpan={7}>Loading activity…</TableStateRow>
              ) : q.error ? (
                <TableStateRow colSpan={7} onRetry={() => q.refetch()}>
                  {(q.error as Error).message}
                </TableStateRow>
              ) : rows.length === 0 ? (
                <TableStateRow colSpan={7}>No matching activity.</TableStateRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>{r.user_email ?? r.user_id}</TableCell>
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
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
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
              <Row
                k="Result"
                v={selected.success ? "success" : `error (${selected.error_code ?? "unknown"})`}
              />
              {selected.error_message && <Row k="Error message" v={selected.error_message} />}
              <div>
                <div className="text-xs text-muted-foreground mb-1">Arguments</div>
                <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
                  {JSON.stringify(selected.arguments, null, 2)}
                </pre>
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
