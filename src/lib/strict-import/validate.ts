// SCRUM-103: strict validator. Pure function, same code runs in the browser
// (preview) and on the server (commit re-validation).
//
// Guarantees:
//  - one non-blank input row -> exactly one record (no matching, no merging, no deduping);
//  - fully blank rows are skipped and counted;
//  - no suggestions, no auto-correction, no defaults (blank never becomes 0);
//  - a value that cannot be stored becomes NULL and a warning (line, column, original value);
//  - nothing about a blank or unstorable cell blocks the import.
import { isBlankCell, isExcelDate, isIsoDate, type RawCell, type RawRow } from "./cells";
import { PROPOSED_RULES, columnLetter, normalizeHeader, type StrictColumn, type StrictField, type StrictRules } from "./template";

export interface HeaderError {
  column: string | null;
  header: string | null;
  message: string;
}

export interface RowIssue {
  line: number;
  column: string | null;
  header: string | null;
  value: string;
  message: string;
}

export interface StrictRecord {
  line: number;
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  line_of_business: string | null;
  start_date: string | null;
  end_date: string | null;
  total_users: number | null;
  /** Money in whole paise/cents to avoid float drift; null when blank/invalid. */
  input_cost_cents: number | null;
  selling_cost_cents: number | null;
  cloud_provider: string | null;
}

export interface StrictSummary {
  rowsInFile: number;
  blankRowsIgnored: number;
  rowsToImport: number;
  errorCount: number;
  warningCount: number;
  totalSellingCents: number;
  totalInputCents: number;
  distinctCustomers: number;
}

export interface StrictValidationResult {
  headerErrors: HeaderError[];
  rowErrors: RowIssue[];
  warnings: RowIssue[];
  records: StrictRecord[];
  summary: StrictSummary;
  /** True when nothing blocks the commit. Header notes are warnings and do not affect this. */
  ok: boolean;
}

type ColumnMap = Map<StrictField, number>;

/** Header notes. None of these block the import. Blank header cells are ignored with no note. */
export function matchHeaders(header: string[], rules: StrictRules = PROPOSED_RULES): { map: ColumnMap; warnings: RowIssue[] } {
  const warnings: RowIssue[] = [];
  const map: ColumnMap = new Map();
  const byNorm = new Map<string, StrictColumn>();
  for (const col of rules.columns) byNorm.set(normalizeHeader(col.header), col);
  const ignored = new Set(rules.ignoredHeaders.map(normalizeHeader));
  const seen = new Map<string, number>();

  header.forEach((raw, idx) => {
    const norm = normalizeHeader(raw ?? "");
    const letter = columnLetter(idx);
    if (norm === "") return;
    if (seen.has(norm)) {
      warnings.push({
        line: 1,
        column: letter,
        header: raw,
        value: raw.trim(),
        message: `Duplicate header "${raw.trim()}" (also in column ${columnLetter(seen.get(norm)!)}). The first occurrence is used.`,
      });
      return;
    }
    seen.set(norm, idx);
    const col = byNorm.get(norm);
    if (col) map.set(col.field, idx);
    else if (!ignored.has(norm)) {
      warnings.push({
        line: 1,
        column: letter,
        header: raw,
        value: raw.trim(),
        message: `Unknown column "${raw.trim()}" is ignored.`,
      });
    }
  });

  for (const col of rules.columns) {
    if (!map.has(col.field)) {
      warnings.push({
        line: 1,
        column: null,
        header: col.header,
        value: "",
        message: `Column "${col.header}" is missing. Those cells are stored blank.`,
      });
    }
  }
  return { map, warnings };
}

function display(v: RawCell): string {
  if (v === null) return "";
  if (isExcelDate(v)) return v.iso;
  return String(v);
}

const NUMBER_TEXT = /^-?[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^-?[0-9]+(\.[0-9]+)?$/;

/** Parses a numeric cell or strictly formatted numeric text. Returns null if not a number. */
export function parseStrictNumber(v: RawCell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!NUMBER_TEXT.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Money -> integer cents. Rejects more than 2 decimal places (beyond float noise). */
export function toCents(n: number): number | null {
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents;
}

export function validateStrict(header: string[], rows: RawRow[], opts?: { rules?: StrictRules; blankRowsIgnored?: number }): StrictValidationResult {
  const rules = opts?.rules ?? PROPOSED_RULES;
  const { map, warnings: headerWarnings } = matchHeaders(header, rules);
  const rowErrors: RowIssue[] = [];
  const warnings: RowIssue[] = [...headerWarnings];
  const headerErrors: HeaderError[] = [];
  const records: StrictRecord[] = [];
  let blankRows = opts?.blankRowsIgnored ?? 0;

  const colFor = (f: StrictField) => rules.columns.find((c) => c.field === f)!;

  for (const row of rows) {
    if (row.cells.every(isBlankCell)) {
      blankRows += 1;
      continue;
    }
    const rec: StrictRecord = {
      line: row.line,
      potential_id: null, month: null, year: null, customer_name: null, lab_name: null,
      line_of_business: null, start_date: null, end_date: null, total_users: null,
      input_cost_cents: null, selling_cost_cents: null, cloud_provider: null,
    };
    const warn = (col: StrictColumn, idx: number | undefined, value: RawCell, message: string) =>
      warnings.push({ line: row.line, column: idx === undefined ? null : columnLetter(idx), header: col.header, value: display(value), message });

    for (const col of rules.columns) {
      const idx = map.get(col.field);
      if (idx === undefined) continue; // column absent: the field stays NULL
      const value: RawCell = idx < row.cells.length ? row.cells[idx] : null;

      // Blank stays NULL. Never 0, never a default, never an error.
      if (isBlankCell(value)) continue;

      switch (col.type) {
        case "text": {
          if (typeof value === "boolean" || isExcelDate(value)) {
            warn(col, idx, value, "Expected text; stored blank");
            break;
          }
          const s = String(value).trim();
          (rec as unknown as Record<string, unknown>)[col.field] = s;
          break;
        }
        case "int": {
          const n = parseStrictNumber(value);
          if (n === null || !Number.isInteger(n)) {
            warn(col, idx, value, "Expected a whole number; stored blank");
            break;
          }
          if ((col.min !== undefined && n < col.min) || (col.max !== undefined && n > col.max)) {
            warn(col, idx, value, `Outside ${col.min ?? "-∞"}–${col.max ?? "∞"}; stored blank`);
            break;
          }
          (rec as unknown as Record<string, unknown>)[col.field] = n;
          break;
        }
        case "decimal": {
          const n = parseStrictNumber(value);
          if (n === null) {
            warn(col, idx, value, "Expected a number; stored blank");
            break;
          }
          if (col.min !== undefined && n < col.min) {
            warn(col, idx, value, `Must be ≥ ${col.min}; stored blank`);
            break;
          }
          const cents = toCents(n);
          if (cents === null) {
            warn(col, idx, value, "More than 2 decimal places; stored blank");
            break;
          }
          if (col.field === "input_cost") rec.input_cost_cents = cents;
          else if (col.field === "selling_cost") rec.selling_cost_cents = cents;
          break;
        }
        case "date": {
          let iso: string | null = null;
          if (isExcelDate(value)) iso = value.iso;
          else if (typeof value === "string" && isIsoDate(value.trim())) iso = value.trim();
          if (!iso) {
            warn(col, idx, value, "Not a real date (use an Excel date or YYYY-MM-DD); stored blank");
            break;
          }
          (rec as unknown as Record<string, unknown>)[col.field] = iso;
          break;
        }
        case "enum": {
          const s = typeof value === "string" ? value.trim() : display(value);
          const allowed = col.field === "cloud_provider" ? rules.allowedProviders : (col.allowed ?? []);
          if (!allowed.includes(s)) {
            warn(col, idx, value, `Not one of: ${allowed.join(", ")}; stored blank`);
            break;
          }
          (rec as unknown as Record<string, unknown>)[col.field] = s;
          break;
        }
      }
    }

    // Row-level notes. Neither one blocks the row or clears the stored values.
    if (rec.start_date && rec.end_date && rec.end_date < rec.start_date) {
      const c = colFor("end_date");
      warnings.push({
        line: row.line,
        column: map.has("end_date") ? columnLetter(map.get("end_date")!) : null,
        header: c.header,
        value: rec.end_date,
        message: "End Date is before Start Date. Both dates are kept.",
      });
    }
    if (rec.input_cost_cents !== null && rec.selling_cost_cents !== null && rec.input_cost_cents > rec.selling_cost_cents) {
      const c = colFor("input_cost");
      warnings.push({
        line: row.line,
        column: map.has("input_cost") ? columnLetter(map.get("input_cost")!) : null,
        header: c.header,
        value: (rec.input_cost_cents / 100).toFixed(2),
        message: "Input Cost is higher than Selling Cost. This is allowed and will be saved.",
      });
    }
    records.push(rec);
  }

  // Exact duplicate rows are allowed but flagged (they must be acknowledged).
  const seen = new Map<string, number>();
  for (const r of records) {
    const { line: _line, ...rest } = r;
    const key = JSON.stringify(rest);
    const first = seen.get(key);
    if (first !== undefined) {
      warnings.push({ line: r.line, column: null, header: null, value: "", message: `Exact duplicate of line ${first}` });
    } else seen.set(key, r.line);
  }

  const totalSellingCents = records.reduce((a, r) => a + (r.selling_cost_cents ?? 0), 0);
  const totalInputCents = records.reduce((a, r) => a + (r.input_cost_cents ?? 0), 0);
  const customers = new Set(records.map((r) => r.customer_name).filter((x): x is string => !!x));

  return {
    headerErrors,
    rowErrors,
    warnings,
    records,
    summary: {
      rowsInFile: records.length + blankRows,
      blankRowsIgnored: blankRows,
      rowsToImport: records.length,
      errorCount: rowErrors.length,
      warningCount: warnings.length,
      totalSellingCents,
      totalInputCents,
      distinctCustomers: customers.size,
    },
    ok: rowErrors.length === 0,
  };
}
