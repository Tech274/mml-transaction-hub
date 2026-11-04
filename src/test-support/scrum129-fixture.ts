// SCRUM-129 synthetic import fixture shaped like the owner's 6 Oct file: 342 rows, of which
// 334 say "MakeMyLabs Private Cloud", 2 say "Oracle" and 6 say "Azure".
// Every name, ID and amount here is MADE UP. Do not replace it with real business data.

export interface FixtureRow {
  potentialId: string;
  month: number;
  year: number;
  customer: string;
  lab: string;
  provider: string;
  lob: "VILT" | "Standalone" | "Integrated";
  start: string;
  end: string;
  users: number;
  input: number;
  selling: number;
}

const CUSTOMERS = ["Synthetic Alpha Pvt Ltd", "Example Beta Corp", "Demo Gamma Labs", "Placeholder Delta Inc"];
const LOBS = ["VILT", "Standalone", "Integrated"] as const;

/** Provider spellings in the same proportions as the owner's file (334 / 2 / 6). */
export function ownerShapedProviders(): string[] {
  return [
    ...Array.from({ length: 334 }, () => "MakeMyLabs Private Cloud"),
    ...Array.from({ length: 2 }, () => "Oracle"),
    ...Array.from({ length: 6 }, () => "Azure"),
  ];
}

export function syntheticRows(providers: readonly string[] = ownerShapedProviders()): FixtureRow[] {
  return providers.map((provider, i) => ({
    potentialId: `SYN-PID-${String(1000 + i)}`,
    month: (i % 12) + 1,
    year: 2026,
    customer: CUSTOMERS[i % CUSTOMERS.length],
    lab: `Synthetic Lab ${(i % 17) + 1}`,
    provider,
    lob: LOBS[i % LOBS.length],
    start: "2026-09-01",
    end: "2026-09-30",
    users: (i % 9) + 1,
    input: 100 + (i % 7) * 10,
    selling: 200 + (i % 5) * 25,
  }));
}

export const STRICT_HEADERS = [
  "Potential ID",
  "Month",
  "Year",
  "Customer Name",
  "Lab Name",
  "Line of Business",
  "Start Date",
  "End Date",
  "Total Users",
  "Input Cost",
  "Selling Cost",
  "Cloud Provider",
] as const;

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV in the strict template layout (2.0.0 headers). */
export function syntheticCsv(rows: readonly FixtureRow[] = syntheticRows()): string {
  const lines = [STRICT_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.potentialId, r.month, r.year, r.customer, r.lab, r.lob, r.start, r.end, r.users, r.input.toFixed(2), r.selling.toFixed(2), r.provider]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** RPC rows (the shape import_transactions_batch reads). */
export function syntheticRpcRows(rows: readonly FixtureRow[] = syntheticRows()) {
  return rows.map((r, i) => ({
    source_line: i + 2,
    potential_id: r.potentialId,
    month: r.month,
    year: r.year,
    customer_name: r.customer,
    lab_name: r.lab,
    line_of_business: r.lob,
    start_date: r.start,
    end_date: r.end,
    total_users: r.users,
    input_cost: r.input.toFixed(2),
    selling_cost: r.selling.toFixed(2),
    cloud_provider: r.provider,
  }));
}
