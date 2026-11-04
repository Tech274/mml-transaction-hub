// SCRUM-103: Bulk Import tab. One non-blank row becomes one transaction.
// The server re-parses and re-validates the same file on submit. New customers
// are created automatically. A repeated file is a warning only (SCRUM-131).
// SCRUM-129 (D3): no file-level cloud choice. Each row's cloud type comes from its
// provider via the shared rule (@/lib/cloud-provider).
// Eng QC fix 1: everything shown comes from the SERVER check (previewStrictImport /
// submitStrictImport): counts from summary, each row's Cloud type / Stored as / alias
// marker from providerRows, errors from rowErrors, the confirmation from the submit
// result. Nothing authoritative is computed in the browser.
// SCRUM-131: uploaders send the file for sign-off (submitStrictImport). commitStrictImport
// always answers approval_required, so this screen no longer calls it. Nothing is saved
// until an approver signs it off in Import approvals.
// A repeat file (same bytes as an earlier batch or a waiting upload) comes back as repeat_file; when
// the server allows it (canAcknowledge), "Submit anyway (repeat of …)" re-sends it with
// acknowledgeRepeatFile: true. Otherwise the screen says a new file is needed. After submit,
// approvers get a link to the sign-off view and everyone else to My uploads (QC P-S1).
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, Send, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { previewStrictImport, submitStrictImport } from "@/lib/strict-import.functions";
import { bytesToBase64 } from "@/lib/strict-import/hash";
import { MAX_STRICT_FILE_BYTES } from "@/lib/strict-import/parse";
import {
  DATE_ORDER_OPTIONS,
  canPickDateOrder,
  dateOrderLabel,
  dateOrderPrompt,
  previewMatchesChoice,
  staleDateOrderNote,
} from "@/lib/strict-import/date-order-view";
import type { ChosenDateOrder } from "@/lib/strict-import/healer";
import { BULK_UPLOAD_HELP_TEXT, cloudPreviewSummaryLine } from "@/lib/strict-import/cloud-preview";
import {
  groupHealerFixesByRule,
  healerFixWhere,
  serverCloudCounts,
  serverErrorsByLine,
  serverHealerFixCount,
  serverHealerFixLines,
  serverStandardisedLine,
  type HealerFixLine,
  type PreviewForUi,
} from "@/lib/strict-import/server-cloud-view";
import { CLOUD_RULE_HELP_TEXT } from "@/lib/cloud-provider";
import { CloudTypeBadge } from "@/components/cloud/cloud-type-badge";
import { HealerFixBadge } from "@/components/status-badges";
import { KpiGrid, SummaryKpi } from "@/components/summaries/summary-kpi";
import { kpiPeriodFor } from "@/lib/kpi-period";
import {
  SIGN_OFF_IDLE,
  canSendForSignOff,
  canSubmitAnyway,
  repeatFileAction,
  signOffAfter,
  signOffAfterThrow,
  signOffButtonLabel,
  signOffErrorTitle,
  signOffFootnote,
  submittedDetail,
  submittedTitle,
  type SignOffState,
} from "@/lib/strict-import/sign-off";
import { fmtDateTime } from "@/lib/format";
import { postSubmitLink } from "@/lib/my-uploads";
import {
  IMPORT_APPROVAL_STATUS_QUERY_KEY,
  useImportApprovalStatus,
} from "@/lib/import-approval-status";
import type { ProviderRowInfo, RowIssue } from "@/lib/strict-import/validate";
import {
  STRICT_TEMPLATE_BANNER,
  canSubmitForApproval,
  duplicateFileMessage,
  formatCents,
  strictTemplateCsv,
  strictTemplateFilename,
} from "@/lib/strict-import/ui-state";

const MAX_ISSUES_SHOWN = 200;
const MAX_PREVIEW_ROWS = 200;
const MAX_FIXES_PER_RULE = 100;
/** Groups start open when the whole list is short; long lists start collapsed. */
const OPEN_GROUPS_UP_TO = 20;

type Failure = { message: string; reasons: string[] };

function IssueTable({ issues, label }: { issues: RowIssue[]; label: string }) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        {label} ({issues.length}
        {issues.length > MAX_ISSUES_SHOWN ? `, first ${MAX_ISSUES_SHOWN} shown` : ""})
      </div>
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Line</TableHead>
              <TableHead className="w-16">Col</TableHead>
              <TableHead>Header</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Problem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.slice(0, MAX_ISSUES_SHOWN).map((e, i) => (
              <TableRow key={`${e.line}-${e.column}-${i}`}>
                <TableCell className="tabular-nums">{e.line}</TableCell>
                <TableCell>{e.column ?? "—"}</TableCell>
                <TableCell>{e.header ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{e.value || "(blank)"}</TableCell>
                <TableCell>{e.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CloudRowsTable({
  rows,
  rowErrors,
}: {
  rows: readonly ProviderRowInfo[];
  rowErrors: Map<number, string[]>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="cloud-rows">
      <div className="text-sm font-medium">
        Cloud type by row ({rows.length}
        {rows.length > MAX_PREVIEW_ROWS ? `, first ${MAX_PREVIEW_ROWS} shown` : ""})
      </div>
      <div className="max-h-80 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Line</TableHead>
              <TableHead>Provider in file</TableHead>
              <TableHead>Cloud type</TableHead>
              <TableHead>Stored provider</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, MAX_PREVIEW_ROWS).map((r) => (
              <TableRow key={r.line}>
                <TableCell className="tabular-nums">{r.line}</TableCell>
                <TableCell className="font-mono text-xs">{r.providerInFile || "(blank)"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <CloudTypeBadge value={r.cloudType} />
                    {/* G6: "Row error" is the destructive badge, with the server's reasons beside it. */}
                    {r.blocked && (
                      <>
                        <Badge variant="destructive" className="shrink-0">
                          Row error
                        </Badge>
                        {rowErrors.has(r.line) && (
                          <span className="text-xs text-destructive">
                            {(rowErrors.get(r.line) ?? []).join(" ")}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </TableCell>
                {/* Stored provider: the Healer fix marker when an alias was applied (spec 129.3). */}
                <TableCell
                  className={
                    r.aliasApplied ? "whitespace-nowrap bg-accent/50" : "whitespace-nowrap"
                  }
                >
                  {r.aliasApplied && r.storedProvider ? (
                    <HealerFixBadge from={r.providerInFile} to={r.storedProvider} />
                  ) : (
                    (r.storedProvider ?? "—")
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * SCRUM-131: every Healer fix from the server (preview.healerFixes), grouped by rule, each with
 * line, column, header and from → to. The total is summary.healerFixCount.
 */
function HealerFixesList({ lines, total }: { lines: readonly HealerFixLine[]; total: number }) {
  if (lines.length === 0) return null;
  const groups = groupHealerFixesByRule(lines);
  const open = lines.length <= OPEN_GROUPS_UP_TO;
  return (
    <div className="space-y-2" data-testid="healer-fixes">
      <div className="text-sm font-medium">Healer fixes ({total})</div>
      <p className="text-xs text-muted-foreground">
        The Healer corrected these cells. The corrected value is what is sent for sign-off.
      </p>
      <div className="max-h-96 space-y-2 overflow-auto rounded-md border border-border p-2">
        {groups.map((g) => (
          <details key={g.rule} open={open} data-testid={`healer-fix-group-${g.rule}`}>
            <summary className="cursor-pointer text-sm">
              {g.label} <span className="text-muted-foreground">({g.fixes.length})</span>
            </summary>
            <ul className="mt-1 space-y-1 pl-4 text-xs">
              {g.fixes.slice(0, MAX_FIXES_PER_RULE).map((h, i) => (
                <li
                  key={`${h.line}-${h.column ?? h.field}-${i}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className="text-muted-foreground">
                    {healerFixWhere(h)} · {h.field}
                  </span>
                  <HealerFixBadge from={h.from} to={h.to} rule={`${g.label}, rule ${g.rule}`} />
                </li>
              ))}
              {g.fixes.length > MAX_FIXES_PER_RULE && (
                <li className="text-muted-foreground">
                  First {MAX_FIXES_PER_RULE} of {g.fixes.length} shown.
                </li>
              )}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

export function StrictImport() {
  const preview = useServerFn(previewStrictImport);
  const submit = useServerFn(submitStrictImport);
  const qc = useQueryClient();
  // Where the confirmation links: approvers → the sign-off view, everyone else → My uploads.
  const { isApprover } = useImportApprovalStatus(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [result, setResult] = useState<PreviewForUi | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [signOff, setSignOff] = useState<SignOffState>(SIGN_OFF_IDLE);
  // SCRUM-131 date fix: the uploader's date format for an all-ambiguous file (sent with preview + submit).
  const [dateOrder, setDateOrder] = useState<ChosenDateOrder | undefined>(undefined);
  // S2: the date format the preview on screen was checked with (undefined = none). Send needs it to match.
  const [resultDateOrder, setResultDateOrder] = useState<ChosenDateOrder | undefined>(undefined);

  function reset() {
    setResult(null);
    setFailure(null);
    setSignOff(SIGN_OFF_IDLE);
  }

  function downloadTemplate() {
    const blob = new Blob([strictTemplateCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = strictTemplateFilename();
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(f: File | undefined) {
    reset();
    setFile(null);
    setDateOrder(undefined);
    setResultDateOrder(undefined);
    if (!f) return;
    if (f.size > MAX_STRICT_FILE_BYTES) {
      toast.error("File is larger than 5 MB");
      return;
    }
    setPreviewing(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const base64 = bytesToBase64(bytes);
      setFile({ name: f.name, base64 });
      const res = await preview({ data: { filename: f.name, contentBase64: base64 } });
      if (res.ok) setResult(res.preview);
      else setFailure({ message: res.message, reasons: res.reasons });
    } catch (e) {
      setFailure({ message: (e as Error).message, reasons: [] });
    } finally {
      setPreviewing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** SCRUM-131 date fix: the uploader picked DD-MM or MM-DD; the server checks the file again with it. */
  // The current preview stays on screen (buttons disabled while busy) until the new one arrives. If the
  // re-check fails, the previous preview and the picker stay with the error, Send is off (the preview no
  // longer matches the choice), and the uploader can click a format again to retry.
  async function onChooseDateOrder(order: ChosenDateOrder) {
    if (!file || !canPickDateOrder(order, dateOrder, resultDateOrder, busy)) return;
    setFailure(null);
    setSignOff(SIGN_OFF_IDLE);
    setDateOrder(order);
    setPreviewing(true);
    const failed = (message: string, reasons: string[]) =>
      setFailure({
        message: `Could not check the file as ${dateOrderLabel(order)}: ${message}`,
        reasons,
      });
    try {
      const res = await preview({
        data: { filename: file.name, contentBase64: file.base64, dateOrder: order },
      });
      if (res.ok) {
        setResult(res.preview);
        setResultDateOrder(order);
      } else failed(res.message, res.reasons);
    } catch (e) {
      failed((e as Error).message, []);
    } finally {
      setPreviewing(false);
    }
  }

  /** acknowledgeRepeatFile: the "Submit anyway (repeat of …)" path after a repeat_file refusal. */
  async function onSendForSignOff(acknowledgeRepeatFile = false) {
    if (!file || !result || !previewMatchesChoice(resultDateOrder, dateOrder)) return;
    setSignOff({ status: "pending" });
    let next: SignOffState;
    try {
      const res = await submit({
        data: {
          filename: file.name,
          contentBase64: file.base64,
          expectedSha256: result.fileSha256,
          ...(resultDateOrder ? { dateOrder: resultDateOrder } : {}),
          ...(acknowledgeRepeatFile ? { acknowledgeRepeatFile: true } : {}),
        },
      });
      next = signOffAfter(res);
    } catch (e) {
      next = signOffAfterThrow(e);
    }
    setSignOff(next);
    if (next.status === "submitted") {
      toast.success(submittedTitle(next.result));
      await qc.invalidateQueries({ queryKey: ["import-approvals"] });
      await qc.invalidateQueries({ queryKey: IMPORT_APPROVAL_STATUS_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ["my-uploads"] });
    }
  }

  const s = result?.summary;
  // The server decides: canSubmit / blockers / row errors from the server preview.
  // S2: never send a preview that was not checked with the chosen date format (failed re-check).
  const serverCanSubmit =
    result && previewMatchesChoice(resultDateOrder, dateOrder)
      ? canSubmitForApproval(result)
      : false;
  const staleNote = staleDateOrderNote(resultDateOrder, dateOrder);
  const canSend = canSendForSignOff(serverCanSubmit, signOff);
  const repeatAction = repeatFileAction(signOff);
  const canAcknowledgeRepeat = canSubmitAnyway(serverCanSubmit, signOff);
  const busy = previewing || signOff.status === "pending";
  const submitted = signOff.status === "submitted" ? signOff.result : null;
  const nextLink = submitted ? postSubmitLink(isApprover, submitted.stageId) : null;
  const repeatWarning = result
    ? (result.repeatFileWarning ??
      (result.priorImport ? duplicateFileMessage(result.priorImport) : null))
    : null;
  const serverCounts = s ? serverCloudCounts(s) : null;
  const healerFixes = result ? serverHealerFixLines(result) : [];
  const healerFixCount = result ? serverHealerFixCount(result) : 0;
  const standardised = result ? serverStandardisedLine(result) : null;
  const rowErrors = serverErrorsByLine(result?.rowErrors ?? []);
  const datePrompt = dateOrderPrompt(result?.dateOrder);
  const previewPeriod = kpiPeriodFor("import.preview");

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Bulk import</AlertTitle>
        <AlertDescription>
          One non-blank row in = one new transaction. Nothing is merged or skipped.{" "}
          {STRICT_TEMPLATE_BANNER}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <CardTitle className="text-sm">Upload .xlsx or .csv (max 5 MB, 5,000 rows)</CardTitle>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 size-4" /> Template
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">{BULK_UPLOAD_HELP_TEXT}</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {previewing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            {previewing ? "Checking file…" : "Choose file and preview"}
          </Button>
          {file && (
            <div className="truncate text-sm text-muted-foreground" title={file.name}>
              File: {file.name}
            </div>
          )}
        </CardContent>
      </Card>

      {failure && (
        <Alert variant="destructive">
          <AlertTitle>{failure.message}</AlertTitle>
          {failure.reasons.length > 0 && (
            <AlertDescription>
              <ul className="list-disc pl-5">
                {failure.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}

      {result && s && !submitted && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              Preview{" "}
              <Badge variant="outline" className="shrink-0">
                {result.templateVersion}
              </Badge>
              {result.sheetName && (
                <Badge variant="secondary" className="shrink-0">
                  Sheet: {result.sheetName}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {datePrompt && (
              <Alert data-testid="date-order-prompt" aria-busy={previewing}>
                <AlertTitle>Date format</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {previewing && dateOrder
                      ? "Checking the file again with the date format you chose…"
                      : datePrompt.message}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DATE_ORDER_OPTIONS.map((o) => {
                      const selected = dateOrder === o.value;
                      return (
                        <Button
                          key={o.value}
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          aria-pressed={selected}
                          aria-disabled={
                            !canPickDateOrder(o.value, dateOrder, resultDateOrder, busy)
                          }
                          onClick={() => void onChooseDateOrder(o.value)}
                          data-testid={`date-order-${o.value}`}
                        >
                          {o.label}
                        </Button>
                      );
                    })}
                  </div>
                  {staleNote && !previewing && (
                    <p className="text-sm font-medium" data-testid="date-order-stale">
                      {staleNote}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {/* G9 (plan P04): the summary lines become inset tiles. Every number is the server's
                summary, as before; nothing is computed here. */}
            <div data-testid="preview-summary">
              <KpiGrid inset className="sm:grid-cols-4 xl:grid-cols-4">
                <SummaryKpi
                  variant="inset"
                  label="Rows to import"
                  value={s.rowsToImport.toLocaleString()}
                  period={previewPeriod}
                  subline={`${s.rowsInFile.toLocaleString()} in file · ${s.blankRowsIgnored.toLocaleString()} blank ignored`}
                />
                <SummaryKpi
                  variant="inset"
                  label="Private cloud"
                  value={s.privateRows.toLocaleString()}
                  period={previewPeriod}
                />
                <SummaryKpi
                  variant="inset"
                  label="Public cloud"
                  value={s.publicRows.toLocaleString()}
                  period={previewPeriod}
                />
                <SummaryKpi
                  variant="inset"
                  label="Customers"
                  value={s.distinctCustomers.toLocaleString()}
                  period={previewPeriod}
                />
                <SummaryKpi
                  variant="inset"
                  label="Errors"
                  value={s.errorCount.toLocaleString()}
                  period={previewPeriod}
                  subline={s.errorCount ? "Must be fixed in the file" : undefined}
                  sublineTone={s.errorCount ? "negative" : "neutral"}
                />
                <SummaryKpi
                  variant="inset"
                  label="Warnings"
                  value={s.warningCount.toLocaleString()}
                  period={previewPeriod}
                />
                <SummaryKpi
                  variant="inset"
                  label="Total selling"
                  value={formatCents(s.totalSellingCents)}
                  period={previewPeriod}
                />
                <SummaryKpi
                  variant="inset"
                  label="Total input"
                  value={formatCents(s.totalInputCents)}
                  period={previewPeriod}
                />
              </KpiGrid>
            </div>

            {serverCounts && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium" data-testid="cloud-summary">
                    {cloudPreviewSummaryLine(serverCounts, s.errorCount)}
                  </span>
                  {s.providerErrorRows > 0 && (
                    <span className="text-destructive">
                      · {s.providerErrorRows} {s.providerErrorRows === 1 ? "row" : "rows"} with a
                      provider error (listed under Errors)
                    </span>
                  )}
                </div>
                {standardised && <p className="text-xs text-muted-foreground">{standardised}</p>}
                <p className="text-xs text-muted-foreground">{CLOUD_RULE_HELP_TEXT}</p>
              </div>
            )}
            <HealerFixesList lines={healerFixes} total={healerFixCount} />
            <CloudRowsTable rows={result.providerRows} rowErrors={rowErrors} />

            <IssueTable issues={result.rowErrors} label="Errors (must be fixed in the file)" />
            <IssueTable
              issues={result.warnings}
              label="Notes (saved anyway — fix later by editing the transaction)"
            />

            {result.customers.newCustomers.length > 0 && (
              <Alert>
                <AlertTitle>New customers</AlertTitle>
                <AlertDescription>
                  These names are created automatically.
                  <ul className="list-disc pl-5 text-sm">
                    {result.customers.newCustomers.map((name) => (
                      <li key={name}>{name} — new customer</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {(result.customers.inFileVariants.length > 0 ||
              result.customers.matchedWithDifferentSpelling.length > 0) && (
              <Alert>
                <AlertTitle>Customer name variants</AlertTitle>
                <AlertDescription>
                  These do not block the import.
                  <ul className="list-disc pl-5 text-sm">
                    {result.customers.inFileVariants.map((v) => (
                      <li key={v.normalized}>
                        Same customer written differently in this file:{" "}
                        {v.spellings.map((x) => `"${x}"`).join(", ")} (lines {v.lines.join(", ")})
                      </li>
                    ))}
                    {result.customers.matchedWithDifferentSpelling.map((m) => (
                      <li key={m.fileName}>
                        "{m.fileName}" will be linked to existing customer "{m.existingName}" (lines{" "}
                        {m.lines.join(", ")})
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {repeatWarning && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Same file seen before</AlertTitle>
                <AlertDescription>{repeatWarning}</AlertDescription>
              </Alert>
            )}

            {result.blockers.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>This file cannot be sent for sign-off</AlertTitle>
                <AlertDescription>
                  {datePrompt?.kind === "choose" && (
                    <p className="font-medium" data-testid="date-order-blocker-hint">
                      Choose a date format (above) to continue.
                    </p>
                  )}
                  <ul className="list-disc pl-5">
                    {result.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {signOff.status === "error" && (
              <Alert variant="destructive" data-testid="sign-off-error">
                <AlertTitle>{signOffErrorTitle(signOff)}</AlertTitle>
                {signOff.reasons.length > 0 && (
                  <AlertDescription>
                    <ul className="list-disc pl-5">
                      {signOff.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                )}
                {repeatAction?.kind === "new_file" && (
                  <AlertDescription data-testid="repeat-new-file">
                    {repeatAction.message}
                  </AlertDescription>
                )}
                {repeatAction?.kind === "acknowledge" && (
                  <AlertDescription className="mt-2 space-y-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onSendForSignOff(true)}
                      disabled={!canAcknowledgeRepeat || busy}
                      data-testid="submit-anyway"
                    >
                      {repeatAction.label}
                    </Button>
                    <p className="text-xs">{repeatAction.note}</p>
                  </AlertDescription>
                )}
              </Alert>
            )}

            <div className="space-y-1">
              <Button
                onClick={() => void onSendForSignOff()}
                disabled={!canSend || busy}
                data-testid="send-for-sign-off"
              >
                {signOff.status === "pending" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                {signOffButtonLabel(s.rowsToImport, signOff)}
              </Button>
              <p className="text-xs text-muted-foreground">
                {signOffFootnote(serverCounts, s.errorCount)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {submitted && (
        <Alert data-testid="sign-off-submitted">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{submittedTitle(submitted)}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{submittedDetail(submitted, fmtDateTime(submitted.expiresAt))}</p>
            {nextLink && (
              <Button variant="outline" size="sm" asChild data-testid="sign-off-next-link">
                {nextLink.to === "/my-uploads" ? (
                  <Link to="/my-uploads">{nextLink.label}</Link>
                ) : (
                  <Link to={nextLink.to} params={nextLink.params}>
                    {nextLink.label}
                  </Link>
                )}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
