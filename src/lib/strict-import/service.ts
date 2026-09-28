// SCRUM-103: preview and commit logic for the strict importer, with every
// outside dependency passed in. The server functions in
// src/lib/strict-import.functions.ts are thin wrappers around these, so the
// rules are unit-tested without a database.
//
// The server never trusts the browser's preview: commit receives the exact
// file bytes again, checks they hash to the previewed SHA-256, and re-parses
// and re-validates them before calling the database function.
import { normalizeName } from "@/lib/customer-normalize";
import { parseStrictBytes, type XlsxLike } from "./parse";
import { validateStrict, type RowIssue, type StrictSummary } from "./validate";
import { STRICT_TEMPLATE_STATUS, STRICT_TEMPLATE_VERSION } from "./template";
import { sha256Hex } from "./hash";
import { buildRpcRows, commitBlockers, planCustomers, type CustomerPlan, type ExistingCustomer, type PriorImport, type RpcRow } from "./commit-plan";

export interface ImportRpcPayload {
  p_kind: "public_cloud";
  p_filename: string;
  p_file_sha256: string;
  p_template_version: string;
  p_rows: RpcRow[];
  p_customer_names: string[];
}

export interface ImportRpcResult {
  batch_id: string;
  inserted: number;
  total_selling: number | string;
  total_input: number | string;
}

export interface StrictImportDeps {
  hasImportRole: () => Promise<boolean>;
  findCustomers: (normalizedNames: string[]) => Promise<ExistingCustomer[]>;
  /** Earliest batch with this hash, or null when the file is new or the lookup failed. A failed lookup does not block. */
  priorImport: (sha256: string) => Promise<PriorImport | null>;
  callImport: (payload: ImportRpcPayload) => Promise<ImportRpcResult>;
  loadXlsx: () => Promise<XlsxLike>;
}

export interface StrictFileInput {
  filename: string;
  bytes: Uint8Array;
}

export interface PreviewResult {
  templateVersion: string;
  templateStatus: string;
  fileSha256: string;
  sheetName: string | null;
  summary: StrictSummary;
  rowErrors: RowIssue[];
  warnings: RowIssue[];
  customers: CustomerPlan;
  /** Set when this exact file was imported before. The user confirms with Import anyway. */
  priorImport: PriorImport | null;
  /** Reasons a commit would be refused even after Import anyway (file errors, empty file, too many rows). */
  blockers: string[];
}

export class StrictImportError extends Error {
  constructor(
    message: string,
    public readonly code: "disabled" | "forbidden" | "invalid_file" | "blocked" | "file_changed" | "db_error" | "reconcile",
    public readonly reasons: string[] = [],
  ) {
    super(message);
    this.name = "StrictImportError";
  }
}

async function guard(deps: StrictImportDeps) {
  if (!(await deps.hasImportRole())) throw new StrictImportError("Only Admin, Ops Lead or Ops User can import transactions.", "forbidden");
}

async function analyse(deps: StrictImportDeps, input: StrictFileInput) {
  const fileSha256 = await sha256Hex(input.bytes);
  let sheet;
  try {
    sheet = await parseStrictBytes(input.filename, input.bytes, deps.loadXlsx);
  } catch (e) {
    throw new StrictImportError((e as Error).message, "invalid_file");
  }
  const validation = validateStrict(sheet.header, sheet.rows, { blankRowsIgnored: sheet.blankRowsIgnored });
  const norms = [...new Set(validation.records.map((r) => r.customer_name).filter((n): n is string => !!n).map(normalizeName))];
  const existing = norms.length > 0 ? await deps.findCustomers(norms) : [];
  const customers = planCustomers(validation.records, existing);
  const priorImport = await deps.priorImport(fileSha256);
  return { fileSha256, sheet, validation, customers, priorImport };
}

export async function runPreview(deps: StrictImportDeps, input: StrictFileInput): Promise<PreviewResult> {
  await guard(deps);
  const { fileSha256, sheet, validation, customers, priorImport } = await analyse(deps, input);
  // Duplicate-file confirmation is separate from these blockers.
  const blockers = commitBlockers(validation, { priorImport, importAnyway: true });
  return {
    templateVersion: STRICT_TEMPLATE_VERSION,
    templateStatus: STRICT_TEMPLATE_STATUS,
    fileSha256,
    sheetName: sheet.sheetName ?? null,
    summary: validation.summary,
    rowErrors: validation.rowErrors,
    warnings: validation.warnings,
    customers,
    priorImport,
    blockers,
  };
}

export interface CommitInput extends StrictFileInput {
  expectedSha256: string;
  /** Required when this file hash was imported before. */
  importAnyway: boolean;
}

export interface CommitResult {
  batchId: string;
  inserted: number;
  totalSellingCents: number;
  totalInputCents: number;
  templateVersion: string;
  templateStatus: string;
}

function toCentsExact(v: number | string): number {
  const s = String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Unexpected amount from database: ${s}`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -cents : cents;
}

export async function runCommit(deps: StrictImportDeps, input: CommitInput): Promise<CommitResult> {
  await guard(deps);
  const { fileSha256, validation, customers, priorImport } = await analyse(deps, input);
  if (fileSha256 !== input.expectedSha256) {
    throw new StrictImportError("The file is not the one you previewed. Run preview again.", "file_changed");
  }
  const reasons = commitBlockers(validation, { priorImport, importAnyway: input.importAnyway });
  if (reasons.length > 0) throw new StrictImportError("Import refused", "blocked", reasons);

  const payload: ImportRpcPayload = {
    p_kind: "public_cloud",
    p_filename: input.filename.slice(0, 255),
    p_file_sha256: fileSha256,
    p_template_version: STRICT_TEMPLATE_VERSION,
    p_rows: buildRpcRows(validation.records),
    p_customer_names: customers.newCustomers,
  };
  let res: ImportRpcResult;
  try {
    res = await deps.callImport(payload);
  } catch (e) {
    // The database function is all-or-nothing: on any error nothing was written.
    throw new StrictImportError(`Import failed, nothing was saved: ${(e as Error).message}`, "db_error");
  }
  const result: CommitResult = {
    batchId: res.batch_id,
    inserted: res.inserted,
    totalSellingCents: toCentsExact(res.total_selling),
    totalInputCents: toCentsExact(res.total_input),
    templateVersion: STRICT_TEMPLATE_VERSION,
    templateStatus: STRICT_TEMPLATE_STATUS,
  };
  const s = validation.summary;
  if (result.inserted !== s.rowsToImport || result.totalSellingCents !== s.totalSellingCents || result.totalInputCents !== s.totalInputCents) {
    // Should be impossible (the database reconciles before committing). Surface loudly if it ever happens.
    throw new StrictImportError(
      `Reconciliation mismatch after commit (batch ${result.batchId}): expected ${s.rowsToImport} rows, got ${result.inserted}. Contact engineering.`,
      "reconcile",
    );
  }
  return result;
}
