// Synthetic fixtures only. No real customers, IDs or amounts.
import type { RawCell, RawRow } from "../cells";

export const HEADER = [
  "Potential ID", "Month", "Year", "Customer Name", "Lab Name", "Line of Business",
  "Start Date", "End Date", "Total Users", "Input Cost", "Selling Cost", "Cloud Provider",
];

export function row(line: number, overrides: Partial<Record<string, RawCell>> = {}): RawRow {
  const base: Record<string, RawCell> = {
    "Potential ID": "PID-TEST-001",
    Month: 3,
    Year: 2026,
    "Customer Name": "Acme Test Co",
    "Lab Name": "Synthetic Lab A",
    "Line of Business": "VILT",
    "Start Date": { kind: "date", iso: "2026-03-01" },
    "End Date": { kind: "date", iso: "2026-03-31" },
    "Total Users": 10,
    "Input Cost": 1000,
    "Selling Cost": 1500.5,
    "Cloud Provider": "AWS",
    ...overrides,
  };
  return { line, cells: HEADER.map((h) => (h in base ? base[h] : null)) };
}
