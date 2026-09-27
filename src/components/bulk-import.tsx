import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, CheckCircle2, AlertTriangle, X, FileWarning, RotateCw, ShieldAlert, Save, Bookmark, Ban, Sparkles, Eye, Settings2, Pencil, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { findOrCreateCustomer } from "@/lib/transactions.functions";
import { useAuth } from "@/lib/auth-context";
import { useQueryClient, useQuery } from "@tanstack/react-query";

type CloudKind = "public_cloud" | "private_cloud";
type DupStrategy = "skip" | "update" | "link";

interface Preset {
  id: string;
  name: string;
  kind: CloudKind;
  column_mapping: Record<string, number>;
  duplicate_strategy: DupStrategy;
  update_fields: string[] | null;
}

const PUBLIC_PROVIDERS = ["AWS", "Azure", "GCP"] as const;
const SYSTEM_CONFIG_OPTIONS = [
  "8GB 2vCPUs",
  "8GB 4vCPUs",
  "12GB 4vCPUs",
  "16GB 4vCPUs",
  "24GB 6vCPUs",
  "32GB 8vCPUs",
] as const;

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

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS_PER_CSV = 50_000;

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

function buildRowSchema(kind: CloudKind) {
  const base = {
    potential_id: z.string().trim().min(1, "potential_id required").max(50),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
    customer_name: z.string().trim().min(1).max(200),
    lab_name: z.string().trim().min(1).max(200),
    line_of_business: z.enum(LINE_OF_BUSINESS_OPTIONS, {
      errorMap: () => ({
        message: `line_of_business must be one of ${LINE_OF_BUSINESS_OPTIONS.join(", ")}`,
      }),
    }),
    start_date: z.string().regex(dateRe, "start_date must be YYYY-MM-DD"),
    end_date: z.string().regex(dateRe, "end_date must be YYYY-MM-DD"),
    total_users: z.coerce.number().int().positive(),
    input_cost: z.coerce.number().nonnegative().max(1_000_000_000),
    selling_cost: z.coerce.number().nonnegative().max(1_000_000_000),
  };
  if (kind === "public_cloud") {
    return z
      .object({
        ...base,
        cloud_provider: z.enum(PUBLIC_PROVIDERS, {
          errorMap: () => ({ message: `cloud_provider must be one of ${PUBLIC_PROVIDERS.join(", ")}` }),
        }),
      })
      .superRefine(commonRefine);
  }
  return z
    .object({
      ...base,
      system_config: z.enum(SYSTEM_CONFIG_OPTIONS, {
        errorMap: () => ({ message: `system_config must be one of ${SYSTEM_CONFIG_OPTIONS.join(", ")}` }),
      }),
    })
    .superRefine(commonRefine);
}

function commonRefine(v: { start_date: string; end_date: string; input_cost: number; selling_cost: number }, ctx: z.RefinementCtx) {
  if (v.end_date < v.start_date) ctx.addIssue({ code: "custom", path: ["end_date"], message: "end_date < start_date" });
  if (v.input_cost > v.selling_cost) ctx.addIssue({ code: "custom", path: ["input_cost"], message: "input_cost > selling_cost" });
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
  parsed?: Record<string, unknown>;
  errors: string[];
  failedFields?: string[];
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
  const [dupStrategy, setDupStrategy] = useState<DupStrategy>("skip");
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  // Preview suggested corrections + preset manager dialogs
  const [previewOpen, setPreviewOpen] = useState(false);
  const [presetMgrOpen, setPresetMgrOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<{ id: string; name: string; is_shared: boolean } | null>(null);
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
  // Fields the user opts to update when duplicate strategy = update
  const UPDATABLE_FIELDS = [
    "month", "year", "customer_name", "lab_name", "line_of_business",
    "start_date", "end_date", "total_users", "input_cost", "selling_cost",
    "cloud_provider", "system_config",
  ] as const;
  const [updateFields, setUpdateFields] = useState<Set<string>>(
    new Set(UPDATABLE_FIELDS),
  );
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

  // Presets (shared with all users)
  const { data: presets = [] } = useQuery({
    queryKey: ["bulk_import_presets", kind],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bulk_import_presets")
        .select("id,name,kind,column_mapping,duplicate_strategy,update_fields,is_shared,created_by,created_by_email")
        .eq("kind", kind)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Preset[];
    },
  });

  const headers = kind === "public_cloud" ? PUBLIC_HEADERS : PRIVATE_HEADERS;
  const sample = kind === "public_cloud" ? PUBLIC_SAMPLE : PRIVATE_SAMPLE;
  const schema = useMemo(() => buildRowSchema(kind), [kind]);

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
    const hdr = header.map((h) => h.trim().toLowerCase());
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
      toast.error(`Cannot proceed: missing columns ${mapping.missing.join(", ")}`);
      return;
    }
    const { body, colIdx } = mapping;
    const parsed: ParsedRow[] = body.map((cols, idx) => {
      const raw: Record<string, string> = {};
      for (const h of headers) raw[h] = (cols[colIdx[h]] ?? "").trim();
      const errors: string[] = [];
      const res = schema.safeParse(raw);
      if (!res.success) {
        for (const issue of res.error.issues) {
          errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
        }
      }
      // A Potential ID may legitimately cover several transactions, so repeats
      // within the file are allowed and never reported as errors.

      return { line: idx + 2, raw, parsed: res.success ? (res.data as Record<string, unknown>) : undefined, errors };
    });
    setRows(parsed);
    const ok = parsed.filter((r) => r.errors.length === 0).length;
    toast.success(`Parsed ${parsed.length} rows · ${ok} valid · ${parsed.length - ok} with errors`);
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
      const errors: string[] = [];
      const res = schema.safeParse(raw);
      if (!res.success) {
        for (const issue of res.error.issues) {
          errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
        }
      }
      // Repeated Potential IDs are allowed — never an error.

      return { line: r.line, raw, parsed: res.success ? (res.data as Record<string, unknown>) : undefined, errors };
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

  // --- Presets ---
  async function saveAsPreset() {
    if (!mapping) { toast.error("Upload a CSV first"); return; }
    if (!presetName.trim()) { toast.error("Enter a preset name"); return; }
    if (!user) return;
    const { error } = await supabase.from("bulk_import_presets").insert({
      name: presetName.trim(),
      kind,
      column_mapping: mapping.colIdx,
      duplicate_strategy: dupStrategy,
      update_fields: dupStrategy === "update" ? Array.from(updateFields) : null,
      is_shared: true,
      created_by: user.id,
      created_by_email: user.email ?? null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Preset "${presetName.trim()}" saved`);
    setPresetName("");
    qc.invalidateQueries({ queryKey: ["bulk_import_presets", kind] });
  }

  async function renamePreset(id: string, name: string, is_shared: boolean) {
    const { error } = await supabase
      .from("bulk_import_presets")
      .update({ name: name.trim(), is_shared })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Preset updated");
    setEditingPreset(null);
    qc.invalidateQueries({ queryKey: ["bulk_import_presets", kind] });
  }

  async function deletePreset(id: string) {
    if (!confirm("Delete this preset? This cannot be undone.")) return;
    const { error } = await supabase.from("bulk_import_presets").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    if (selectedPresetId === id) setSelectedPresetId("");
    toast.success("Preset deleted");
    qc.invalidateQueries({ queryKey: ["bulk_import_presets", kind] });
  }

  function applyPreset(id: string) {
    setSelectedPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setDupStrategy(p.duplicate_strategy);
    if (p.update_fields) setUpdateFields(new Set(p.update_fields));
    if (mapping) {
      const colIdx = p.column_mapping;
      const matched = headers.filter((h) => h in colIdx);
      const missing = headers.filter((h) => !(h in colIdx));
      setMapping({ ...mapping, colIdx, matched, missing });
    }
    toast.success(`Loaded preset "${p.name}"`);
  }

  async function importValid() {
    const valid = rows.filter((r) => r.errors.length === 0 && r.parsed);
    if (!valid.length) { toast.error("No valid rows to import"); return; }
    if (!user) { toast.error("Not authenticated"); return; }
    setSubmitting(true);
    setProgress({ done: 0, total: valid.length, succeeded: 0, failed: 0, isRetry: isRetryRun });
    const updated = [...rows];
    let imported = 0, skipped = 0, updatedCount = 0, linked = 0;
    // Distinct existing transactions matched by the natural key across this file.
    const matchedIds = new Set<string>();

    // Create run header
    const { data: run, error: runErr } = await supabase
      .from("bulk_import_runs")
      .insert({
        user_id: user.id,
        user_email: user.email ?? null,
        kind,
        filename: fileName,
        duplicate_strategy: dupStrategy,
        total_rows: rows.length,
        valid_rows: valid.length,
        invalid_rows: rows.length - valid.length,
        status: "pending",
        column_mapping: mapping?.colIdx ?? null,
        update_fields: dupStrategy === "update" ? Array.from(updateFields) : null,
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
        kind, filename: fileName, strategy: dupStrategy,
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
        const p = r.parsed as Record<string, unknown>;
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
            line_number: r.line, potential_id: String(p.potential_id),
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
          const cust = await findOrCreate({ data: { customerName: String(p.customer_name) } });
          const fullPayload = {
            potential_id: String(p.potential_id),
            month: Number(p.month),
            year: Number(p.year),
            customer_id: cust.id,
            customer_name: cust.customer_name,
            lab_name: String(p.lab_name),
            lab_type: kind,
            repository_type: kind,
            cloud_provider: kind === "private_cloud" ? "MakeMyLabs Private Cloud" : String(p.cloud_provider),
            system_config: kind === "private_cloud" ? String(p.system_config) : null,
            line_of_business: String(p.line_of_business),
            start_date: String(p.start_date),
            end_date: String(p.end_date),
            total_users: Number(p.total_users),
            input_cost: Number(p.input_cost),
            selling_cost: Number(p.selling_cost),
            created_by: user.id,
          } as Record<string, unknown>;

          // Duplicate match is the NATURAL KEY (potential_id + month + year +
          // lab_name), never potential_id alone — one Potential ID can hold
          // several ADR lines, and those extra lines must insert as new ADRs.
          const { data: match, error: matchErr } = await supabase
            .from("transactions")
            .select("id")
            .eq("potential_id", String(fullPayload.potential_id))
            .eq("month", Number(fullPayload.month))
            .eq("year", Number(fullPayload.year))
            .eq("lab_name", String(fullPayload.lab_name))
            .eq("is_deleted", false)
            .limit(1)
            .maybeSingle();
          if (matchErr) {
            // SCRUM-96: a failed lookup used to look like "no match" and the row was
            // inserted again (possible duplicate ADR). Mark the row failed instead.
            const ref = logIfError({ error: matchErr }, "bulk-import:match_lookup");
            throw new Error(`Could not check for an existing ADR, so this row was not imported (ref ${ref}). Retry the import.`);
          }

          if (match?.id) {
            matchedIds.add(match.id);
            if (dupStrategy === "skip") {
              updated[idx] = { ...r, errors: [`skipped: existing ADR for potential_id+month+year+lab_name (${String(fullPayload.potential_id)} · ${String(fullPayload.month)}/${String(fullPayload.year)} · ${String(fullPayload.lab_name)}) — nothing changed`] };
              rowStatus = "skipped"; skipped++; txId = match.id;
            } else if (dupStrategy === "update") {
              // Only overwrite the fields the user opted into; preserve the rest.
              // Update THIS matched row by id — never every txn sharing the PID.
              const partial: Record<string, unknown> = {};
              for (const f of updateFields) if (f in fullPayload) partial[f] = fullPayload[f];
              if (kind === "private_cloud") partial.system_config = fullPayload.system_config;
              const { error: updErr } = await supabase
                .from("transactions")
                .update(partial as never)
                .eq("id", match.id);
              if (updErr) {
                const enriched = enrichPgConstraintError(updErr.message, (updErr as { code?: string }).code);
                rowStatus = "error"; rowError = enriched.message;
                updated[idx] = { ...r, errors: [enriched.column ? `${enriched.column}: ${enriched.message}` : enriched.message] };
              } else {
                rowStatus = "updated"; updatedCount++; txId = match.id;
              }
            } else { // link
              // Link = read-only association, no fields overwritten.
              rowStatus = "linked"; linked++; txId = match.id;
              updated[idx] = { ...r, errors: [`linked to existing ADR ${String(fullPayload.potential_id)} (no fields changed)`] };
            }
          } else {
            const { data: ins, error } = await supabase.from("transactions").insert(fullPayload as never).select("id").single();
            if (error) {
              const enriched = enrichPgConstraintError(error.message, (error as { code?: string }).code);
              rowStatus = "error"; rowError = enriched.message;
              updated[idx] = { ...r, errors: [enriched.column ? `${enriched.column}: ${enriched.message}` : enriched.message] };
            }
            else { imported++; txId = ins?.id ?? null; }
          }
        } catch (err) {
          rowStatus = "error"; rowError = (err as Error).message;
          updated[idx] = { ...r, errors: [rowError] };
        }
        noteWrite(writeFailures, await supabase.from("bulk_import_row_audit").insert({
          run_id: runId, user_id: user.id, filename: fileName,
          line_number: r.line, potential_id: String(p.potential_id),
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
          kind, filename: fileName, strategy: dupStrategy,
          imported, updated: updatedCount, skipped, linked,
          unique_matched: matchedIds.size,
          valid: valid.length, invalid: rows.length - valid.length,
          claimed_valid: valid.length,
        },
      } as never), "audit:import_completed");
      toast.success(
        `Done · ${imported} new · ${updatedCount} updated (${matchedIds.size} existing matches of ${valid.length} valid rows) · ${skipped} skipped · ${linked} linked`,
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
          kind, filename: fileName, strategy: dupStrategy,
          imported, updated: updatedCount, skipped, linked,
          unique_matched: matchedIds.size,
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

        {/* Preset bar */}
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-2 bg-muted/30">
          <div className="flex flex-col gap-1">
            <Label className="text-xs flex items-center gap-1"><Bookmark className="h-3 w-3" />Use a saved preset</Label>
            <Select value={selectedPresetId} onValueChange={applyPreset}>
              <SelectTrigger className="w-[240px] h-9"><SelectValue placeholder={presets.length ? "Choose preset…" : "No presets yet"} /></SelectTrigger>
              <SelectContent>
                {presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Save current mapping + duplicate choices as…</Label>
            <div className="flex gap-1">
              <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" className="h-9 w-[200px]" />
              <Button size="sm" variant="outline" onClick={saveAsPreset} disabled={!mapping || !presetName.trim()}>
                <Save className="h-4 w-4 mr-1" />Save preset
              </Button>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground ml-auto self-end">
            Presets are shared with all Ops/Manager/Admin users in this workspace.
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPresetMgrOpen(true)} className="self-end">
            <Settings2 className="h-4 w-4 mr-1" />Manage
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">CSV file</Label>
            <Input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="max-w-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">If potential_id already exists</Label>
            <Select value={dupStrategy} onValueChange={(v) => setDupStrategy(v as DupStrategy)}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip the row</SelectItem>
                <SelectItem value="update">Update existing record</SelectItem>
                <SelectItem value="link">Link only (no write)</SelectItem>
              </SelectContent>
            </Select>
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
                      : "Keep only invalid rows; current mapping & duplicate strategy will be reused"}
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
                <div className="font-medium text-foreground mb-1">Missing required ({mapping.missing.length})</div>
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
              <Button size="sm" onClick={confirmMappingAndValidate} disabled={mapping.missing.length > 0}>
                Confirm & validate {mapping.body.length} row{mapping.body.length === 1 ? "" : "s"}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Duplicate handling explainer + per-field selector */}
        <div className="rounded-md border p-3 text-xs space-y-2">
          <div className="font-medium text-foreground">Duplicate handling: <span className="uppercase">{dupStrategy}</span></div>
          <div className="text-muted-foreground">
            Skip / Update / Link match on <span className="font-medium text-foreground">potential_id + month + year + lab_name</span>.
            Rows that do not match insert as new ADRs — including extra lines for an existing Potential ID and brand-new Potential IDs.
            Update only ever touches the one matched ADR; it never blasts every transaction sharing a Potential ID.
          </div>
          {dupStrategy === "skip" && (
            <div className="text-muted-foreground">An existing ADR with the same potential_id + month + year + lab_name is left unchanged and the incoming row is ignored (not an error).</div>
          )}
          {dupStrategy === "link" && (
            <div className="text-muted-foreground">No fields are written. All existing fields are preserved as-is. The audit log records a link reference only.</div>
          )}
          {dupStrategy === "update" && (
            <div className="space-y-2">
              <div className="text-muted-foreground">Pick which fields overwrite the matched ADR. Unchecked fields are preserved.</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
                {UPDATABLE_FIELDS.map((f) => {
                  const disabled = (f === "cloud_provider" && kind === "private_cloud")
                    || (f === "system_config" && kind === "public_cloud");
                  if (disabled) return null;
                  return (
                    <label key={f} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={updateFields.has(f)}
                        onCheckedChange={(c) => {
                          setUpdateFields((prev) => {
                            const next = new Set(prev);
                            if (c) next.add(f); else next.delete(f);
                            return next;
                          });
                        }}
                      />
                      <span>{f}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border text-xs text-muted-foreground p-3">
          <div className="font-medium text-foreground mb-1">Expected columns ({kind === "public_cloud" ? "Public" : "Private"} Cloud)</div>
          <code className="break-all">{headers.join(", ")}</code>
          {kind === "public_cloud" ? (
            <div className="mt-1">cloud_provider must be one of: {PUBLIC_PROVIDERS.join(", ")}.</div>
          ) : (
            <div className="mt-1">system_config must be one of: {SYSTEM_CONFIG_OPTIONS.join(", ")}.</div>
          )}
          <div>Dates use ISO format YYYY-MM-DD. A potential_id may repeat — several transactions can belong to one Potential ID. Column order is flexible.</div>
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
                           ? <Badge variant="outline" className="text-green-700 border-green-600/40">Valid</Badge>
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

        {/* Preset management — create/edit/rename/delete + sharing toggle */}
        <Dialog open={presetMgrOpen} onOpenChange={(o) => { setPresetMgrOpen(o); if (!o) setEditingPreset(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manage presets — {kind === "public_cloud" ? "Public" : "Private"} Cloud</DialogTitle>
              <DialogDescription>
                Saved header mappings and duplicate-handling choices. Shared presets are visible to all Ops/Manager/Admin users.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[55vh] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Sharing</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {presets.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No presets yet</TableCell></TableRow>
                  )}
                  {presets.map((p) => {
                    const pAny = p as Preset & { created_by?: string; created_by_email?: string | null; is_shared?: boolean };
                    const mine = pAny.created_by === user?.id;
                    const isEditing = editingPreset?.id === p.id;
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          {isEditing ? (
                            <Input
                              value={editingPreset!.name}
                              onChange={(e) => setEditingPreset({ ...editingPreset!, name: e.target.value })}
                              className="h-8"
                            />
                          ) : (
                            <span className="font-medium">{p.name}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{p.duplicate_strategy}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{pAny.created_by_email ?? "—"}</TableCell>
                        <TableCell>
                          {isEditing ? (
                            <label className="flex items-center gap-2 text-xs cursor-pointer">
                              <Checkbox
                                checked={editingPreset!.is_shared}
                                onCheckedChange={(c) => setEditingPreset({ ...editingPreset!, is_shared: !!c })}
                              />
                              Shared
                            </label>
                          ) : (
                            <Badge variant={pAny.is_shared ? "outline" : "secondary"} className="text-xs">
                              {pAny.is_shared ? "Shared" : "Private"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={() => renamePreset(p.id, editingPreset!.name, editingPreset!.is_shared)} disabled={!editingPreset!.name.trim()}>Save</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingPreset(null)}>Cancel</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => applyPreset(p.id)} title="Load into form">Load</Button>
                                <Button size="sm" variant="ghost" disabled={!mine} onClick={() => setEditingPreset({ id: p.id, name: p.name, is_shared: !!pAny.is_shared })} title={mine ? "Rename / sharing" : "Only the creator can edit"}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" disabled={!mine} onClick={() => deletePreset(p.id)} title={mine ? "Delete" : "Only the creator can delete"}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPresetMgrOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
