// SCRUM-131: sign-off detail (new screen). Shows the Healer report for one staged import, fixed values
// (original vs stored) and flagged rows (warnings), and lets an approver approve or reject it. APPROVERS ONLY
// (membership, any role). An approver who uploaded the file cannot decide it but may cancel it (owner-only
// cancelMyImportStage). Every rule is enforced again on the server and in the database (approve_import /
// reject_import / cancel_import); the buttons only reflect what the server says.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, Info } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtCurrency, fmtDateTime } from "@/lib/format";
import { approveImport, getImportStage, rejectImport } from "@/lib/import-approvals.functions";
import { cancelMyImportStage } from "@/lib/my-imports.functions";
import { expiresIn } from "@/lib/strict-import/approval";
import { stageDateOrderLine } from "@/lib/strict-import/date-order-view";
import {
  STATUS_LABELS,
  correctionsSummary,
  fieldHeader,
  incompleteLine,
  originalText,
  repeatLine,
  ruleLabel,
  splitLine,
  statusVariant,
} from "@/lib/strict-import/approval-view";
import { subPageHead, subPageShell } from "@/lib/nav";
import { ErrorState, LoadingState } from "@/components/page-states";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { IncompleteBadge } from "@/components/status-badges";
import { kpiPeriodFor } from "@/lib/kpi-period";

export const Route = createFileRoute("/_authenticated/import-approvals/$stageId")({
  // SCRUM-128 C15 (X4, N9): "Import sign-off · Import approvals · MakeMyLabs".
  head: () => subPageHead("Import sign-off", "/import-approvals"),
  component: ImportStagePage,
});

const PAGE = 100;
/** SCRUM-128 C15: title "Import sign-off" with the breadcrumb "Import approvals /" (a link back). */
const SHELL = subPageShell("Import sign-off", "/import-approvals");
/** The stage tiles count the one uploaded file: period line "This file" (rule import.stage). */
const STAGE_PERIOD = kpiPeriodFor("import.stage");

function ImportStagePage() {
  const { stageId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getFn = useServerFn(getImportStage);
  const approveFn = useServerFn(approveImport);
  const rejectFn = useServerFn(rejectImport);
  const cancelFn = useServerFn(cancelMyImportStage);
  const q = useQuery({
    queryKey: ["import-approvals", "stage", stageId],
    queryFn: () => getFn({ data: { id: stageId } }),
  });
  const [dialog, setDialog] = useState<"approve" | "reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  // Eng QC S4: a repeat file is restated in the approve dialog and needs a tick (6 Oct double upload).
  const [repeatAck, setRepeatAck] = useState(false);
  const [fixedShown, setFixedShown] = useState(PAGE);
  const [flaggedShown, setFlaggedShown] = useState(PAGE);

  const openDialog = (d: "approve" | "reject" | "cancel" | null) => {
    setRepeatAck(false); // the repeat tick is asked again every time the approve dialog opens
    setDialog(d);
  };
  const done = async (message: string) => {
    toast.success(message);
    setDialog(null);
    setReason("");
    await qc.invalidateQueries({ queryKey: ["import-approvals"] });
  };
  const failed = (message: string) => {
    toast.error(message);
    setDialog(null);
  };

  const approve = useMutation({
    mutationFn: async () => {
      if (!q.data?.ok) throw new Error("Not loaded");
      const { stage } = q.data;
      return approveFn({
        data: {
          stageId: stage.id,
          fileSha256: stage.file_sha256,
          rowsSha256: stage.rows_sha256,
          reason: reason.trim() || null,
        },
      });
    },
    onSuccess: (r) =>
      r.ok ? done(`Approved: ${r.result.inserted} rows imported.`) : failed(r.message),
    onError: (e) =>
      failed(e instanceof Error ? e.message : "Approval failed; nothing was imported."),
  });
  const reject = useMutation({
    mutationFn: () => rejectFn({ data: { stageId, reason: reason.trim() || null } }),
    onSuccess: (r) => (r.ok ? done("Rejected. The uploader has been told.") : failed(r.message)),
    onError: (e) => failed(e instanceof Error ? e.message : "Reject failed."),
  });
  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { stageId } }),
    onSuccess: async (r) => {
      if (!r.ok) return failed(r.message);
      await done("Upload cancelled.");
      await navigate({ to: "/import-approvals" });
    },
    onError: (e) => failed(e instanceof Error ? e.message : "Cancel failed."),
  });
  const busy = approve.isPending || reject.isPending || cancel.isPending;

  const data = q.data?.ok ? q.data : null;
  const flagged = useMemo(
    () => (data ? data.rows.filter((r) => r.warnings.length > 0) : []),
    [data],
  );
  const summary = useMemo(() => (data ? correctionsSummary(data.corrections) : []), [data]);

  if (q.isLoading) {
    return (
      <AppShell {...SHELL}>
        <LoadingState thing="import" />
      </AppShell>
    );
  }
  if (q.isError || !data) {
    return (
      <AppShell {...SHELL}>
        <ErrorState
          thing="this import"
          error={
            q.error instanceof Error ? q.error : q.data && !q.data.ok ? q.data.message : undefined
          }
          onRetry={q.isError ? () => q.refetch() : undefined}
        />
        <BackLink />
      </AppShell>
    );
  }

  const { stage, corrections, isUploader, canDecide, uploaderName } = data;
  const now = Date.now();
  const incomplete = incompleteLine(stage);
  // Who acknowledged the repeat, when, and which earlier batch/upload it repeats (QC S4: restated in the dialog).
  const repeat = repeatLine(stage, uploaderName ? { [stage.uploaded_by]: uploaderName } : {});
  // SCRUM-131 date fix F1: the uploader picked the date format (nothing in the file proved it). Null otherwise.
  const dateOrderLine = stageDateOrderLine(stage.summary);

  return (
    <AppShell {...SHELL}>
      <BackLink />
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm" title={stage.filename}>
              {stage.filename}
            </CardTitle>
            <CardDescription>
              {splitLine(stage)} · uploaded {fmtDateTime(stage.uploaded_at)}
              {stage.status === "pending" ? ` · ${expiresIn(stage.expires_at, now)}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(stage.status)}>{STATUS_LABELS[stage.status]}</Badge>
            {canDecide && (
              <>
                <Button size="sm" onClick={() => openDialog("approve")} disabled={busy}>
                  Approve and import {stage.row_count} rows
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => openDialog("reject")}
                  disabled={busy}
                >
                  Reject
                </Button>
              </>
            )}
            {isUploader && stage.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDialog("cancel")}
                disabled={busy}
              >
                Cancel upload
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <KpiGrid inset className="xl:grid-cols-4">
            <SummaryKpi
              variant="inset"
              period={STAGE_PERIOD}
              label="Rows"
              value={String(stage.row_count)}
              subline={`${stage.private_count} Private cloud · ${stage.public_count} Public cloud`}
            />
            <SummaryKpi
              variant="inset"
              period={STAGE_PERIOD}
              label="Selling cost"
              value={fmtCurrency(stage.total_selling)}
              subline={`Input cost ${fmtCurrency(stage.total_input)}`}
            />
            <SummaryKpi
              variant="inset"
              period={STAGE_PERIOD}
              label="Incomplete rows"
              value={String(stage.incomplete_count)}
              subline={`Selling ${fmtCurrency(stage.incomplete_selling)} · input ${fmtCurrency(stage.incomplete_input)}`}
            />
            <SummaryKpi
              variant="inset"
              period={STAGE_PERIOD}
              label="Healer fixes"
              value={String(stage.correction_count)}
              subline={`${stage.warning_row_count} rows with warnings · 0 blockers`}
            />
          </KpiGrid>
          {incomplete && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>{incomplete}</AlertDescription>
            </Alert>
          )}
          {repeat && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Repeat file</AlertTitle>
              <AlertDescription>{repeat}</AlertDescription>
            </Alert>
          )}
          {isUploader && stage.status === "pending" && (
            <p className="text-xs text-muted-foreground">
              You uploaded this file, so another approver must sign it off.
            </p>
          )}
          {stage.decided_at && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>
                {STATUS_LABELS[stage.status]} on {fmtDateTime(stage.decided_at)}
              </AlertTitle>
              {stage.decision_reason && (
                <AlertDescription>Note: {stage.decision_reason}</AlertDescription>
              )}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Healer report</CardTitle>
          <CardDescription>
            Fixed values were changed automatically before validation; the original is kept. Flagged
            rows carry warnings. Files with blockers are never sent for sign-off. Healer{" "}
            {stage.healer_version}, template {stage.template_version}.
          </CardDescription>
          {summary.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {summary.map((s) => (
                <Badge key={s.rule} variant="secondary">
                  {s.label}: {s.count}
                </Badge>
              ))}
            </div>
          )}
          {dateOrderLine && (
            <p className="flex items-center gap-1.5 pt-1 text-sm" data-testid="date-order-line">
              <Info className="h-4 w-4 shrink-0" />
              {dateOrderLine}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="fixed">
            <TabsList>
              <TabsTrigger value="fixed">Fixed ({corrections.length})</TabsTrigger>
              <TabsTrigger value="flagged">Flagged ({flagged.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="fixed" className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Line</TableHead>
                    <TableHead>Column</TableHead>
                    <TableHead>Fix</TableHead>
                    <TableHead>In the file</TableHead>
                    <TableHead>Stored</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {corrections.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        {stage.status === "pending" || stage.status === "committed"
                          ? "Nothing needed fixing."
                          : "Details are cleared once an import is rejected or expires."}
                      </TableCell>
                    </TableRow>
                  )}
                  {corrections.slice(0, fixedShown).map((c, i) => (
                    <TableRow key={`${c.source_line}-${c.field}-${i}`}>
                      <TableCell className="tabular-nums">{c.source_line}</TableCell>
                      <TableCell className="whitespace-nowrap">{fieldHeader(c.field)}</TableCell>
                      <TableCell className="whitespace-nowrap">{ruleLabel(c.rule)}</TableCell>
                      <TableCell
                        className="max-w-64 truncate text-muted-foreground"
                        title={originalText(c.original_value)}
                      >
                        {originalText(c.original_value)}
                      </TableCell>
                      <TableCell className="max-w-64 truncate font-medium" title={c.healed_value}>
                        {c.healed_value}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {corrections.length > fixedShown && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setFixedShown((n) => n + PAGE)}
                >
                  Show more ({corrections.length - fixedShown} left)
                </Button>
              )}
            </TabsContent>
            <TabsContent value="flagged" className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Line</TableHead>
                    <TableHead>Potential ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Warnings</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flagged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No warnings.
                      </TableCell>
                    </TableRow>
                  )}
                  {flagged.slice(0, flaggedShown).map((r) => (
                    <TableRow key={r.source_line}>
                      <TableCell className="tabular-nums">{r.source_line}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {String(r.healed.potential_id ?? "")}
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        {String(r.healed.customer_name ?? "")}
                      </TableCell>
                      <TableCell className="text-xs">
                        <ul className="list-disc space-y-0.5 pl-4">
                          {r.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell>{r.is_incomplete && <IncompleteBadge />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {flagged.length > flaggedShown && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setFlaggedShown((n) => n + PAGE)}
                >
                  Show more ({flagged.length - flaggedShown} left)
                </Button>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => !open && !busy && openDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "approve"
                ? `Approve and import ${stage.row_count} rows?`
                : dialog === "reject"
                  ? "Reject this import?"
                  : "Cancel this upload?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "approve"
                ? `All or nothing: ${stage.private_count} Private cloud and ${stage.public_count} Public cloud rows will be saved, with the Healer fixes shown.`
                : dialog === "reject"
                  ? "Nothing is saved. The uploader is told and can fix the file and upload it again."
                  : "Nothing is saved and the upload is removed from the queue."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === "approve" && dateOrderLine && (
            <p className="text-sm" data-testid="date-order-dialog">
              {dateOrderLine}. Check a few dates in the Healer report before approving.
            </p>
          )}
          {dialog === "approve" && repeat && (
            <label className="flex items-start gap-2 text-sm" data-testid="repeat-ack">
              <input
                type="checkbox"
                className="mt-1"
                checked={repeatAck}
                onChange={(e) => setRepeatAck(e.target.checked)}
              />
              <span>{repeat} I have checked this is not a double upload.</span>
            </label>
          )}
          {dialog !== "cancel" && (
            <div className="space-y-1.5">
              <Label htmlFor="decision-note">
                {dialog === "reject" ? "Reason (shown to the uploader)" : "Note (optional)"}
              </Label>
              <Textarea
                id="decision-note"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction
              className={
                dialog === "reject" ? buttonVariants({ variant: "destructive" }) : undefined
              }
              disabled={busy || (dialog === "approve" && !!repeat && !repeatAck)}
              onClick={(e) => {
                e.preventDefault();
                if (dialog === "approve") approve.mutate();
                else if (dialog === "reject") reject.mutate();
                else cancel.mutate();
              }}
            >
              {busy
                ? "Working…"
                : dialog === "approve"
                  ? "Approve and import"
                  : dialog === "reject"
                    ? "Reject"
                    : "Cancel upload"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function BackLink() {
  return (
    <Button variant="ghost" size="sm" asChild className="w-fit">
      <Link to="/import-approvals">
        <ArrowLeft className="mr-1 h-4 w-4" />
        Import approvals
      </Link>
    </Button>
  );
}
