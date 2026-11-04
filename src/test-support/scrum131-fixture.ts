// SCRUM-131 synthetic acceptance fixture, shaped like the owner's 6 Oct file (342 rows) WITHOUT any of
// its data: every name, ID and amount here is MADE UP. Do not replace it with real business data.
//
// Same shape as the real file, so the Healer must reproduce the same counts:
//  - 342 rows; providers 334 "MakeMyLabs Private Cloud" + 2 "Oracle" (Private) and 6 "Azure" (Public);
//  - every Start/End Date is DD-MM-YYYY text: 684 date cells, 425 of them prove day-first (day > 12),
//    none prove month-first; so all 684 convert (date order DMY);
//  - 11 customer names differ from an existing customer only in case or spacing (4 + 2 + 2 + 1 + 1 + 1);
//  - prices: 131 rows with both prices 0, 113 with only Input Cost 0, 4 with only Selling Cost 0
//    (= 244 input-0, 135 selling-0, 248 Incomplete rows), 94 fully priced rows; no blank cells.
import { STRICT_HEADERS } from "./scrum129-fixture";

/** Existing customers (what the server reads from the customers table). Made up. */
export const SYNTHETIC_EXISTING_CUSTOMERS = [
  "Synthetic Alpha",
  "Example BETA",
  "Demo Gamma Labs",
  "Placeholder Delta",
  "Sample Epsilon",
  "Mock Zeta",
  "Fictional Eta",
  "Imaginary Theta",
] as const;

/** File spellings that the Healer must map to the existing spelling, and how many rows use each (11 total). */
export const SYNTHETIC_NAME_VARIANTS: ReadonlyArray<readonly [string, string, number]> = [
  ["SYNTHETIC ALPHA", "Synthetic Alpha", 4],
  ["Example Beta", "Example BETA", 2],
  ["demo gamma labs", "Demo Gamma Labs", 2],
  ["Placeholder  Delta", "Placeholder Delta", 1], // double space
  ["sample epsilon", "Sample Epsilon", 1],
  ["MOCK zeta", "Mock Zeta", 1],
];

export interface Synthetic131Row {
  potentialId: string;
  month: number;
  year: number;
  customer: string;
  lab: string;
  lob: "VILT" | "Standalone" | "Integrated";
  start: string; // DD-MM-YYYY text
  end: string; // DD-MM-YYYY text
  users: number;
  input: number;
  selling: number;
  provider: string;
}

const LOBS = ["VILT", "Standalone", "Integrated"] as const;

function ddmm(day: number, month: number, year = 2026): string {
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

export function synthetic131Rows(): Synthetic131Row[] {
  const providers = [
    ...Array.from({ length: 334 }, () => "MakeMyLabs Private Cloud"),
    ...Array.from({ length: 2 }, () => "Oracle"),
    ...Array.from({ length: 6 }, () => "Azure"),
  ];
  const variants: string[] = SYNTHETIC_NAME_VARIANTS.flatMap(([spelling, , n]) => Array.from({ length: n }, () => spelling));
  const exact = SYNTHETIC_EXISTING_CUSTOMERS;
  return providers.map((provider, i) => {
    const month = (i % 9) + 1; // 1..9
    // Rows 0..211: both days > 12 (424 proving cells); row 212: start only (425th). Others: day <= 12, != month.
    const startDay = i < 213 ? 13 + (i % 15) : ((month % 12) + 1 === month ? 12 : (month % 12) + 1);
    const endDay = i < 212 ? 14 + (i % 14) : ((month + 1) % 12) + 1 === month ? 11 : ((month + 1) % 12) + 1;
    // Prices: 0..130 both 0; 131..243 input 0; 244..247 selling 0; 248..341 priced.
    const input = i < 244 ? 0 : 100 + (i % 7) * 10;
    const selling = i < 131 || (i >= 244 && i < 248) ? 0 : 200 + (i % 5) * 25;
    return {
      potentialId: `SYN131-PID-${String(5000 + i)}`,
      month,
      year: 2026,
      customer: i < variants.length ? variants[i] : exact[i % exact.length],
      lab: `Synthetic Lab ${(i % 23) + 1}`,
      lob: LOBS[i % LOBS.length],
      start: ddmm(startDay, month),
      end: ddmm(endDay, month),
      users: (i % 9) + 1,
      input,
      selling,
      provider,
    };
  });
}

/** CSV in the 2.0.0 template layout (no Cloud Type / System Config columns, like the owner's file). */
export function synthetic131Csv(rows: readonly Synthetic131Row[] = synthetic131Rows()): string {
  const lines = [STRICT_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.potentialId, r.month, r.year, r.customer, r.lab, r.lob, r.start, r.end, r.users, String(r.input), String(r.selling), r.provider]
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export const synthetic131Customers = () =>
  SYNTHETIC_EXISTING_CUSTOMERS.map((customer_name) => ({ customer_name, normalized_name: customer_name.toLowerCase() }));
