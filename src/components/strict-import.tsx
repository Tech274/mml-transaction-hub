// SCRUM-103: strict import screen ("what you upload is what you get").
// Only rendered when strict_import_enabled is on (see entry.tsx). The server
// re-parses and re-validates the same file on commit; this screen only
// explains what will happen and collects the user's approvals.
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { commitStrictImport, previewStrictImport } from "@/lib/strict-import.functions";
import { bytesToBase64 } from "@/lib/strict-import/hash";
import { MAX_STRICT_FILE_BYTES } from "@/lib/strict-import/parse";
import type { CommitResult, PreviewResult } from "@/lib/strict-import/service";
import type { RowIssue } from "@/lib/strict-import/validate";
import {
  STRICT_TEMPLATE_BANNER,
  canCommit,
  formatCents,
  needsAcknowledgement,
  pendingApprovals,
  strictTemplateCsv,
  strictTemplateFilename,
} from "@/lib/strict-import/ui-state";

const MAX_ISSUES_SHOWN = 200;

type Failure = { message: string; reasons: string[] };

function IssueTable({ issues, label }: { issues: RowIssue[]; label: string }) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        {label} ({issues.length}
        {issues.length > MAX_ISSUES_SHOWN ? `, first ${MAX_ISSUES_SHOWN} shown` : ""})
      </div>
      <div className="max-h-80 overflow-auto rounded border">
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
                <TableCell>{e.line}</TableCell>
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

export function StrictImport() {
  const preview = useServerFn(previewStrictImport);
  const commit = useServerFn(commitStrictImport);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [done, setDone] = useState<CommitResult | null>(null);

  function reset() {
    setResult(null);
    setFailure(null);
    setApproved(new Set());
    setAcknowledged(false);
    setDone(null);
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
    if (!f) return;
    if (f.size > MAX_STRICT_FILE_BYTES) {
      toast.error("File is larger than 5 MB");
      return;
    }
    setBusy("preview");
    try {
      const base64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()));
      setFile({ name: f.name, base64 });
      const res = await preview({ data: { filename: f.name, contentBase64: base64 } });
      if (res.ok) setResult(res.preview);
      else setFailure({ message: res.message, reasons: res.reasons });
    } catch (e) {
      setFailure({ message: (e as Error).message, reasons: [] });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onCommit() {
    if (!file || !result) return;
    setBusy("commit");
    try {
      const res = await commit({
        data: {
          filename: file.name,
          contentBase64: file.base64,
          expectedSha256: result.fileSha256,
          warningsAcknowledged: acknowledged,
          approvedNewCustomers: [...approved],
        },
      });
      if (res.ok) {
        setDone(res.result);
        toast.success(`Imported ${res.result.inserted} rows`);
        await qc.invalidateQueries();
      } else {
        setFailure({ message: res.message, reasons: res.reasons });
      }
    } catch (e) {
      setFailure({ message: (e as Error).message, reasons: [] });
    } finally {
      setBusy(null);
    }
  }

  const s = result?.summary;
  const pending = result ? pendingApprovals(result, approved) : [];
  const ready = result ? canCommit(result, approved, acknowledged) : false;

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Strict import (preview feature)</AlertTitle>
        <AlertDescription>
          One row in = one row out. Nothing is changed, merged or defaulted. {STRICT_TEMPLATE_BANNER}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Upload .xlsx or .csv (max 5 MB, 5,000 rows)</CardTitle>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Template
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={busy !== null}>
            <Upload className="mr-2 h-4 w-4" />
            {busy === "preview" ? "Checking file…" : "Choose file and preview"}
          </Button>
          {file && <div className="text-sm text-muted-foreground">File: {file.name}</div>}
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

      {result && s && !done && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Preview <Badge variant="outline">{result.templateVersion}</Badge>
              {result.sheetName && <Badge variant="secondary">Sheet: {result.sheetName}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>Rows in file: <b>{s.rowsInFile}</b></div>
              <div>Blank rows ignored: <b>{s.blankRowsIgnored}</b></div>
              <div>Rows to import: <b>{s.rowsToImport}</b></div>
              <div>Customers: <b>{s.distinctCustomers}</b></div>
              <div>Errors: <b className={s.errorCount ? "text-destructive" : ""}>{s.errorCount}</b></div>
              <div>Warnings: <b>{s.warningCount}</b></div>
              <div>Total selling: <b>{formatCents(s.totalSellingCents)}</b></div>
              <div>Total input: <b>{formatCents(s.totalInputCents)}</b></div>
            </div>

            {result.headerErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Column problems</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {result.headerErrors.map((h, i) => (
                      <li key={i}>{h.column ? `Column ${h.column}: ` : ""}{h.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <IssueTable issues={result.rowErrors} label="Errors (must be fixed in the file)" />
            <IssueTable issues={result.warnings} label="Warnings (must be acknowledged)" />

            {result.customers.newCustomers.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    New customers to create ({result.customers.newCustomers.length}), approve each one
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setApproved(new Set(result.customers.newCustomers))}>
                    Approve all
                  </Button>
                </div>
                <div className="max-h-60 space-y-1 overflow-auto rounded border p-2">
                  {result.customers.newCustomers.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <Checkbox
                        id={`nc-${name}`}
                        checked={approved.has(name)}
                        onCheckedChange={(v) => {
                          const next = new Set(approved);
                          if (v === true) next.add(name);
                          else next.delete(name);
                          setApproved(next);
                        }}
                      />
                      <Label htmlFor={`nc-${name}`} className="font-mono text-xs">{name}</Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(result.customers.inFileVariants.length > 0 || result.customers.matchedWithDifferentSpelling.length > 0) && (
              <Alert>
                <AlertTitle>Customer name variants</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5 text-sm">
                    {result.customers.inFileVariants.map((v) => (
                      <li key={v.normalized}>
                        Same customer written differently in this file: {v.spellings.map((x) => `"${x}"`).join(", ")} (lines {v.lines.join(", ")})
                      </li>
                    ))}
                    {result.customers.matchedWithDifferentSpelling.map((m) => (
                      <li key={m.fileName}>
                        "{m.fileName}" will be linked to existing customer "{m.existingName}" (lines {m.lines.join(", ")})
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {result.blockers.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Cannot import this file</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {result.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {needsAcknowledgement(result) && result.blockers.length === 0 && (
              <div className="flex items-center gap-2">
                <Checkbox id="si-ack" checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
                <Label htmlFor="si-ack">I have reviewed every warning and customer name variant above.</Label>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={() => void onCommit()} disabled={!ready || busy !== null}>
                {busy === "commit" ? "Importing…" : `Import ${s.rowsToImport} rows (all or nothing)`}
              </Button>
              {pending.length > 0 && result.blockers.length === 0 && (
                <span className="text-sm text-muted-foreground">{pending.length} new customer(s) still need approval</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {done && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Imported {done.inserted} rows</AlertTitle>
          <AlertDescription>
            Batch {done.batchId}. Total selling {formatCents(done.totalSellingCents)}, total input {formatCents(done.totalInputCents)}. Totals were reconciled by the database before saving.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
