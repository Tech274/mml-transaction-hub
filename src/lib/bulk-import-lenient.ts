// SCRUM-103 (28 Sep): the bulk-import rules users hit on the legacy Bulk Import
// tab, shared by the browser preview and validateBulkImportRows.
//
// Nothing here rejects a row. A blank cell is NULL (never 0). A value that
// cannot be stored (text in a number or date, a provider or line of business
// outside the allowed list, a negative cost) is NULL plus a warning. The
// original text is kept on the warning so it can be fixed by editing.

import { LINE_OF_BUSINESS_OPTIONS } from "@/lib/bulk-template";

export type BulkKind = "public_cloud" | "private_cloud";

export const PUBLIC_PROVIDERS = ["AWS", "Azure", "GCP"] as const;
export const SYSTEM_CONFIG_OPTIONS = [
  "8GB 2vCPUs",
  "8GB 4vCPUs",
  "12GB 4vCPUs",
  "16GB 4vCPUs",
  "24GB 6vCPUs",
  "32GB 8vCPUs",
] as const;

const MAX_AMOUNT = 1_000_000_000;
const NUMBER_TEXT = /^-?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^-?[0-9]+(\.[0-9]+)?$/;

export interface LenientValues {
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
  input_cost: number | null;
  selling_cost: number | null;
  cloud_provider: string | null;
  system_config: string | null;
}

export interface CellNote {
  line: number;
  column: string;
  value: string;
  message: string;
}

export interface LenientRowResult {
  /** Null when the row is fully blank and must be skipped. */
  values: LenientValues | null;
  warnings: CellNote[];
  /** Non-blocking notes (for example selling below cost). Never a reason to skip the row. */
  notes: CellNote[];
  blank: boolean;
}

export function emptyValues(): LenientValues {
  return {
    potential_id: null,
    month: null,
    year: null,
    customer_name: null,
    lab_name: null,
    line_of_business: null,
    start_date: null,
    end_date: null,
    total_users: null,
    input_cost: null,
    selling_cost: null,
    cloud_provider: null,
    system_config: null,
  };
}

function cell(raw: Record<string, string>, key: string): string {
  const v = raw[key];
  return v == null ? "" : String(v).trim();
}

function isRealIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole number in range, or null. `bad` is true when the cell had text that cannot be stored. */
function parseIntInRange(raw: string, min: number, max: number): { value: number | null; bad: boolean } {
  if (raw === "") return { value: null, bad: false };
  if (!/^-?[0-9]+$/.test(raw)) return { value: null, bad: true };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { value: null, bad: true };
  return { value: n, bad: false };
}

/** Non-negative money with at most 2 decimal places, or null. Never returns 0 for a blank. */
function parseMoney(raw: string): { value: number | null; bad: boolean } {
  if (raw === "") return { value: null, bad: false };
  if (!NUMBER_TEXT.test(raw)) return { value: null, bad: true };
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return { value: null, bad: true };
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return { value: null, bad: true };
  return { value: cents / 100, bad: false };
}

function warn(out: CellNote[], line: number, column: string, value: string, message: string) {
  out.push({ line, column, value, message });
}

/**
 * One spreadsheet row -> one record, or a skip when every template field is blank.
 * Repeated Potential IDs are kept as separate records. Nothing is merged.
 */
export function parseLenientBulkRow(
  raw: Record<string, string>,
  kind: BulkKind,
  line: number,
): LenientRowResult {
  const warnings: CellNote[] = [];
  const notes: CellNote[] = [];
  const keys = [
    "potential_id", "month", "year", "customer_name", "lab_name", "line_of_business",
    "start_date", "end_date", "total_users", "input_cost", "selling_cost",
    kind === "public_cloud" ? "cloud_provider" : "system_config",
  ];
  if (keys.every((k) => cell(raw, k) === "")) {
    return { values: null, warnings, notes, blank: true };
  }

  const values = emptyValues();
  const text = (column: "potential_id" | "customer_name" | "lab_name") => {
    const v = cell(raw, column);
    values[column] = v === "" ? null : v;
  };
  text("potential_id");
  text("customer_name");
  text("lab_name");

  const month = parseIntInRange(cell(raw, "month"), 1, 12);
  if (month.bad) warn(warnings, line, "month", cell(raw, "month"), "Not a month 1–12; stored blank");
  values.month = month.value;

  const year = parseIntInRange(cell(raw, "year"), 2000, 2100);
  if (year.bad) warn(warnings, line, "year", cell(raw, "year"), "Not a year 2000–2100; stored blank");
  values.year = year.value;

  const users = parseIntInRange(cell(raw, "total_users"), 1, 1_000_000_000);
  if (users.bad) warn(warnings, line, "total_users", cell(raw, "total_users"), "Not a whole number above 0; stored blank");
  values.total_users = users.value;

  const lob = cell(raw, "line_of_business");
  if (lob === "") values.line_of_business = null;
  else if ((LINE_OF_BUSINESS_OPTIONS as readonly string[]).includes(lob)) values.line_of_business = lob;
  else {
    values.line_of_business = null;
    warn(warnings, line, "line_of_business", lob, `Not one of ${LINE_OF_BUSINESS_OPTIONS.join(", ")}; stored blank`);
  }

  for (const column of ["start_date", "end_date"] as const) {
    const v = cell(raw, column);
    if (v === "") values[column] = null;
    else if (isRealIso(v)) values[column] = v;
    else {
      values[column] = null;
      warn(warnings, line, column, v, "Not a real YYYY-MM-DD date; stored blank");
    }
  }
  if (values.start_date && values.end_date && values.end_date < values.start_date) {
    notes.push({
      line,
      column: "end_date",
      value: values.end_date,
      message: "End date is before start date. Both dates are kept; fix them by editing if you want.",
    });
  }

  const input = parseMoney(cell(raw, "input_cost"));
  if (input.bad) warn(warnings, line, "input_cost", cell(raw, "input_cost"), "Not a number that can be stored; stored blank");
  values.input_cost = input.value;

  const selling = parseMoney(cell(raw, "selling_cost"));
  if (selling.bad) warn(warnings, line, "selling_cost", cell(raw, "selling_cost"), "Not a number that can be stored; stored blank");
  values.selling_cost = selling.value;

  if (values.input_cost != null && values.selling_cost != null && values.input_cost > values.selling_cost) {
    notes.push({
      line,
      column: "input_cost",
      value: String(values.input_cost),
      message: "Input cost is higher than selling cost. This is allowed and will be saved.",
    });
  }

  if (kind === "public_cloud") {
    const provider = cell(raw, "cloud_provider");
    if (provider === "") values.cloud_provider = null;
    else if ((PUBLIC_PROVIDERS as readonly string[]).includes(provider)) values.cloud_provider = provider;
    else {
      values.cloud_provider = null;
      warn(warnings, line, "cloud_provider", provider, `Not one of ${PUBLIC_PROVIDERS.join(", ")}; stored blank`);
    }
  } else {
    const config = cell(raw, "system_config");
    if (config === "") values.system_config = null;
    else if ((SYSTEM_CONFIG_OPTIONS as readonly string[]).includes(config)) values.system_config = config;
    else {
      values.system_config = null;
      warn(warnings, line, "system_config", config, "Not one of the listed system configs; stored blank");
    }
  }

  return { values, warnings, notes, blank: false };
}

export interface LenientBatch {
  rows: Array<{ line: number; values: LenientValues | null; warnings: CellNote[]; notes: CellNote[]; blank: boolean }>;
  blankRowsIgnored: number;
  rowsToImport: number;
}

/** N non-blank input rows -> N records. Fully blank rows are counted and omitted from the import. */
export function parseLenientBulkRows(
  rows: Record<string, string>[],
  kind: BulkKind,
  lines?: number[],
): LenientBatch {
  const out: LenientBatch["rows"] = [];
  let blankRowsIgnored = 0;
  rows.forEach((raw, i) => {
    const line = lines?.[i] ?? i + 2;
    const parsed = parseLenientBulkRow(raw, kind, line);
    if (parsed.blank) {
      blankRowsIgnored += 1;
      out.push({ line, values: null, warnings: [], notes: [], blank: true });
      return;
    }
    out.push({ line, values: parsed.values, warnings: parsed.warnings, notes: parsed.notes, blank: false });
  });
  return {
    rows: out,
    blankRowsIgnored,
    rowsToImport: out.filter((r) => !r.blank).length,
  };
}
