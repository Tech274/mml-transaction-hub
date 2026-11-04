// SCRUM-131: Chief's pending-approvals queue (new screen; nobody else owns it). Every bulk import waits
// here until an approver signs it off. APPROVERS ONLY, by membership (is_import_approver), whatever the role
// (John, Option 2, 07:07): the route guard and the server functions both check it. Uploaders follow their
// own uploads on the separate "My uploads" page (listMyImportStages). Existing components and theme tokens only.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime } from "@/lib/format";
import { listImportStages } from "@/lib/import-approvals.functions";
import { expiresIn, type ImportStage } from "@/lib/strict-import/approval";
import { STATUS_LABELS, statusVariant } from "@/lib/strict-import/approval-view";
import { pageHead, pageShell } from "@/lib/nav";
import { ErrorState } from "@/components/page-states";
import { TableStateRow } from "@/components/data-table-parts";

export const Route = createFileRoute("/_authenticated/import-approvals/")({
  // SCRUM-128 C15 (X4, N9): tab title "Import approvals · MakeMyLabs" from PAGE_META.
  head: () => pageHead("/import-approvals"),
  component: ImportApprovalsPage,
});

type Scope = "pending" | "recent";

function ImportApprovalsPage() {
  const [scope, setScope] = useState<Scope>("pending");
  const list = useServerFn(listImportStages);
  const effective: Scope = scope;
  const q = useQuery({
    queryKey: ["import-approvals", effective],
    queryFn: () => list({ data: { scope: effective } }),
  });
  const refused =
    q.data && !q.data.isApprover
      ? "Import approvals are for approvers only. Your own uploads are under My uploads."
      : null;
  const stages: ImportStage[] = q.data?.stages ?? [];
  const names = q.data?.names ?? {};
  const now = Date.now();

  return (
    <AppShell {...pageShell("/import-approvals")}>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-sm">
              {effective === "pending" ? "Waiting for sign-off" : "Recent imports"}
            </CardTitle>
            <CardDescription>
              Every bulk import waits here until an approver signs it off. Nothing is saved before
              approval. Pending imports expire after 7 days.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={effective} onValueChange={(v) => setScope(v as Scope)}>
              <TabsList>
                <TabsTrigger value="pending">Waiting for sign-off</TabsTrigger>
                <TabsTrigger value="recent">Recent</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="outline"
              size="sm"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              aria-label="Refresh"
            >
              <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {refused && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Not available</AlertTitle>
              <AlertDescription>{refused}</AlertDescription>
            </Alert>
          )}
          {q.isError && (
            <div className="mb-4">
              <ErrorState thing="imports" error={q.error} onRetry={() => q.refetch()} />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Uploaded by</TableHead>
                <TableHead className="whitespace-nowrap">Uploaded</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right whitespace-nowrap">Private / Public</TableHead>
                <TableHead className="text-right">Incomplete</TableHead>
                <TableHead className="text-right whitespace-nowrap">Healer fixes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <TableStateRow colSpan={9}>Loading…</TableStateRow>}
              {!q.isLoading && !q.isError && stages.length === 0 && (
                <TableStateRow colSpan={9}>
                  {effective === "pending"
                    ? "No imports are waiting for sign-off."
                    : "No imports yet."}
                </TableStateRow>
              )}
              {stages.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-64 truncate" title={s.filename}>
                    <div className="truncate font-medium">{s.filename}</div>
                    {s.repeat_of && (
                      <Badge variant="outline" className="mt-1">
                        Repeat file
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{names[s.uploaded_by] ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(s.uploaded_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.row_count}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {s.private_count} / {s.public_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.incomplete_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.correction_count}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(s.status)}>{STATUS_LABELS[s.status]}</Badge>
                    {s.status === "pending" && (
                      <div className="mt-1 text-xs text-muted-foreground whitespace-nowrap">
                        {expiresIn(s.expires_at, now)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/import-approvals/$stageId" params={{ stageId: s.id }}>
                        {s.status === "pending" && s.uploaded_by !== q.data?.userId
                          ? "Review"
                          : "Open"}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
