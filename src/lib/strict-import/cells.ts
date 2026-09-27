// SCRUM-103: cell values handed from the parser to the validator.
// Deterministic only: no guessing, no locale parsing, no Date objects in local time.

/** A real Excel date cell, already converted to a calendar date (UTC, YYYY-MM-DD). */
export interface ExcelDate {
  kind: "date";
  iso: string;
}

export type RawCell = string | number | boolean | ExcelDate | null;

export interface RawRow {
  /** Spreadsheet row number (header is row 1 in a normal sheet). */
  line: number;
  cells: RawCell[];
}

export interface ParsedSheet {
  header: string[];
  rows: RawRow[];
  /** Fully blank rows are skipped but counted, never silently dropped. */
  blankRowsIgnored: number;
  sheetName?: string;
}

export function isExcelDate(v: unknown): v is ExcelDate {
  return typeof v === "object" && v !== null && (v as ExcelDate).kind === "date" && typeof (v as ExcelDate).iso === "string";
}

export function isBlankCell(v: RawCell): boolean {
  return v === null || (typeof v === "string" && v.trim() === "");
}

const MS_PER_DAY = 86_400_000;
const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);

/**
 * Excel serial date -> YYYY-MM-DD using pure UTC arithmetic (timezone-independent).
 * Serials below 61 fall in Excel's fictitious 1900-02-29 range and are rejected (null).
 * A time-of-day fraction is ignored (the calendar day is kept).
 */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null;
  let days = Math.floor(serial);
  if (date1904) days += 1462;
  else if (days < 61) return null;
  const d = new Date(EXCEL_EPOCH_1900 + days * MS_PER_DAY);
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 9999) return null;
  return d.toISOString().slice(0, 10);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
