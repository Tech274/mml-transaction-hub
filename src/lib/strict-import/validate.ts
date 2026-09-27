// SCRUM-103: strict validator. Pure function, same code runs in the browser
// (preview) and on the server (commit re-validation).
//
// Guarantees:
//  - one input row -> exactly one record (no matching, no merging, no dropping);
//  - no suggestions, no auto-correction, no defaults (blank never becomes 0);
//  - every problem is reported as line + column letter + header + value + message.
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
  /** True only when there are no header errors and no row errors. Warnings still need acknowledgement. */
  ok: boolean;
}

type ColumnMap = Map<StrictField, number>;

export function matchHeaders(header: string[], rules: StrictRules = PROPOSED_RULES): { map: ColumnMap; errors: HeaderError[] } {
  const errors: HeaderError[] = [];
  const map: ColumnMap = new Map();
  const byNorm = new Map<string, StrictColumn>();
  for (const col of rules.columns) byNorm.set(normalizeHeader(col.header), col);
  const ignored = new Set(rules.ignoredHeaders.map(normalizeHeader));
  const seen = new Map<string, number>();

  header.forEach((raw, idx) => {
    const norm = normalizeHeader(raw ?? "");
    const letter = columnLetter(idx);
    if (norm === "") {
      errors.push({ column: letter, header: raw ?? "", message: `Column ${letter} has no header` });
      return;
    }
    if (seen.has(norm)) {
      errors.push({ column: letter, header: raw, message: `Duplicate header "${raw.trim()}" (also in column ${columnLetter(seen.get(norm)!)})` });
      return;
    }
    seen.set(norm, idx);
    const col = byNorm.get(norm);
    if (col) map.set(col.field, idx);
    else if (!ignored.has(norm)) {
      errors.push({ column: letter, header: raw, message: `Unknown column "${raw.trim()}". It is not in the template.` });
    }
  });

  for (const col of rules.columns) {
    if (!map.has(col.field)) errors.push({ column: null, header: col.header, message: `Missing column "${col.header}"` });
  }
  return { map, errors };
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
  const { map, errors: headerErrors } = matchHeaders(header, rules);
  const rowErrors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
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
    const err = (col: StrictColumn, idx: number | undefined, value: RawCell, message: string) =>
      rowErrors.push({ line: row.line, column: idx === undefined ? null : columnLetter(idx), header: col.header, value: display(value), message });

    for (const col of rules.columns) {
      const idx = map.get(col.field);
      if (idx === undefined) continue; // reported as a header error
      const value: RawCell = idx < row.cells.length ? row.cells[idx] : null;

      if (isBlankCell(value)) {
        const isCost = col.field === "input_cost" || col.field === "selling_cost";
        if (isCost && rules.blankCost === "null") continue;
        if (col.required) err(col, idx, value, "Required value is blank");
        continue;
      }

      switch (col.type) {
        case "text": {
          if (typeof value === "boolean" || isExcelDate(value)) {
            err(col, idx, value, "Expected text");
            break;
          }
          const s = String(value).trim();
          (rec as unknown as Record<string, unknown>)[col.field] = s;
          break;
        }
        case "int": {
          const n = parseStrictNumber(value);
          if (n === null || !Number.isInteger(n)) {
            err(col, idx, value, "Expected a whole number");
            break;
          }
          if ((col.min !== undefined && n < col.min) || (col.max !== undefined && n > col.max)) {
            err(col, idx, value, `Must be between ${col.min ?? "-∞"} and ${col.max ?? "∞"}`);
            break;
          }
          (rec as unknown as Record<string, unknown>)[col.field] = n;
          break;
        }
        case "decimal": {
          const n = parseStrictNumber(value);
          if (n === null) {
            err(col, idx, value, "Expected a number (digits, optional thousands commas, optional decimals)");
            break;
          }
          if (col.min !== undefined && n < col.min) {
            err(col, idx, value, `Must be ≥ ${col.min}`);
            break;
          }
          const cents = toCents(n);
          if (cents === null) {
            err(col, idx, value, "More than 2 decimal places");
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
            err(col, idx, value, "Use a real Excel date cell or YYYY-MM-DD text (e.g. 07/02/2026 is ambiguous and not accepted)");
            break;
          }
          (rec as unknown as Record<string, unknown>)[col.field] = iso;
          break;
        }
        case "enum": {
          const s = typeof value === "string" ? value.trim() : display(value);
          const allowed = col.field === "cloud_provider" ? rules.allowedProviders : (col.allowed ?? []);
          if (!allowed.includes(s)) {
            err(col, idx, value, `Must be exactly one of: ${allowed.join(", ")}`);
            break;
          }
          (rec as unknown as Record<string, unknown>)[col.field] = s;
          break;
        }
      }
    }

    // Row-level rules
    if (rec.start_date && rec.end_date && rec.end_date < rec.start_date) {
      const c = colFor("end_date");
      err(c, map.get("end_date"), rec.end_date, "End Date is before Start Date");
    }
    if (rec.input_cost_cents !== null && rec.selling_cost_cents !== null && rec.input_cost_cents > rec.selling_cost_cents) {
      const c = colFor("input_cost");
      const issue: RowIssue = {
        line: row.line,
        column: map.has("input_cost") ? columnLetter(map.get("input_cost")!) : null,
        header: c.header,
        value: (rec.input_cost_cents / 100).toFixed(2),
        message: "Input Cost is higher than Selling Cost",
      };
      if (rules.inputAboveSelling === "error") rowErrors.push(issue);
      else warnings.push(issue);
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
      errorCount: headerErrors.length + rowErrors.length,
      warningCount: warnings.length,
      totalSellingCents,
      totalInputCents,
      distinctCustomers: customers.size,
    },
    ok: headerErrors.length === 0 && rowErrors.length === 0,
  };
}
