import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, CheckCircle2, AlertTriangle, X, FileWarning, RotateCw, ShieldAlert, Save, Bookmark, Ban } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { findOrCreateCustomer, checkPotentialIdUnique } from "@/lib/transactions.functions";
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

const COMMON_HEADERS = [
  "potential_id",
  "month",
  "year",
  "customer_name",
  "lab_name",
  "line_of_business",
  "start_date",
  "end_date",
  "total_users",
  "input_cost",
  "selling_cost",
] as const;

const PUBLIC_HEADERS = [...COMMON_HEADERS, "cloud_provider"] as const;
const PRIVATE_HEADERS = [...COMMON_HEADERS, "system_config"] as const;

const PUBLIC_SAMPLE: string[][] = [
  ["POT-2026-001", "1", "2026", "Acme Corp", "AWS Lab A", "Training", "2026-01-01", "2026-01-31", "10", "1000.00", "1500.00", "AWS"],
  ["POT-2026-002", "2", "2026", "Beta Ltd", "Azure POC", "Consulting", "2026-02-01", "2026-02-28", "5", "500.00", "900.00", "Azure"],
];
const PRIVATE_SAMPLE: string[][] = [
  ["POT-2026-101", "1", "2026", "Acme Corp", "Private Lab A", "Training", "2026-01-01", "2026-01-31", "20", "2000.00", "3000.00", "16GB 4vCPUs"],
  ["POT-2026-102", "2", "2026", "Beta Ltd", "Private Lab B", "Consulting", "2026-02-01", "2026-02-28", "8", "1200.00", "1800.00", "8GB 4vCPUs"],
];

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function buildRowSchema(kind: CloudKind) {
  const base = {
    potential_id: z.string().trim().min(1, "potential_id required").max(50),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
    customer_name: z.string().trim().min(1).max(200),
    lab_name: z.string().trim().min(1).max(200),
    line_of_business: z.string().trim().min(1),
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
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
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

export function BulkImport() {
  const [kind, setKind] = useState<CloudKind>("public_cloud");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<
    { done: number; total: number; succeeded: number; failed: number; isRetry: boolean } | null
  >(null);
  const [isRetryRun, setIsRetryRun] = useState(false);
  const [parentRunId, setParentRunId] = useState<string | null>(null);
  const [dupStrategy, setDupStrategy] = useState<DupStrategy>("skip");
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
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
  const checkUnique = useServerFn(checkPotentialIdUnique);
  const { user } = useAuth();
  const qc = useQueryClient();

  // Guard: block retry while a previous run for this user is still in-flight.
  const { data: lastRun } = useQuery({
    queryKey: ["bulk_import_runs", "latest", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("bulk_import_runs")
        .select("id,status")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    refetchInterval: submitting ? 2000 : false,
  });
  const lastRunInFlight = lastRun?.status === "pending";

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
        .select("id,name,kind,column_mapping,duplicate_strategy,update_fields")
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
    downloadFile(`${kind}-template.csv`, toCsv(headers, sample));
  }

  function reset() {
    setRows([]); setFileName(""); setProgress(null); setMapping(null);
    setIsRetryRun(false); setParentRunId(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("File exceeds 5MB"); return; }
    setFileName(f.name);
    const text = await f.text();
    const matrix = parseCsv(text);
    if (matrix.length === 0) { toast.error("Empty CSV"); return; }
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
    const seen = new Set<string>();
    const parsed: ParsedRow[] = body.map((cols, idx) => {
      const raw: Record<string, string> = {};
      for (const h of headers) raw[h] = (cols[colIdx[h]] ?? "").trim();
      const errors: string[] = [];
      const res = schema.safeParse(raw);
      if (!res.success) {
        for (const issue of res.error.issues) {
          errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
        }
      } else {
        const pid = res.data.potential_id;
        if (seen.has(pid)) errors.push(`duplicate potential_id in file: ${pid}`);
        seen.add(pid);
      }
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

    // Log invalid rows up-front
    const invalidRows = rows.filter((r) => r.errors.length > 0);
    if (invalidRows.length) {
      await supabase.from("bulk_import_row_audit").insert(
        invalidRows.map((r) => ({
          run_id: runId, user_id: user.id, filename: fileName,
          line_number: r.line, potential_id: r.raw.potential_id || null,
          status: "error", error_message: r.errors.join("; "), row_data: r.raw,
        })),
      );
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
        try {
          const uq = await checkUnique({ data: { potentialId: String(p.potential_id) } });
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
          if (!uq.unique) {
            if (dupStrategy === "skip") {
              updated[idx] = { ...r, errors: [`skipped: potential_id ${String(fullPayload.potential_id)} already exists`] };
              rowStatus = "skipped"; skipped++;
            } else if (dupStrategy === "update") {
              // Only overwrite the fields the user opted into; preserve the rest.
              const partial: Record<string, unknown> = {};
              for (const f of updateFields) if (f in fullPayload) partial[f] = fullPayload[f];
              if (kind === "private_cloud") partial.system_config = fullPayload.system_config;
              const { data: existing, error: updErr } = await supabase
                .from("transactions")
                .update(partial as never)
                .eq("potential_id", String(fullPayload.potential_id))
                .select("id").maybeSingle();
              if (updErr) { rowStatus = "error"; rowError = updErr.message; updated[idx] = { ...r, errors: [updErr.message] }; }
              else { rowStatus = "updated"; updatedCount++; txId = existing?.id ?? null; }
            } else { // link
              // Link = read-only association, no fields overwritten on the existing record.
              const { data: existing } = await supabase
                .from("transactions").select("id").eq("potential_id", String(fullPayload.potential_id)).maybeSingle();
              rowStatus = "linked"; linked++; txId = existing?.id ?? null;
              updated[idx] = { ...r, errors: [`linked to existing transaction ${String(fullPayload.potential_id)} (no fields changed)`] };
            }
          } else {
            const { data: ins, error } = await supabase.from("transactions").insert(fullPayload as never).select("id").single();
            if (error) { rowStatus = "error"; rowError = error.message; updated[idx] = { ...r, errors: [error.message] }; }
            else { imported++; txId = ins?.id ?? null; }
          }
        } catch (err) {
          rowStatus = "error"; rowError = (err as Error).message;
          updated[idx] = { ...r, errors: [rowError] };
        }
        await supabase.from("bulk_import_row_audit").insert({
          run_id: runId, user_id: user.id, filename: fileName,
          line_number: r.line, potential_id: String(p.potential_id),
          transaction_id: txId, status: rowStatus, error_message: rowError, row_data: r.raw,
        });
        setProgress((prev) => ({
          done: i + 1,
          total: valid.length,
          succeeded: (prev?.succeeded ?? 0) + (rowStatus !== "error" ? 1 : 0),
          failed: (prev?.failed ?? 0) + (rowStatus === "error" ? 1 : 0),
          isRetry: prev?.isRetry ?? isRetryRun,
        }));
      }
      await supabase.from("bulk_import_runs").update({
        imported_rows: imported, skipped_rows: skipped, updated_rows: updatedCount, linked_rows: linked,
        status: "completed", completed_at: new Date().toISOString(),
      }).eq("id", runId);
      setRows(updated);
      toast.success(`Done · ${imported} new · ${updatedCount} updated · ${linked} linked · ${skipped} skipped`);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["bulk_import_runs"] });
      qc.invalidateQueries({ queryKey: ["bulk_import_runs", "retry-stats", user?.id, kind] });
    } catch (e) {
      await supabase.from("bulk_import_runs").update({
        status: "failed", completed_at: new Date().toISOString(),
      }).eq("id", runId);
      toast.error(`Import failed: ${(e as Error).message}`);
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
          {dupStrategy === "skip" && (
            <div className="text-muted-foreground">Existing rows with the same potential_id are left unchanged. Incoming row is reported as skipped.</div>
          )}
          {dupStrategy === "link" && (
            <div className="text-muted-foreground">No fields are written. All existing fields are preserved as-is. The audit log records a link reference only.</div>
          )}
          {dupStrategy === "update" && (
            <div className="space-y-2">
              <div className="text-muted-foreground">Pick which fields overwrite the existing record. Unchecked fields are preserved.</div>
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
          <div>Dates use ISO format YYYY-MM-DD. potential_id must be unique within the file. Column order is flexible.</div>
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
                {rows.map((r) => (
                  <TableRow key={r.line} className={r.errors.length ? "bg-destructive/5" : ""}>
                    <TableCell className="text-muted-foreground">{r.line}</TableCell>
                    <TableCell>
                      {r.errors.length === 0
                        ? <Badge variant="outline" className="text-green-700 border-green-600/40">Valid</Badge>
                        : <Badge variant="destructive">Error</Badge>}
                    </TableCell>
                    {headers.map((h) => <TableCell key={h} className="max-w-[180px] truncate">{r.raw[h]}</TableCell>)}
                    <TableCell className="text-xs text-destructive">{r.errors.join("; ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
