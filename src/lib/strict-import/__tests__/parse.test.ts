import { describe, it, expect } from "vitest";
import * as XLSXMod from "xlsx";
import { parseCsvRecords, parseCsvText, parseXlsxBuffer, type XlsxLike } from "../parse";
import { excelSerialToIso, isIsoDate } from "../cells";
import { validateStrict } from "../validate";
import { HEADER } from "./fixtures";

const XLSX = XLSXMod as unknown as XlsxLike & typeof XLSXMod;

describe("CSV (RFC 4180)", () => {
  it("handles quotes, embedded commas, escaped quotes, CRLF and BOM", () => {
    const text = '\uFEFFa,b,c\r\n"x, y","say ""hi""",3\r\n';
    expect(parseCsvRecords(text)).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["x, y", 'say "hi"', "3"] },
    ]);
  });
  it("reports the starting line of multi-line quoted records", () => {
    const recs = parseCsvRecords('h1,h2\n"line1\nline2",v\nz,w\n');
    expect(recs.map((r) => r.line)).toEqual([1, 2, 4]);
  });
  it("keeps rows whose first cell starts with #", () => {
    const s = parseCsvText("Potential ID,Month\n#PID-1,3\nPID-2,4\n");
    expect(s.rows.map((r) => r.cells[0])).toEqual(["#PID-1", "PID-2"]);
  });
  it("counts blank rows in the middle, ignores the final newline", () => {
    const s = parseCsvText("A,B\n1,2\n\n,\n3,4\n\n");
    expect(s.rows).toHaveLength(2);
    expect(s.blankRowsIgnored).toBe(2);
  });
  it("throws on an unclosed quote", () => {
    expect(() => parseCsvRecords('a,"b\n')).toThrow(/Unclosed quote/);
  });
});

describe("Excel dates", () => {
  it("converts serials with pure UTC arithmetic (no timezone shift)", () => {
    expect(excelSerialToIso(46023)).toBe("2026-01-01");
    expect(excelSerialToIso(46060)).toBe("2026-02-07");
    expect(excelSerialToIso(46205.75)).toBe("2026-07-02"); // time of day ignored
    expect(excelSerialToIso(46023 - 1462, true)).toBe("2026-01-01"); // 1904 date system
    expect(excelSerialToIso(59)).toBeNull(); // fictitious 1900 range
  });
  it("validates ISO calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("07/02/2026")).toBe(false);
  });
});

describe("xlsx parsing (synthetic workbook built in memory)", () => {
  function workbook(extraRows: unknown[][] = []) {
    const ws: Record<string, unknown> = {};
    const data: unknown[][] = [
      HEADER,
      ["PID-T-1", 3, 2026, "Acme Test Co", "Lab A", "VILT", { t: "n", v: 46082, z: "yyyy-mm-dd" }, { t: "n", v: 46112, z: "dd/mm/yyyy" }, 5, 100, 250, "AWS"],
      [null, null, null, null, null, null, null, null, null, null, null, null],
      ["#PID-T-2", 3, 2026, "Acme Test Co", "Lab A", "VILT", "2026-03-01", "2026-03-31", 5, 100, 250, "AWS"],
      ...extraRows,
    ];
    data.forEach((r, ri) =>
      r.forEach((v, ci) => {
        if (v === null) return;
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        ws[addr] = typeof v === "object" ? v : typeof v === "number" ? { t: "n", v } : { t: "s", v };
      }),
    );
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: HEADER.length - 1 } });
    const wb = XLSXMod.utils.book_new();
    XLSXMod.utils.book_append_sheet(wb, ws as XLSXMod.WorkSheet, "Data");
    return XLSXMod.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  }

  it("keeps spreadsheet line numbers, date cells as calendar dates, # rows, and counts blank rows", () => {
    const s = parseXlsxBuffer(workbook(), XLSX);
    expect(s.sheetName).toBe("Data");
    expect(s.header).toEqual(HEADER);
    expect(s.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(s.blankRowsIgnored).toBe(1);
    expect(s.rows[0].cells[6]).toEqual({ kind: "date", iso: "2026-03-01" });
    expect(s.rows[0].cells[7]).toEqual({ kind: "date", iso: "2026-03-31" });
    expect(s.rows[1].cells[0]).toBe("#PID-T-2");
    const v = validateStrict(s.header, s.rows, { blankRowsIgnored: s.blankRowsIgnored });
    expect(v.ok).toBe(true);
    expect(v.summary).toMatchObject({ rowsToImport: 2, blankRowsIgnored: 1, rowsInFile: 3, totalSellingCents: 50000 });
  });
});
