// SCRUM-103: strict file parsing. CSV (RFC 4180) and .xlsx (first sheet, or "Data").
// Keeps every non-blank row (including rows whose first cell starts with "#").
// Only fully blank rows are skipped, and they are counted.
import { excelSerialToIso, isBlankCell, type ParsedSheet, type RawCell, type RawRow } from "./cells";

/** Minimal RFC 4180 parser. Returns records with the physical line number where each record starts. */
export function parseCsvRecords(text: string): { line: number; cells: string[] }[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;
  let i = 0;
  const endRecord = () => {
    cells.push(field);
    out.push({ line: recordLine, cells });
    cells = [];
    field = "";
    fieldStarted = false;
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && !fieldStarted && field === "") {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      cells.push(field);
      field = "";
      fieldStarted = false;
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      i += 1;
      line += 1;
      recordLine = line;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i += 1;
  }
  if (inQuotes) throw new Error(`Unclosed quote starting in record at line ${recordLine}`);
  // Last record (no trailing newline) unless the file ended exactly on a newline.
  if (field !== "" || cells.length > 0 || fieldStarted) endRecord();
  return out;
}

function splitHeaderAndRows(records: { line: number; cells: RawCell[] }[]): ParsedSheet {
  let blank = 0;
  let headerIdx = -1;
  for (let k = 0; k < records.length; k++) {
    if (records[k].cells.every(isBlankCell)) continue;
    headerIdx = k;
    break;
  }
  if (headerIdx === -1) return { header: [], rows: [], blankRowsIgnored: 0 };
  const header = records[headerIdx].cells.map((c) => (c === null ? "" : String(c)));
  const rows: RawRow[] = [];
  for (let k = headerIdx + 1; k < records.length; k++) {
    const r = records[k];
    if (r.cells.every(isBlankCell)) {
      blank += 1;
      continue;
    }
    rows.push({ line: r.line, cells: r.cells });
  }
  // Trailing blank lines at the very end of a CSV are an artefact of the final newline, not rows.
  return { header, rows, blankRowsIgnored: blank };
}

export function parseCsvText(text: string): ParsedSheet {
  const records = parseCsvRecords(text);
  // Drop trailing fully-blank records (end-of-file newlines) before counting.
  while (records.length > 0 && records[records.length - 1].cells.every((c) => c.trim() === "")) records.pop();
  return splitHeaderAndRows(records.map((r) => ({ line: r.line, cells: r.cells as RawCell[] })));
}

/** Subset of the SheetJS API we use (keeps this module testable and typed). */
export interface XlsxLike {
  read: (data: ArrayBuffer | Uint8Array, opts: Record<string, unknown>) => {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown>>;
    Workbook?: { WBProps?: { date1904?: boolean } };
  };
  utils: {
    decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell: (a: { r: number; c: number }) => string;
  };
  SSF: { is_date: (fmt: string) => boolean };
}

interface XlsxCell {
  t?: string;
  v?: unknown;
  z?: string;
  w?: string;
}

export function parseXlsxBuffer(data: ArrayBuffer | Uint8Array, XLSX: XlsxLike): ParsedSheet {
  const wb = XLSX.read(data, { type: "array", cellDates: false, cellNF: true, cellText: true, dense: false });
  const sheetName = wb.SheetNames.includes("Data") ? "Data" : wb.SheetNames[0];
  if (!sheetName) return { header: [], rows: [], blankRowsIgnored: 0 };
  const ws = wb.Sheets[sheetName] as Record<string, unknown>;
  const ref = ws["!ref"] as string | undefined;
  if (!ref) return { header: [], rows: [], blankRowsIgnored: 0, sheetName };
  const date1904 = !!wb.Workbook?.WBProps?.date1904;
  const range = XLSX.utils.decode_range(ref);
  const records: { line: number; cells: RawCell[] }[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells: RawCell[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XlsxCell | undefined;
      cells.push(toRawCell(cell, date1904, XLSX));
    }
    records.push({ line: r + 1, cells });
  }
  return { ...splitHeaderAndRows(records), sheetName };
}

function toRawCell(cell: XlsxCell | undefined, date1904: boolean, XLSX: XlsxLike): RawCell {
  if (!cell || cell.v === undefined || cell.v === null) return null;
  switch (cell.t) {
    case "n": {
      const v = Number(cell.v);
      if (cell.z && XLSX.SSF.is_date(cell.z)) {
        const iso = excelSerialToIso(v, date1904);
        return iso ? { kind: "date", iso } : `#INVALID_DATE(${v})`;
      }
      return v;
    }
    case "s":
    case "str":
      return String(cell.v);
    case "b":
      return Boolean(cell.v);
    case "e":
      // Excel error cell (#N/A, #REF!, ...) is kept as text so the validator reports it.
      return cell.w ?? "#ERROR";
    case "z":
      return null;
    default:
      return cell.w ?? String(cell.v);
  }
}

/** Browser entry point: picks the parser by file extension. */
export async function parseStrictFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsvText(await file.text());
  if (name.endsWith(".xlsx")) {
    const XLSX = (await import("xlsx")) as unknown as XlsxLike;
    return parseXlsxBuffer(new Uint8Array(await file.arrayBuffer()), XLSX);
  }
  throw new Error("Only .xlsx and .csv files are accepted");
}
