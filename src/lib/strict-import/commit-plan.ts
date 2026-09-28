// SCRUM-103: turns a validated file into the exact payload for the database
// function import_transactions_batch(), and decides whether a commit may run.
// Pure functions: the server re-runs them on every commit, the UI uses them to
// explain what will happen. Nothing here talks to the database.
import { normalizeName } from "@/lib/customer-normalize";
import type { StrictRecord, StrictValidationResult } from "./validate";

export const MAX_ROWS_PER_BATCH = 5000; // mirrors the limit inside import_transactions_batch()

export interface ExistingCustomer {
  customer_name: string;
  normalized_name: string;
}

export interface CustomerPlan {
  /** Customers that do not exist yet. They are created only if the user approves each one. */
  newCustomers: string[];
  /** File spelling differs from the existing customer it will be linked to (case/spacing). */
  matchedWithDifferentSpelling: { fileName: string; existingName: string; lines: number[] }[];
  /** Several spellings in the same file that normalise to one customer. */
  inFileVariants: { normalized: string; spellings: string[]; lines: number[] }[];
}

export function planCustomers(records: StrictRecord[], existing: ExistingCustomer[]): CustomerPlan {
  const existingByNorm = new Map(existing.map((c) => [c.normalized_name, c.customer_name]));
  const byNorm = new Map<string, { spellings: Map<string, number[]> }>();
  for (const r of records) {
    if (!r.customer_name) continue;
    const norm = normalizeName(r.customer_name);
    const entry = byNorm.get(norm) ?? { spellings: new Map<string, number[]>() };
    const lines = entry.spellings.get(r.customer_name) ?? [];
    lines.push(r.line);
    entry.spellings.set(r.customer_name, lines);
    byNorm.set(norm, entry);
  }
  const plan: CustomerPlan = { newCustomers: [], matchedWithDifferentSpelling: [], inFileVariants: [] };
  for (const [norm, { spellings }] of byNorm) {
    const names = [...spellings.keys()];
    if (names.length > 1) {
      plan.inFileVariants.push({
        normalized: norm,
        spellings: names,
        lines: [...spellings.values()].flat().sort((a, b) => a - b),
      });
    }
    const existingName = existingByNorm.get(norm);
    if (existingName === undefined) {
      // First spelling seen becomes the customer name (exactly as typed).
      plan.newCustomers.push(names[0]);
    } else {
      for (const n of names) {
        if (n !== existingName) {
          plan.matchedWithDifferentSpelling.push({ fileName: n, existingName, lines: spellings.get(n)! });
        }
      }
    }
  }
  plan.newCustomers.sort((a, b) => a.localeCompare(b));
  return plan;
}

/** Integer cents -> exact decimal string ("123456" -> "1234.56"). No floating point. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid money amount: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export interface RpcRow {
  source_line: number;
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
  input_cost: string | null;
  selling_cost: string | null;
  cloud_provider: string | null;
}

/** One validated record -> exactly one row. Blank and unstorable cells are JSON null, never 0. */
export function buildRpcRows(records: StrictRecord[]): RpcRow[] {
  return records.map((r) => ({
    source_line: r.line,
    potential_id: r.potential_id,
    month: r.month,
    year: r.year,
    customer_name: r.customer_name,
    lab_name: r.lab_name,
    line_of_business: r.line_of_business,
    start_date: r.start_date,
    end_date: r.end_date,
    total_users: r.total_users,
    input_cost: r.input_cost_cents === null ? null : centsToDecimalString(r.input_cost_cents),
    selling_cost: r.selling_cost_cents === null ? null : centsToDecimalString(r.selling_cost_cents),
    cloud_provider: r.cloud_provider,
  }));
}

export interface CommitDecision {
  warningsAcknowledged: boolean;
  approvedNewCustomers: string[];
}

/** Every reason the commit must not run. Empty list = allowed. */
export function commitBlockers(
  validation: StrictValidationResult,
  plan: CustomerPlan,
  decision: CommitDecision,
  opts: { alreadyImported: boolean | null },
): string[] {
  const reasons: string[] = [];
  if (!validation.ok) reasons.push(`The file has ${validation.summary.errorCount} error(s). Fix them and upload again.`);
  if (validation.summary.rowsToImport === 0) reasons.push("The file has no rows to import.");
  if (validation.summary.rowsToImport > MAX_ROWS_PER_BATCH) {
    reasons.push(`Too many rows in one file (${validation.summary.rowsToImport} > ${MAX_ROWS_PER_BATCH}). Split the file.`);
  }
  if (opts.alreadyImported === null) reasons.push("Could not check whether this file was already imported (import tables not available).");
  if (opts.alreadyImported === true) reasons.push("This exact file was already imported. Re-uploads are not allowed (append-only).");
  // Cell warnings (blank, unstorable, selling below cost) are informational and do not block.
  const needsAck = plan.inFileVariants.length > 0 || plan.matchedWithDifferentSpelling.length > 0;
  if (needsAck && !decision.warningsAcknowledged) reasons.push("Customer name variants must be acknowledged.");
  const want = new Set(plan.newCustomers);
  const got = new Set(decision.approvedNewCustomers);
  const missing = [...want].filter((n) => !got.has(n));
  const extra = [...got].filter((n) => !want.has(n));
  if (missing.length > 0) reasons.push(`Approve each new customer before importing: ${missing.join(", ")}`);
  if (extra.length > 0) reasons.push(`These approved customers are not new in this file (run preview again): ${extra.join(", ")}`);
  return reasons;
}
