import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, CheckCircle2, AlertTriangle, X, FileWarning, RotateCw, ShieldAlert, Ban, Sparkles, Eye } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { findOrCreateCustomer } from "@/lib/transactions.functions";
import { validateBulkImportRows } from "@/lib/bulk-import.functions";
import {
  parseLenientBulkRow,
  PUBLIC_PROVIDERS,
  SYSTEM_CONFIG_OPTIONS,
  type LenientValues,
} from "@/lib/bulk-import-lenient";
import { PRIVATE_CLOUD_PROVIDER } from "@/lib/adr-entry";
import { useAuth } from "@/lib/auth-context";
import { useQueryClient, useQuery } from "@tanstack/react-query";

type CloudKind = "public_cloud" | "private_cloud";

import {
  LINE_OF_BUSINESS_OPTIONS,
  PUBLIC_HEADERS,
  PRIVATE_HEADERS,
  TEMPLATE_VERSION,
  TEMPLATE_VERSION_COMMENT_PREFIX,
  enrichPgConstraintError,
} from "@/lib/bulk-template";
import { logIfError } from "@/lib/app-error";

const PUBLIC_SAMPLE: string[][] = [
  ["POT-2026-001", "1", "2026", "Acme Corp", "AWS Lab A", "VILT", "2026-01-01", "2026-01-31", "10", "1000.00", "1500.00", "AWS"],
  ["POT-2026-002", "2", "2026", "Beta Ltd", "Azure POC", "Standalone", "2026-02-01", "2026-02-28", "5", "500.00", "900.00", "Azure"],
];
const PRIVATE_SAMPLE: string[][] = [
  ["POT-2026-101", "1", "2026", "Acme Corp", "Private Lab A", "Integrated", "2026-01-01", "2026-01-31", "20", "2000.00", "3000.00", "16GB 4vCPUs"],
  ["POT-2026-102", "2", "2026", "Beta Ltd", "Private Lab B", "VILT", "2026-02-01", "2026-02-28", "8", "1200.00", "1800.00", "8GB 4vCPUs"],
];

const MAX_ROWS_PER_CSV = 50_000;

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

// Excel-style column letter for a zero-based index (A, B, ..., Z, AA, AB, ...)
function colLetter(idx: number): string {
  let n = idx + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Parse "field: message" error strings into structured pieces so the UI can
// point at the exact row + column and surface allowed-value hints.
function parseRowError(err: string): { field: string; message: string } {
  const i = err.indexOf(":");
  if (i === -1) return { field: "row", message: err };
  return { field: err.slice(0, i).trim(), message: err.slice(i + 1).trim() };
}

// ---------- CSV ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* ignore */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  // Drop blank rows and "# ..." comment lines (used for the template-version
  // header). The template version is inspected separately via extractTemplateVersion.
  return rows.filter(
    (r) => r.some((c) => c.trim() !== "") && !(r[0] ?? "").trim().startsWith("#"),
  );
}

/** Read the `# template_version:` marker written by downloadTemplate, if any. */
function extractTemplateVersion(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (!t.startsWith("#")) return null; // comments only allowed at the top
    if (t.startsWith(TEMPLATE_VERSION_COMMENT_PREFIX)) {
      return t.slice(TEMPLATE_VERSION_COMMENT_PREFIX.length).trim();
    }
  }
  return null;
}

function toCsv(headers: readonly string[], rows: string[][]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

function downloadFile(name: string, content: string, mime = "text/csv") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ---------- Component ----------
interface ParsedRow {
  line: number;
  raw: Record<string, string>;
  parsed?: LenientValues;
  errors: string[];
  warnings: string[];
  notes: string[];
  failedFields?: string[];
}

function formatNote(n: { column: string; value: string; message: string }): string {
  return `${n.column}: ${n.message}${n.value ? ` (was "${n.value}")` : ""}`;
}

function evaluateRow(raw: Record<string, string>, kind: CloudKind, line: number): ParsedRow {
  const parsed = parseLenientBulkRow(raw, kind, line);
  if (parsed.blank || !parsed.values) {
    return { line, raw, errors: [], warnings: [], notes: [], parsed: undefined };
  }
  return {
    line,
    raw,
    parsed: parsed.values,
    errors: [],
    warnings: parsed.warnings.map(formatNote),
    notes: parsed.notes.map(formatNote),
  };
}

// Heuristic correction suggestions per field; aimed at common fixable mistakes.
function suggestCorrection(field: string, raw: string, kind: CloudKind): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (field === "month") {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return String(Math.min(12, Math.max(1, n)));
  }
  if (field === "year") {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return String(Math.min(2100, Math.max(2000, n)));
  }
  if (field === "total_users" || field === "input_cost" || field === "selling_cost") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (cleaned) return cleaned;
  }
  if (field === "start_date" || field === "end_date") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (field === "cloud_provider") {
    const m = ["AWS", "Azure", "GCP"].find((p) => p.toLowerCase() === v.toLowerCase());
    if (m) return m;
  }
  if (field === "system_config" && kind === "private_cloud") {
    const norm = v.replace(/\s+/g, "").toLowerCase();
    const m = SYSTEM_CONFIG_OPTIONS.find((o) => o.replace(/\s+/g, "").toLowerCase() === norm);
    if (m) return m;
  }
  return "";
}

// SCRUM-96 slice 2: the importer's bookkeeping writes (audit rows, run status) used
// to be fire-and-forget, so failures were invisible. Each one is now checked; a
// failure is logged with a ref and the user is told once at the end of the run.
function noteWrite(failures: string[], res: { error: unknown } | null | undefined, where: string) {
  const ref = logIfError(res, `bulk-import:${where}`);
  if (ref) failures.push(`${where} (ref ${ref})`);
}

function warnWriteFailures(failures: string[]) {
  if (failures.length === 0) return;
  toast.warning(
    `${failures.length} audit/status record(s) could not be saved: ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? " …" : ""}. The import itself is shown above; tell engineering the ref.`,
  );
}

export function BulkImport() {
  const [kind, setKind] = useState<CloudKind>("public_cloud");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [rawCsvText, setRawCsvText] = useState<string>("");
  const [templateVersionMismatch, setTemplateVersionMismatch] = useState<
    { detected: string; current: string } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<
    { done: number; total: number; succeeded: number; failed: number; isRetry: boolean } | null
  >(null);
  const [isRetryRun, setIsRetryRun] = useState(false);
  const [parentRunId, setParentRunId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Per-row / per-field selection for suggested corrections in the Preview dialog.
  // Keyed by `${line}:${field}`; if a key is absent it defaults to selected.
  const [suggestionSelection, setSuggestionSelection] = useState<Record<string, boolean>>({});
  const isSuggestionSelected = (line: number, field: string) => {
    const k = `${line}:${field}`;
    return suggestionSelection[k] !== false; // default true
  };
  function toggleSuggestion(line: number, field: string, value: boolean) {
    setSuggestionSelection((s) => ({ ...s, [`${line}:${field}`]: value }));
  }
  // Pre-import mapping step
  const [mapping, setMapping] = useState<{
    detected: string[];
    matched: string[];
    missing: string[];
    extra: string[];
    body: string[][];
    colIdx: Record<string, number>;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const findOrCreate = useServerFn(findOrCreateCustomer);
  
  const { user } = useAuth();
  const qc = useQueryClient();

  // Guard: block retry while a previous run for this user is still in-flight.
  // Any pending run for this user blocks a retry — not just the newest one,
  // otherwise a stale pending run further down the list leaves the user stuck.
  const { data: pendingRuns = [] } = useQuery({
    queryKey: ["bulk_import_runs", "pending", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("bulk_import_runs")
        .select("id,status,filename,created_at")
        .eq("user_id", user!.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return (data ?? []) as Array<{ id: string; filename: string; created_at: string }>;
    },
    refetchInterval: submitting ? 2000 : false,
  });
  const lastRunInFlight = pendingRuns.length > 0;

  async function abandonPendingImports() {
    if (!user || !pendingRuns.length) return;
    if (!confirm(`Mark ${pendingRuns.length} pending import(s) as cancelled? No data is changed.`)) return;
    const writeFailures: string[] = [];
    let cancelled = 0;
    for (const r of pendingRuns) {
      const res = await supabase
        .from("bulk_import_runs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", r.id);
      noteWrite(writeFailures, res, "run_cancel");
      if (res.error) continue; // do not log a cancel event for a run that was not cancelled
      cancelled++;
      noteWrite(writeFailures, await supabase.from("bulk_import_audit_events").insert({
        run_id: r.id,
        event_type: "run_cancelled",
        actor_id: user.id,
        actor_email: user.email ?? null,
        details: { filename: r.filename, reason: "abandoned by user from bulk import tab" },
      } as never), "audit:run_cancelled");
    }
    if (cancelled > 0) toast.success(`Cancelled ${cancelled} pending import(s)`);
    if (cancelled < pendingRuns.length) toast.error(`${pendingRuns.length - cancelled} pending import(s) could not be cancelled. Try again.`);
    warnWriteFailures(writeFailures);
    qc.invalidateQueries({ queryKey: ["bulk_import_runs"] });
  }

  // Retry cap: count prior retries for this user (latest "completed" chain).
  const MAX_RETRIES = 3;
  const { data: retryStats } = useQuery({
    queryKey: ["bulk_import_runs", "retry-stats", user?.id, kind],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("bulk_import_runs")
        .select("id,retry_count,max_retries,parent_run_id,filename,status")
        .eq("user_id", user!.id)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });
  const retryBlocked = !!retryStats && (retryStats.retry_count ?? 0) >= (retryStats.max_retries ?? MAX_RETRIES);

  const headers = kind === "public_cloud" ? PUBLIC_HEADERS : PRIVATE_HEADERS;
  const sample = kind === "public_cloud" ? PUBLIC_SAMPLE : PRIVATE_SAMPLE;
  const validateRows = useServerFn(validateBulkImportRows);

  function downloadTemplate() {
    const versionLine = `${TEMPLATE_VERSION_COMMENT_PREFIX} ${TEMPLATE_VERSION}`;
    downloadFile(`${kind}-template.csv`, `${versionLine}\n${toCsv(headers, sample)}`);
  }

  function reset() {
    setRows([]); setFileName(""); setRawCsvText(""); setProgress(null); setMapping(null);
    setIsRetryRun(false); setParentRunId(null);
    setTemplateVersionMismatch(null);
    if (fileRef.current) fileRef.current.value = "";
    setSuggestionSelection({});
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("File exceeds 5MB"); return; }
    setFileName(f.name);
    const text = await f.text();
    const uploadedVersion = extractTemplateVersion(text);
    if (uploadedVersion && uploadedVersion !== TEMPLATE_VERSION) {
      toast.warning(
        `Template version mismatch: file says ${uploadedVersion}, current template is ${TEMPLATE_VERSION}. Re-download the template to avoid validation drift.`,
      );
      setTemplateVersionMismatch({ detected: uploadedVersion, current: TEMPLATE_VERSION });
    } else {
      setTemplateVersionMismatch(null);
    }
    const matrix = parseCsv(text);
    if (matrix.length === 0) { toast.error("Empty CSV"); return; }
    if (matrix.length - 1 > MAX_ROWS_PER_CSV) {
      toast.error(`CSV has ${matrix.length - 1} rows; max allowed is ${MAX_ROWS_PER_CSV.toLocaleString()}.`);
      return;
    }
    setRawCsvText(text);
    const [header, ...body] = matrix;
    const hdr = header.map((h) => normHeader(h));
    const colIdx: Record<string, number> = {};
    hdr.forEach((h, i) => { if (!(h in colIdx)) colIdx[h] = i; });
    const matched = headers.filter((h) => h in colIdx);
    const missing = headers.filter((h) => !(h in colIdx));
    const extra = hdr.filter((h) => !(headers as readonly string[]).includes(h));
    setMapping({ detected: hdr, matched, missing, extra, body, colIdx });
    setRows([]);
  }

  function confirmMappingAndValidate() {
    if (!mapping) return;
    if (mapping.missing.length) {
      toast.message(`Missing columns will be stored blank: ${mapping.missing.join(", ")}`);
    }
    const { body, colIdx } = mapping;
    let blank = 0;
    const parsed: ParsedRow[] = [];
    body.forEach((cols, idx) => {
      const raw: Record<string, string> = {};
      for (const h of headers) raw[h] = (cols[colIdx[h]] ?? "").trim();
      const row = evaluateRow(raw, kind, idx + 2);
      if (!row.parsed) {
        blank += 1;
        return;
      }
      parsed.push(row);
    });
    setRows(parsed);
    const notes = parsed.reduce((n, r) => n + r.warnings.length + r.notes.length, 0);
    toast.success(`Parsed ${parsed.length + blank} rows · ${parsed.length} to import · ${blank} blank skipped${notes ? ` · ${notes} notes` : ""}`);
  }

  function retryInvalidOnly() {
    if (retryBlocked) {
      toast.error(`Retry limit reached (${retryStats?.max_retries ?? MAX_RETRIES}). Start a fresh import.`);
      return;
    }
    const invalid = rows.filter((r) => r.errors.length > 0);
    if (!invalid.length) { toast.message("No invalid rows to retry"); return; }
    setRows(invalid);
    setIsRetryRun(true);
    setParentRunId(retryStats?.id ?? null);
    toast.success(`Kept ${invalid.length} invalid row${invalid.length === 1 ? "" : "s"}. Fix them and upload a corrected CSV, or re-run.`);
  }

  function downloadErrorReport() {
    const errs = rows.filter((r) => r.errors.length > 0);
    if (!errs.length) { toast.error("No invalid rows"); return; }
    // Per-field error columns + suggested corrected values for faster fixing.
    const suggCols = headers.map((h) => `suggested_${h}`);
    const cols = ["line", "potential_id", ...headers, "failed_fields", "validation_messages", ...suggCols];
    const body = errs.map((r) => {
      const fields = Array.from(new Set(r.errors.map((e) => e.split(":")[0].trim()))).join(", ");
      return [
        String(r.line),
        r.raw.potential_id ?? "",
        ...headers.map((h) => r.raw[h] ?? ""),
        fields,
        r.errors.join(" | "),
        ...headers.map((h) => fields.split(", ").includes(h) ? suggestCorrection(h, r.raw[h] ?? "", kind) : ""),
      ];
    });
    downloadFile(`${kind}-invalid-rows-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(cols, body));
  }

  function downloadErrorJson() {
    const errs = rows.filter((r) => r.errors.length > 0);
    if (!errs.length) { toast.error("No invalid rows"); return; }
    const payload = errs.map((r) => {
      const failed_fields = Array.from(new Set(r.errors.map((e) => e.split(":")[0].trim())));
      const suggested: Record<string, string> = {};
      for (const f of failed_fields) {
        const s = suggestCorrection(f, r.raw[f] ?? "", kind);
        if (s) suggested[f] = s;
      }
      return {
        line: r.line,
        potential_id: r.raw.potential_id ?? null,
        raw: r.raw,
        failed_fields,
        validation_messages: r.errors,
        suggested_values: suggested,
      };
    });
    downloadFile(
      `${kind}-invalid-rows-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }

  // ---------- Suggested corrections ----------
  // Compute the proposed corrected `raw` for an invalid row by running
  // suggestCorrection on each field that failed validation.
  function correctedRawFor(r: ParsedRow): Record<string, string> {
    const failed = Array.from(new Set(r.errors.map((e) => e.split(":")[0].trim())));
    const next: Record<string, string> = { ...r.raw };
    for (const f of failed) {
      if (!isSuggestionSelected(r.line, f)) continue;
      const s = suggestCorrection(f, r.raw[f] ?? "", kind);
      if (s) next[f] = s;
    }
    return next;
  }

  function suggestionDiffs() {
    return rows
      .filter((r) => r.errors.length > 0)
      .map((r) => {
        const corrected = correctedRawFor(r);
        const failed = Array.from(new Set(r.errors.map((e) => e.split(":")[0].trim())));
        const changes = failed
          .filter((f) => (corrected[f] ?? "") !== (r.raw[f] ?? ""))
          .map((f) => ({ field: f, before: r.raw[f] ?? "", after: corrected[f] ?? "" }));
        return { line: r.line, potential_id: r.raw.potential_id ?? "", failed, changes, corrected, raw: r.raw };
      });
  }

  // Download a CSV of all failed rows with suggested corrections applied,
  // using the standard template column order so it can be re-uploaded as-is.
  function downloadCorrectedCsv() {
    const errs = rows.filter((r) => r.errors.length > 0);
    if (!errs.length) { toast.error("No invalid rows"); return; }
    const body = errs.map((r) => {
      const c = correctedRawFor(r);
      return headers.map((h) => c[h] ?? "");
    });
    downloadFile(
      `${kind}-corrected-rows-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, body),
    );
  }

  // Apply suggested corrections to every invalid row, re-validate the whole
  // batch in place, and keep only the rows that were originally failing so
  // the user can immediately re-run "Import valid rows".
  function applySuggestedAndRetry() {
    if (retryBlocked) {
      toast.error(`Retry limit reached (${retryStats?.max_retries ?? MAX_RETRIES}). Start a fresh import.`);
      return;
    }
    const invalid = rows.filter((r) => r.errors.length > 0);
    if (!invalid.length) { toast.message("No invalid rows to retry"); return; }
    const next: ParsedRow[] = invalid.map((r) => {
      const raw = correctedRawFor(r);
      return evaluateRow(raw, kind, r.line);
    });
    setRows(next);
    setIsRetryRun(true);
    setParentRunId(retryStats?.id ?? null);
    setPreviewOpen(false);
    const fixed = next.filter((r) => r.errors.length === 0).length;
    if (user) {
      const applied = invalid.reduce((acc, r) => {
        const failed = Array.from(new Set(r.errors.map((e) => e.split(":")[0].trim())));
        return acc + failed.filter((f) => isSuggestionSelected(r.line, f)).length;
      }, 0);
      void supabase.from("bulk_import_audit_events").insert({
        run_id: null,
        parent_run_id: retryStats?.id ?? null,
        event_type: "apply_suggestions",
        actor_id: user.id,
        actor_email: user.email ?? null,
        details: { kind, filename: fileName, invalid_rows: invalid.length, fixed_after_apply: fixed, fields_applied: applied },
      } as never).then((res) => {
        // SCRUM-96: not fire-and-forget any more; this handler is synchronous, so check in .then.
        const failures: string[] = [];
        noteWrite(failures, res, "audit:apply_suggestions");
        warnWriteFailures(failures);
      });
    }
    toast.success(`Applied suggestions · ${fixed}/${next.length} now valid. Click "Import valid rows" to retry.`);
  }

  async function importValid() {
    const valid = rows.filter((r) => r.errors.length === 0 && r.parsed);
    if (!valid.length) { toast.error("No valid rows to import"); return; }
    if (!user) { toast.error("Not authenticated"); return; }
    let serverValues: LenientValues[];
    try {
      const checked = await validateRows({
        data: { kind, rows: valid.map((r) => r.raw), lines: valid.map((r) => r.line) },
      });
      if (checked.rows.length !== valid.length || checked.rows.some((r) => r.blank || !r.values)) {
        toast.error("Server re-check did not return one record per row. Nothing was imported.");
        return;
      }
      serverValues = checked.rows.map((r) => r.values as LenientValues);
    } catch (e) {
      toast.error(`Server re-check failed, nothing was imported: ${(e as Error).message}`);
      return;
    }
    setSubmitting(true);
    setProgress({ done: 0, total: valid.length, succeeded: 0, failed: 0, isRetry: isRetryRun });
    const updated = [...rows];
    let imported = 0, skipped = 0, updatedCount = 0, linked = 0;

    // Create run header
    const { data: run, error: runErr } = await supabase
      .from("bulk_import_runs")
      .insert({
        user_id: user.id,
        user_email: user.email ?? null,
        kind,
        filename: fileName,
        // Every non-blank row is inserted; nothing is skipped, updated or linked as a
        // duplicate. Needs 'insert' in bulk_import_runs_duplicate_strategy_check
        // (migration 20260928040000_scrum103_customer_name_normalize).
        duplicate_strategy: "insert",
        total_rows: rows.length,
        valid_rows: valid.length,
        invalid_rows: rows.length - valid.length,
        status: "pending",
        column_mapping: mapping?.colIdx ?? null,
        update_fields: null,
        parent_run_id: isRetryRun ? parentRunId : null,
        retry_count: isRetryRun ? ((retryStats?.retry_count ?? 0) + 1) : 0,
        max_retries: MAX_RETRIES,
      })
      .select("id").single();
    if (runErr || !run) {
      setSubmitting(false);
      toast.error(`Could not start import run: ${runErr?.message ?? "unknown"}`);
      return;
    }
    const runId = run.id;
    const writeFailures: string[] = [];

    // Audit: every import is recorded, not only retries.
    noteWrite(writeFailures, await supabase.from("bulk_import_audit_events").insert({
      run_id: runId,
      parent_run_id: isRetryRun ? parentRunId : null,
      event_type: "import_started",
      actor_id: user.id,
      actor_email: user.email ?? null,
      details: {
        kind, filename: fileName, strategy: "insert",
        valid: valid.length, invalid: rows.length - valid.length,
      },
    } as never), "audit:import_started");

    // Audit: record that a retry run started.
    if (isRetryRun) {
      noteWrite(writeFailures, await supabase.from("bulk_import_audit_events").insert({
        run_id: runId,
        parent_run_id: parentRunId,
        event_type: "retry_started",
        actor_id: user.id,
        actor_email: user.email ?? null,
        details: { kind, filename: fileName, valid_rows: valid.length, invalid_rows: rows.length - valid.length },
      } as never), "audit:retry_started");
    }

    // Idempotency for retries: skip lines that already succeeded in the
    // parent run chain so a re-import can't create duplicate transactions.
    // potential_id can legitimately repeat across records, so we key on
    // (parent_run_id, line_number) instead of potential_id.
    const alreadyDoneLines = new Set<number>();
    if (isRetryRun && parentRunId) {
      const { data: prior, error: priorErr } = await supabase
        .from("bulk_import_row_audit")
        .select("line_number,status")
        .eq("run_id", parentRunId)
        .in("status", ["imported", "updated", "linked"]);
      if (priorErr) {
        // SCRUM-96: without this list a retry would re-import lines that already
        // succeeded (duplicates). Stop instead of guessing.
        const ref = logIfError({ error: priorErr }, "bulk-import:retry_lookup");
        noteWrite(writeFailures, await supabase.from("bulk_import_runs").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", runId), "run_update");
        setSubmitting(false);
        toast.error(`Retry stopped: could not read which lines already succeeded, so nothing was imported (ref ${ref}). Try again.`);
        warnWriteFailures(writeFailures);
        return;
      }
      for (const p of (prior ?? []) as Array<{ line_number: number }>) alreadyDoneLines.add(p.line_number);
    }

    // Upload original CSV to private storage so it can be re-downloaded from history.
    if (rawCsvText) {
      const path = `${user.id}/${runId}/original.csv`;
      const up = await supabase.storage
        .from("bulk-imports")
        .upload(path, new Blob([rawCsvText], { type: "text/csv" }), { upsert: true, contentType: "text/csv" });
      noteWrite(writeFailures, up, "storage_upload:original_csv");
      if (!up.error) {
        noteWrite(writeFailures, await supabase.from("bulk_import_runs").update({ original_csv_path: path } as never).eq("id", runId), "run_update");
      }
    }

    // Log invalid rows up-front
    const invalidRows = rows.filter((r) => r.errors.length > 0);
    if (invalidRows.length) {
      noteWrite(writeFailures, await supabase.from("bulk_import_row_audit").insert(
        invalidRows.map((r) => ({
          run_id: runId, user_id: user.id, filename: fileName,
          line_number: r.line, potential_id: r.raw.potential_id || null,
          status: "error", error_message: r.errors.join("; "), row_data: r.raw,
        })),
      ), "row_audit");
    }

    try {
      for (let i = 0; i < valid.length; i++) {
        // Yield to the UI thread every row so the progress bar stays responsive
        // and the page does not appear frozen on large imports.
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        const r = valid[i];
        const idx = updated.findIndex((x) => x.line === r.line);
        const p = serverValues[i];
        let rowStatus: "imported" | "updated" | "linked" | "skipped" | "error" = "imported";
        let rowError: string | null = null;
        let txId: string | null = null;
        // Idempotent retry: if this line already succeeded in the parent run,
        // skip it here to avoid creating a duplicate transaction.
        if (alreadyDoneLines.has(r.line)) {
          rowStatus = "skipped"; skipped++;
          updated[idx] = { ...r, errors: [`skipped: line ${r.line} already imported in parent run`] };
          noteWrite(writeFailures, await supabase.from("bulk_import_row_audit").insert({
            run_id: runId, user_id: user.id, filename: fileName,
            line_number: r.line, potential_id: p.potential_id,
            transaction_id: null, status: rowStatus,
            error_message: "idempotent: already processed in parent run",
            row_data: r.raw,
          }), "row_audit");
          setProgress((prev) => ({
            done: i + 1, total: valid.length,
            succeeded: (prev?.succeeded ?? 0) + 1,
            failed: prev?.failed ?? 0,
            isRetry: prev?.isRetry ?? isRetryRun,
          }));
          continue;
        }
        try {
          const cust = p.customer_name
            ? await findOrCreate({ data: { customerName: p.customer_name } })
            : null;
          const fullPayload: {
            potential_id: string | null;
            month: number | null;
            year: number | null;
            customer_id: string | null;
            customer_name: string | null;
            lab_name: string | null;
            lab_type: typeof kind;
            repository_type: typeof kind;
            cloud_provider: string | null;
            system_config: string | null;
            line_of_business: string | null;
            start_date: string | null;
            end_date: string | null;
            total_users: number | null;
            input_cost: number | null;
            selling_cost: number | null;
            created_by: string;
            [key: string]: unknown;
          } = {
            potential_id: p.potential_id,
            month: p.month,
            year: p.year,
            customer_id: cust?.id ?? null,
            customer_name: cust?.customer_name ?? p.customer_name,
            lab_name: p.lab_name,
            lab_type: kind,
            repository_type: kind,
            cloud_provider: kind === "private_cloud"
              ? (p.cloud_provider && p.cloud_provider.trim() !== "" ? p.cloud_provider : PRIVATE_CLOUD_PROVIDER)
              : p.cloud_provider,
            system_config: kind === "private_cloud" ? p.system_config : null,
            line_of_business: p.line_of_business,
            start_date: p.start_date,
            end_date: p.end_date,
            total_users: p.total_users,
            input_cost: p.input_cost,
            selling_cost: p.selling_cost,
            created_by: user.id,
          };

          // Every non-blank row is a new transaction. Identical rows, and rows
          // that match an existing potential_id + month + year + lab_name, are
          // inserted too. Nothing is merged, skipped, updated or linked.
          const { data: ins, error } = await supabase.from("transactions").insert(fullPayload as never).select("id").single();
          if (error) {
            const enriched = enrichPgConstraintError(error.message, (error as { code?: string }).code);
            rowStatus = "error"; rowError = enriched.message;
            updated[idx] = { ...r, errors: [enriched.column ? `${enriched.column}: ${enriched.message}` : enriched.message] };
          } else { imported++; txId = ins?.id ?? null; }
        } catch (err) {
          rowStatus = "error"; rowError = (err as Error).message;
          updated[idx] = { ...r, errors: [rowError] };
        }
        noteWrite(writeFailures, await supabase.from("bulk_import_row_audit").insert({
          run_id: runId, user_id: user.id, filename: fileName,
          line_number: r.line, potential_id: p.potential_id,
          transaction_id: txId, status: rowStatus, error_message: rowError, row_data: r.raw,
        }), "row_audit");
        setProgress((prev) => ({
          done: i + 1,
          total: valid.length,
          succeeded: (prev?.succeeded ?? 0) + (rowStatus !== "error" ? 1 : 0),
          failed: (prev?.failed ?? 0) + (rowStatus === "error" ? 1 : 0),
          isRetry: prev?.isRetry ?? isRetryRun,
        }));
      }
      noteWrite(writeFailures, await supabase.from("bulk_import_runs").update({
        imported_rows: imported, skipped_rows: skipped, updated_rows: updatedCount, linked_rows: linked,
        status: "completed", completed_at: new Date().toISOString(),
      }).eq("id", runId), "run_update");
      // Upload structured error artifact (JSON) for fast post-mortem.
      const failedRows = updated.filter((r) => r.errors.length > 0);
      if (failedRows.length) {
        const artifact = {
          run_id: runId,
          filename: fileName,
          kind,
          generated_at: new Date().toISOString(),
          rows: failedRows.map((r) => ({
            line: r.line,
            potential_id: r.raw.potential_id ?? null,
            failed_fields: r.errors.map((e) => e.split(":")[0]),
            validation_messages: r.errors,
            raw: r.raw,
          })),
        };
        const path = `${user.id}/${runId}/errors.json`;
        const up = await supabase.storage
          .from("bulk-imports")
          .upload(path, new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }),
                  { upsert: true, contentType: "application/json" });
        noteWrite(writeFailures, up, "storage_upload:errors_json");
        if (!up.error) {
          noteWrite(writeFailures, await supabase.from("bulk_import_runs").update({ error_artifact_path: path } as never).eq("id", runId), "run_update");
        }
      }
      setRows(updated);
      noteWrite(writeFailures, await supabase.from("bulk_import_audit_events").insert({
        run_id: runId,
        parent_run_id: isRetryRun ? parentRunId : null,
        event_type: "import_completed",
        actor_id: user.id,
        actor_email: user.email ?? null,
        details: {
          kind, filename: fileName, strategy: "insert",
          imported, updated: updatedCount, skipped, linked,
          valid: valid.length, invalid: rows.length - valid.length,
          claimed_valid: valid.length,
        },
      } as never), "audit:import_completed");
      toast.success(
        `Done · ${imported} inserted · ${skipped} skipped on retry · ${valid.length} non-blank rows`,
      );
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["bulk_import_runs"] });
      qc.invalidateQueries({ queryKey: ["bulk_import_runs", "retry-stats", user?.id, kind] });
      warnWriteFailures(writeFailures);
    } catch (e) {
      noteWrite(writeFailures, await supabase.from("bulk_import_runs").update({
        status: "failed", completed_at: new Date().toISOString(),
      }).eq("id", runId), "run_update");
      noteWrite(writeFailures, await supabase.from("bulk_import_audit_events").insert({
        run_id: runId,
        parent_run_id: isRetryRun ? parentRunId : null,
        event_type: "import_failed",
        actor_id: user.id,
        actor_email: user.email ?? null,
        details: {
          kind, filename: fileName, strategy: "insert",
          imported, updated: updatedCount, skipped, linked,
          valid: valid.length, invalid: rows.length - valid.length,
          error: (e as Error).message,
        },
      } as never), "audit:import_failed");
      toast.error(`Import failed: ${(e as Error).message}`);
      warnWriteFailures(writeFailures);
    } finally {
      setSubmitting(false);
    }
  }

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const errorCount = rows.length - validCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Import Transactions</CardTitle>
        <p className="text-sm text-muted-foreground">
          Download a CSV template for Public or Private Cloud, fill it in, and upload to import multiple records at once.
          Columns can appear in any order as long as the header names match. New customers are created automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 border-b pb-3">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">Repository</span>
          <Button size="sm" variant={kind === "public_cloud" ? "default" : "outline"} onClick={() => { setKind("public_cloud"); reset(); }}>Public Cloud</Button>
          <Button size="sm" variant={kind === "private_cloud" ? "default" : "outline"} onClick={() => { setKind("private_cloud"); reset(); }}>Private Cloud</Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-1" /> Download {kind === "public_cloud" ? "Public" : "Private"} Cloud Template
            </Button>
          </div>
        </div>

        {/* Retry-cap banner */}
        {retryBlocked && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-sm p-2">
            <Ban className="h-4 w-4" />
            Retry limit reached on your last {kind === "public_cloud" ? "Public" : "Private"} Cloud run
            ({retryStats?.retry_count}/{retryStats?.max_retries ?? MAX_RETRIES}). Start a fresh import to continue.
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">CSV file</Label>
            <Input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="max-w-sm" />
          </div>
          {fileName && <span className="text-xs text-muted-foreground self-end pb-2">{fileName}</span>}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" />{validCount} valid</Badge>
              <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3 text-amber-600" />{errorCount} errors</Badge>
              {isRetryRun && <Badge variant="secondary" className="gap-1"><RotateCw className="h-3 w-3" />Retry run</Badge>}
              {errorCount > 0 && (
                <Button size="sm" variant="outline" onClick={downloadErrorReport}>
                  <FileWarning className="h-4 w-4 mr-1" />Download error report
                </Button>
              )}
              {errorCount > 0 && (
                <Button size="sm" variant="outline" onClick={downloadErrorJson} title="JSON with raw input, failed_fields, validation_messages and suggested values">
                  <FileWarning className="h-4 w-4 mr-1" />Download JSON
                </Button>
              )}
              {errorCount > 0 && (
                <Button size="sm" variant="outline" onClick={downloadCorrectedCsv} title="CSV of failed rows with suggested corrections applied, ready to re-upload">
                  <Download className="h-4 w-4 mr-1" />Corrected CSV
                </Button>
              )}
              {errorCount > 0 && (
                <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} title="Preview before/after for suggested corrections">
                  <Eye className="h-4 w-4 mr-1" />Preview suggestions
                </Button>
              )}
              {errorCount > 0 && (
                <Button
                  size="sm"
                  onClick={applySuggestedAndRetry}
                  disabled={submitting || lastRunInFlight || retryBlocked}
                  title={retryBlocked
                    ? `Retry limit reached (${retryStats?.max_retries ?? MAX_RETRIES})`
                    : "Apply suggested corrections to failed rows and re-validate"}
                >
                  <Sparkles className="h-4 w-4 mr-1" />Retry with suggestions
                </Button>
              )}
              {errorCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={retryInvalidOnly}
                  disabled={submitting || lastRunInFlight || retryBlocked}
                  title={retryBlocked
                    ? `Retry limit reached (${retryStats?.max_retries ?? MAX_RETRIES})`
                    : lastRunInFlight
                      ? "Wait for the previous import to finish"
                      : "Keep only invalid rows; the current column mapping will be reused"}
                >
                  <RotateCw className="h-4 w-4 mr-1" />Retry invalid rows
                </Button>
              )}
              {lastRunInFlight && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={abandonPendingImports}
                  title="Mark stuck pending imports as cancelled so retries are unblocked"
                  data-testid="abandon-pending-import"
                >
                  <X className="h-4 w-4 mr-1" />Abandon pending import ({pendingRuns.length})
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={reset}><X className="h-4 w-4 mr-1" />Clear</Button>
              <Button size="sm" disabled={submitting || validCount === 0} onClick={importValid}>
                <Upload className="h-4 w-4 mr-1" />
                {submitting && progress
                  ? `Importing ${progress.done}/${progress.total}…`
                  : `Import ${validCount} valid row${validCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          )}
        </div>

        {submitting && progress && (
          <div className="space-y-1">
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
            <div className="text-xs flex flex-wrap items-center gap-2">
              {progress.isRetry && (
                <Badge variant="secondary" className="gap-1"><RotateCw className="h-3 w-3" />Retry in progress</Badge>
              )}
              <span className="text-muted-foreground">
                Attempted <strong className="text-foreground">{progress.done}</strong> / {progress.total} ·
                <span className="text-green-700"> {progress.succeeded} succeeded</span> ·
                <span className="text-destructive"> {progress.failed} failed</span>
              </span>
            </div>
          </div>
        )}

        {/* Pre-import mapping preview */}
        {templateVersionMismatch && (
          <div
            role="alert"
            data-testid="template-version-mismatch-banner"
            className="rounded-md border border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100 p-3 text-sm flex items-start gap-2"
          >
            <FileWarning className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <div className="font-medium">Template version mismatch</div>
              <div>
                Uploaded file template_version is{" "}
                <strong data-testid="tvm-detected">{templateVersionMismatch.detected}</strong>,
                but the current downloadable template is{" "}
                <strong data-testid="tvm-current">{templateVersionMismatch.current}</strong>.
                Re-download the latest template to avoid validation drift.
              </div>
            </div>
          </div>
        )}
        {mapping && rows.length === 0 && (
          <div className="rounded-md border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-amber-600" /> Confirm column mapping
            </div>
            <div className="grid md:grid-cols-3 gap-3 text-xs">
              <div>
                <div className="font-medium text-foreground mb-1">Matched ({mapping.matched.length})</div>
                <ul className="space-y-0.5">
                  {mapping.matched.map((h) => (
                    <li key={h} className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-600" /> {h}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-medium text-foreground mb-1">Missing — stored blank ({mapping.missing.length})</div>
                {mapping.missing.length === 0
                  ? <div className="text-muted-foreground">None — good to go.</div>
                  : <ul className="space-y-0.5">{mapping.missing.map((h) => (
                      <li key={h} className="flex items-center gap-1 text-destructive">
                        <X className="h-3 w-3" /> {h}
                      </li>
                    ))}</ul>}
              </div>
              <div>
                <div className="font-medium text-foreground mb-1">Extra / ignored ({mapping.extra.length})</div>
                {mapping.extra.length === 0
                  ? <div className="text-muted-foreground">None.</div>
                  : <ul className="space-y-0.5 text-muted-foreground">{mapping.extra.map((h) => (
                      <li key={h}>· {h}</li>
                    ))}</ul>}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={confirmMappingAndValidate}>
                Confirm & validate {mapping.body.length} row{mapping.body.length === 1 ? "" : "s"}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          Every non-blank row is inserted as a new transaction, including rows that match an existing one or each other. Nothing is merged or skipped.
        </div>

        <div className="rounded-md border text-xs text-muted-foreground p-3">
          <div className="font-medium text-foreground mb-1">Expected columns ({kind === "public_cloud" ? "Public" : "Private"} Cloud)</div>
          <code className="break-all">{headers.join(", ")}</code>
          {kind === "public_cloud" ? (
            <div className="mt-1">A cloud_provider other than {PUBLIC_PROVIDERS.join(", ")} is saved blank and listed as a note. It does not block the import.</div>
          ) : (
            <div className="mt-1">A system_config outside {SYSTEM_CONFIG_OPTIONS.join(", ")} is saved blank and listed as a note. It does not block the import.</div>
          )}
          <div>Blank cells stay blank (they are not stored as 0). Dates use YYYY-MM-DD. A potential_id may repeat — several transactions can belong to one Potential ID, and identical rows are all inserted. Column order is flexible; header names ignore case and spaces.</div>
          {kind === "private_cloud" && <div>A blank cloud provider is stored as {PRIVATE_CLOUD_PROVIDER}.</div>}
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Line</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  {headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
                  <TableHead>Errors</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                 {rows.map((r) => {
                   const parsedErrs = r.errors.map(parseRowError);
                   const invalidFields = new Set(parsedErrs.map((e) => e.field));
                   return (
                     <TableRow key={r.line} className={r.errors.length ? "bg-destructive/5" : ""}>
                       <TableCell className="text-muted-foreground">{r.line}</TableCell>
                       <TableCell>
                         {r.errors.length === 0
                           ? <Badge variant="outline" className="text-green-700 border-green-600/40">{r.warnings.length || r.notes.length ? "Saved with notes" : "Ready"}</Badge>
                           : <Badge variant="destructive">Error</Badge>}
                       </TableCell>
                       {headers.map((h, hi) => {
                         const bad = invalidFields.has(h);
                         return (
                           <TableCell
                             key={h}
                             data-testid={bad ? `invalid-cell-${r.line}-${h}` : undefined}
                             className={`max-w-[180px] truncate ${bad ? "bg-destructive/10 text-destructive font-medium ring-1 ring-destructive/40" : ""}`}
                             title={bad ? `Row ${r.line} · Column ${colLetter(hi + 2)} (${h}) is invalid: "${r.raw[h] ?? ""}"` : undefined}
                           >
                             {r.raw[h]}
                           </TableCell>
                         );
                       })}
                       <TableCell className="text-xs">
                         {r.warnings.length + r.notes.length > 0 && (
                           <ul className="mb-1 space-y-1 text-amber-800" data-testid={`row-notes-${r.line}`}>
                             {[...r.warnings, ...r.notes].map((n, i) => <li key={i}>{n}</li>)}
                           </ul>
                         )}
                         {parsedErrs.length === 0 ? null : (
                           <ul className="space-y-1" data-testid={`row-errors-${r.line}`}>
                             {parsedErrs.map((e, i) => {
                               const hi = (headers as readonly string[]).indexOf(e.field);
                               const isLob = e.field === "line_of_business";
                               return (
                                 <li key={i} className="flex flex-wrap items-center gap-1 text-destructive" data-testid={`row-error-${r.line}-${e.field}`}>
                                   <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                                     Row {r.line}
                                   </Badge>
                                   <Badge variant="outline" className="text-[10px] border-destructive/50 text-destructive">
                                     Col {hi >= 0 ? `${colLetter(hi + 2)} · ` : ""}{e.field}
                                   </Badge>
                                   <span>{e.message}</span>
                                   {isLob && (
                                     <span className="text-[11px] text-muted-foreground" data-testid={`lob-allowed-hint-${r.line}`}>
                                       Allowed: {LINE_OF_BUSINESS_OPTIONS.join(", ")}. Got: "{r.raw["line_of_business"] ?? ""}"
                                     </span>
                                   )}
                                 </li>
                               );
                             })}
                           </ul>
                         )}
                       </TableCell>
                     </TableRow>
                   );
                 })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Preview suggested corrections — before/after per failed row */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Preview suggested corrections</DialogTitle>
              <DialogDescription>
                Review the proposed before/after values for each failed row. Apply to retry, or download artifacts.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Apply</TableHead>
                    <TableHead className="w-14">Line</TableHead>
                    <TableHead>Potential ID</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Before</TableHead>
                    <TableHead>After (suggested)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestionDiffs().flatMap((d) =>
                    d.changes.length === 0
                      ? [(
                          <TableRow key={`${d.line}-none`}>
                            <TableCell />
                            <TableCell className="text-muted-foreground">{d.line}</TableCell>
                            <TableCell className="text-xs">{d.potential_id || "—"}</TableCell>
                            <TableCell colSpan={3} className="text-xs text-muted-foreground">
                              No automatic suggestion available for: {d.failed.join(", ") || "—"}
                            </TableCell>
                          </TableRow>
                        )]
                      : d.changes.map((c, i) => (
                          <TableRow key={`${d.line}-${c.field}`}>
                            <TableCell>
                              <Checkbox
                                checked={isSuggestionSelected(d.line, c.field)}
                                onCheckedChange={(v) => toggleSuggestion(d.line, c.field, v === true)}
                                aria-label={`Apply suggestion for line ${d.line} field ${c.field}`}
                              />
                            </TableCell>
                            {i === 0 ? (
                              <>
                                <TableCell className="text-muted-foreground align-top" rowSpan={d.changes.length}>{d.line}</TableCell>
                                <TableCell className="text-xs align-top" rowSpan={d.changes.length}>{d.potential_id || "—"}</TableCell>
                              </>
                            ) : null}
                            <TableCell className="text-xs font-medium">{c.field}</TableCell>
                            <TableCell className="text-xs text-destructive line-through max-w-[180px] truncate" title={c.before}>{c.before || "(empty)"}</TableCell>
                            <TableCell className="text-xs text-green-700 max-w-[180px] truncate" title={c.after}>{c.after}</TableCell>
                          </TableRow>
                        )),
                  )}
                  {suggestionDiffs().length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No invalid rows.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <DialogFooter className="gap-2">
              <div className="mr-auto flex gap-2 text-xs">
                <Button size="sm" variant="ghost" onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const d of suggestionDiffs()) for (const c of d.changes) next[`${d.line}:${c.field}`] = true;
                  setSuggestionSelection(next);
                }}>Select all</Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const d of suggestionDiffs()) for (const c of d.changes) next[`${d.line}:${c.field}`] = false;
                  setSuggestionSelection(next);
                }}>Clear all</Button>
              </div>
              <Button variant="outline" onClick={downloadCorrectedCsv}>
                <Download className="h-4 w-4 mr-1" />Download corrected CSV
              </Button>
              <Button variant="outline" onClick={downloadErrorJson}>
                <FileWarning className="h-4 w-4 mr-1" />Download JSON artifact
              </Button>
              <Button onClick={applySuggestedAndRetry} disabled={submitting || lastRunInFlight || retryBlocked}>
                <Sparkles className="h-4 w-4 mr-1" />Apply &amp; retry
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
