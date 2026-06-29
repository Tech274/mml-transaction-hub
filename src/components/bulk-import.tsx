import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { findOrCreateCustomer, checkPotentialIdUnique } from "@/lib/transactions.functions";
import { useAuth } from "@/lib/auth-context";
import { useQueryClient } from "@tanstack/react-query";

type CloudKind = "public_cloud" | "private_cloud";

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
}

export function BulkImport() {
  const [kind, setKind] = useState<CloudKind>("public_cloud");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const findOrCreate = useServerFn(findOrCreateCustomer);
  const checkUnique = useServerFn(checkPotentialIdUnique);
  const { user } = useAuth();
  const qc = useQueryClient();

  const headers = kind === "public_cloud" ? PUBLIC_HEADERS : PRIVATE_HEADERS;
  const sample = kind === "public_cloud" ? PUBLIC_SAMPLE : PRIVATE_SAMPLE;
  const schema = useMemo(() => buildRowSchema(kind), [kind]);

  function downloadTemplate() {
    downloadFile(`${kind}-template.csv`, toCsv(headers, sample));
  }

  function reset() {
    setRows([]); setFileName(""); setProgress(null);
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
    const missing = headers.filter((h) => !hdr.includes(h));
    if (missing.length) {
      toast.error(`Missing columns: ${missing.join(", ")}`);
      return;
    }
    const seen = new Set<string>();
    const parsed: ParsedRow[] = body.map((cols, idx) => {
      const raw: Record<string, string> = {};
      hdr.forEach((h, i) => { raw[h] = (cols[i] ?? "").trim(); });
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

  async function importValid() {
    const valid = rows.filter((r) => r.errors.length === 0 && r.parsed);
    if (!valid.length) { toast.error("No valid rows to import"); return; }
    if (!user) { toast.error("Not authenticated"); return; }
    setSubmitting(true);
    setProgress({ done: 0, total: valid.length });
    const updated = [...rows];
    let imported = 0;
    try {
      for (let i = 0; i < valid.length; i++) {
        const r = valid[i];
        const idx = updated.findIndex((x) => x.line === r.line);
        const p = r.parsed as Record<string, unknown>;
        try {
          const uq = await checkUnique({ data: { potentialId: String(p.potential_id) } });
          if (!uq.unique) { updated[idx] = { ...r, errors: ["potential_id already exists in system"] }; continue; }
          const cust = await findOrCreate({ data: { customerName: String(p.customer_name) } });
          const insert = {
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
          };
          const { error } = await supabase.from("transactions").insert(insert);
          if (error) { updated[idx] = { ...r, errors: [error.message] }; continue; }
          imported++;
        } catch (err) {
          updated[idx] = { ...r, errors: [(err as Error).message] };
        }
        setProgress({ done: i + 1, total: valid.length });
      }
      setRows(updated);
      toast.success(`Imported ${imported} / ${valid.length} rows`);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
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
          New customers are created automatically.
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

        <div className="flex flex-wrap items-center gap-3">
          <Input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="max-w-sm" />
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
          {rows.length > 0 && (
            <>
              <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3 text-green-600" />{validCount} valid</Badge>
              <Badge variant="outline" className="gap-1"><AlertTriangle className="h-3 w-3 text-amber-600" />{errorCount} errors</Badge>
              <Button size="sm" variant="ghost" onClick={reset}><X className="h-4 w-4 mr-1" />Clear</Button>
              <div className="ml-auto">
                <Button size="sm" disabled={submitting || validCount === 0} onClick={importValid}>
                  <Upload className="h-4 w-4 mr-1" />
                  {submitting && progress
                    ? `Importing ${progress.done}/${progress.total}…`
                    : `Import ${validCount} valid row${validCount === 1 ? "" : "s"}`}
                </Button>
              </div>
            </>
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
          <div>Dates use ISO format YYYY-MM-DD. potential_id must be unique across the system.</div>
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