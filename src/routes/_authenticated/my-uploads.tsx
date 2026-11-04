// SCRUM-131 (John, Option 2): My uploads. A separate page OUTSIDE the approver gate: the signed-in
// user's OWN import stages only, and Cancel on their own PENDING stage (the server enforces both).
// Gate: approvers or uploaders (lib/import-approver-gate.ts canSeeMyUploads; route guard in
// routes/_authenticated/route.tsx), from getImportApprovalStatus(). Server calls via lib/my-uploads.ts
// (Chris's listImportStages scope "mine", read-only, and cancelImport). No poll: it loads on open, on
// Refresh, and after a cancel (also after an "expired" / "not_pending" refusal: the row was out of
// date). Expired uploads show why and what to do. States follow plan §4.5 / §4.10 (the shared
// TableStateRow / LoadingState / ErrorState components arrive with the standardization build).
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { fmtDateTime } from "@/lib/format";
import { pageHead } from "@/lib/nav";
import { cancelImport, listImportStages } from "@/lib/import-approvals.functions";
import { expiresIn } from "@/lib/strict-import/approval";
import { IMPORT_APPROVAL_STATUS_QUERY_KEY } from "@/lib/import-approval-status";
import {
  MY_UPLOADS_QUERY_OPTIONS,
  cancelOutcomeView,
  myUploadRow,
  myUploadsServer,
  type MyUploadRow,
} from "@/lib/my-uploads";

export const Route = createFileRoute("/_authenticated/my-uploads")({
  head: () => pageHead("/my-uploads"),
  component: MyUploadsPage,
});

const COLUMNS = 9;

function StateRow({ children }: { children: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={COLUMNS} className="py-8 text-center text-sm text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function MyUploadsPage() {
  const list = useServerFn(listImportStages);
  const cancel = useServerFn(cancelImport);
  const server = useMemo(
    () => myUploadsServer({ listImportStages: list, cancelImport: cancel }),
    [list, cancel],
  );
  const qc = useQueryClient();
  const q = useQuery({ ...MY_UPLOADS_QUERY_OPTIONS, queryFn: () => server.listOwnStages() });
  const [confirm, setConfirm] = useState<MyUploadRow | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const now = Date.now();
  const rows = (q.data?.stages ?? []).map((s) => myUploadRow(s, q.data?.userId ?? "", now));

  async function onCancel(row: MyUploadRow) {
    setCancelling(row.id);
    try {
      const view = cancelOutcomeView(await server.cancelOwnPending(row.id), row.filename);
      if (view.ok) toast.success(view.message);
      else toast.error(view.message);
      if (view.refresh) {
        await qc.invalidateQueries({ queryKey: MY_UPLOADS_QUERY_OPTIONS.queryKey });
        await qc.invalidateQueries({ queryKey: IMPORT_APPROVAL_STATUS_QUERY_KEY });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel the upload.");
    } finally {
      setCancelling(null);
      setConfirm(null);
    }
  }

  return (
    <AppShell title="My uploads">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">Files you sent for sign-off</CardTitle>
            <CardDescription>
              Nothing is saved until an approver signs a file off. You can cancel a file while it is
              waiting. Waiting files expire after 7 days.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
            data-testid="my-uploads-refresh"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="whitespace-nowrap">Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right whitespace-nowrap">Private / Public</TableHead>
                <TableHead className="text-right">Incomplete</TableHead>
                <TableHead className="whitespace-nowrap">Healer fixes</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && <StateRow>Loading uploads…</StateRow>}
              {q.isError && (
                <StateRow>
                  <div className="space-y-2">
                    <div>
                      Could not load uploads:{" "}
                      {q.error instanceof Error ? q.error.message : "unknown error"}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                      Retry
                    </Button>
                  </div>
                </StateRow>
              )}
              {q.isSuccess && rows.length === 0 && <StateRow>No uploads yet.</StateRow>}
              {rows.map((r) => (
                <TableRow key={r.id} data-testid="my-upload-row">
                  <TableCell className="max-w-[16rem]">
                    <div className="truncate font-medium" title={r.filename}>
                      {r.filename}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateTime(r.submittedAt)}</TableCell>
                  <TableCell>
                    <Badge variant={r.statusVariant}>{r.statusLabel}</Badge>
                    {r.expiresAt && (
                      <div
                        className="mt-1 whitespace-nowrap text-xs text-muted-foreground"
                        title={`Expires ${fmtDateTime(r.expiresAt)}`}
                      >
                        {expiresIn(r.expiresAt, now)}
                      </div>
                    )}
                    {r.statusNote && (
                      <div
                        className="mt-1 max-w-[16rem] text-xs text-muted-foreground"
                        data-testid="my-upload-status-note"
                      >
                        {r.statusNote}
                      </div>
                    )}
                    {r.decidedAt && (
                      <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                        Decided {fmtDateTime(r.decidedAt)}
                      </div>
                    )}
                    {r.decisionReason && (
                      <div className="mt-1 max-w-[16rem] truncate text-xs" title={r.decisionReason}>
                        {r.decisionReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.rows}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {r.privateRows} / {r.publicRows}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.incompleteRows}</TableCell>
                  <TableCell className="text-xs" title={r.healerSummary}>
                    <span className="whitespace-nowrap">{r.healerSummary}</span>
                    {r.dateOrderNote && (
                      <div className="text-muted-foreground" data-testid="date-order-note">
                        {r.dateOrderNote}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {r.batchId ? (
                      <span title={r.batchId}>Batch {r.batchId.slice(0, 8)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.canCancel && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={cancelling !== null}
                        onClick={() => setConfirm(r)}
                        data-testid="my-upload-cancel"
                      >
                        {cancelling === r.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this upload?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.filename} will no longer wait for sign-off. Nothing was saved from it, so
              nothing is removed. To import it later, upload the file again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling !== null}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirm) void onCancel(confirm);
              }}
            >
              {cancelling ? "Cancelling…" : "Cancel upload"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
