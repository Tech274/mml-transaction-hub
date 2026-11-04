// SCRUM-131: the Healer. Runs automatically on every upload, between parse and validate:
//
//   parse -> HEALER -> validate -> sign-off queue (Chief) -> commit
//
// It FIXES only what is safe to fix, records every fix with the original value, and FLAGS the
// rest. Pure TypeScript, shared by the browser preview and the server; the server re-runs it on
// the uploaded bytes and is the authority (design record §19.4).
//
// Properties:
//  - Deterministic: no clock, locale or randomness. Inputs are the cells, the provider rule in
//    @/lib/cloud-provider and the list of existing customers read by the server.
//  - Idempotent: healing an already-healed sheet changes nothing (0 corrections).
//  - Versioned: HEALER_VERSION is stored on the staged import and on every correction. Bump it
//    whenever a rule's output changes (a snapshot test pins the rule table).
//
// Rules (fix vs flag):
//  - date.reorder_to_iso   Start/End Date. DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, D-M-YYYY (and
//                          MM-DD-YYYY when the file proves month-first) -> YYYY-MM-DD. ISO text and
//                          Excel date cells pass unchanged. WHOLE-FILE order (SCRUM-131 date fix):
//                          a real date with its first part above 12 proves day-first, one with its
//                          middle part above 12 proves month-first; equal day and month (05-05) reads
//                          the same either way. If every DD-MM-style date is ambiguous (both parts
//                          <= 12) the order is NEVER guessed: the uploader picks it (ctx.dateOrder,
//                          "DMY" | "MDY") and the server re-runs this with the same choice.
//                          BLOCKER: the file mixes day-first and month-first dates (every DD-MM-style
//                          cell, whole file); ambiguous with no choice; a choice that contradicts the
//                          file; unparseable or impossible (31-02). A non-empty date is never stored
//                          blank. Blank: left blank (validate warns), never filled.
//  - customer.match_existing  Customer Name. Exact match: unchanged. Same normalized_name (case and
//                          spaces, the DB key) as exactly one existing customer: stored as that
//                          spelling (ACME LABS -> Acme Labs). Else a space-insensitive match to exactly one.
//                          BLOCKER: matches several existing customers. WARNING: no match (new customer).
//  - provider.alias        Cloud Provider. normalizeProvider() from @/lib/cloud-provider (the
//                          SCRUM-129 rule). An alias is replaced by the canonical name and shown as a
//                          Healer fix. Blank/unknown is NOT guessed: validate blocks it.
//  - price.blank_to_zero   Input/Selling Cost blank -> 0 (NOT NULL). Original blank kept (null).
//  - price.invalid_to_zero Input/Selling Cost unreadable or negative -> 0. Original text kept.
//                          Every 0 price (typed or healed) is a WARNING and makes the row Incomplete.
//  - text.trim             Potential ID, Lab Name, System Config: unicode spaces and runs of spaces
//                          collapsed (recorded only when the inside of the value changes; leading
//                          and trailing spaces were always trimmed silently).
import { normalizeName, cleanCustomerName } from "@/lib/customer-normalize";
import { normalizeProvider } from "@/lib/cloud-provider";
import { isBlankCell, isExcelDate, isIsoDate, type RawCell, type RawRow } from "./cells";
import { columnLetter, PROPOSED_RULES, type StrictField } from "./template";
import { matchHeaders, parseStrictNumber, toCents } from "./validate";

export const HEALER_VERSION = "1.1.0" as const; // 1.1.0: whole-file date order + uploader's choice

export const HEALER_RULES = [
  "date.reorder_to_iso",
  "customer.match_existing",
  "provider.alias",
  "price.blank_to_zero",
  "price.invalid_to_zero",
  "text.trim",
] as const;
export type HealerRule = (typeof HEALER_RULES)[number];

export type HealerFlagCode =
  | "date.ambiguous"
  | "date.unparseable"
  | "date.impossible"
  | "date.mixed_order"
  | "date.order_conflict"
  | "customer.multiple_matches"
  | "customer.new"
  | "price.zero";

export type IssueTier = "blocker" | "warning";

export interface HealerCorrection {
  line: number;
  field: StrictField;
  header: string;
  column: string;
  rule: HealerRule;
  /** null = the cell was blank in the file. */
  original: string | null;
  healed: string;
}

export interface HealerFlag {
  line: number;
  field: StrictField;
  header: string;
  column: string | null;
  value: string;
  tier: IssueTier;
  code: HealerFlagCode;
  message: string;
}

export type DateOrder = "DMY" | "MDY" | "MIXED" | "UNKNOWN";
/** The uploader's answer when the file proves no order (every DD-MM-style date has both parts <= 12). */
export type ChosenDateOrder = "DMY" | "MDY";
export const DATE_ORDER_CHOICES: readonly ChosenDateOrder[] = ["DMY", "MDY"];

/** How the file's DD-MM-style dates were read (preview contract `dateOrder`; summarised on the stage). */
export interface DateOrderReport {
  /** What the file itself proves. */
  order: DateOrder;
  /** Real dates with the first part above 12 (prove day-first) / the middle part above 12 (prove month-first). */
  dayFirstCells: number;
  monthFirstCells: number;
  /** DD-MM-style dates with both parts <= 12 and different (05-04): they need a proven or chosen order. */
  ambiguousCells: number;
  /** The order the dates were read with; null when none was needed or the file is blocked (MIXED, no choice). */
  used: ChosenDateOrder | null;
  /** "file": proven by the file; "uploader": the uploader's choice (only when the file proves none). */
  source: "file" | "uploader" | null;
  /** True when the preview must ask the uploader to choose (ambiguous dates, no proof, no choice). */
  needsChoice: boolean;
  /** The order the caller sent (null = none). Used only when the file proves no order. */
  chosen: ChosenDateOrder | null;
  /** First proving cell for each order, e.g. 'line 2, Start Date "21-04-2026"'. */
  dayFirstExample: string | null;
  monthFirstExample: string | null;
}

export interface ExistingCustomerName {
  customer_name: string;
  normalized_name?: string | null;
}

export interface HealerContext {
  /** Existing customers (all of them; the server reads the table). Empty list = every name is new. */
  customers: readonly ExistingCustomerName[];
  /**
   * SCRUM-131 date fix: the uploader's date order for a file whose dates are all ambiguous (preview picker,
   * carried through submit). Used ONLY when the file proves no order; a choice that contradicts the file blocks.
   */
  dateOrder?: ChosenDateOrder | null;
}

export interface HealerResult {
  version: typeof HEALER_VERSION;
  /** Same header; rows have the same lines and cell positions, with healed values. */
  header: string[];
  rows: RawRow[];
  corrections: HealerCorrection[];
  flags: HealerFlag[];
  dateOrder: DateOrderReport;
  /** Customer names that match no existing customer (created at commit). Sorted. */
  newCustomers: string[];
}

const DMY_RE = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/;

function display(v: RawCell): string {
  if (v === null) return "";
  if (isExcelDate(v)) return v.iso;
  return String(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 9999) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Which order the file uses, from cells whose first or second part is above 12. */
export function detectDateOrder(
  cells: readonly RawCell[],
): Pick<DateOrderReport, "order" | "dayFirstCells" | "monthFirstCells"> {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const c of cells) {
    if (typeof c !== "string") continue;
    const m = DMY_RE.exec(c.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = Number(m[4]);
    // Only a REAL date proves an order (31-02-2026 is blocked on its own and proves nothing).
    if (a > 12 && b <= 12 && isRealDate(y, b, a)) dayFirst += 1;
    else if (b > 12 && a <= 12 && isRealDate(y, a, b)) monthFirst += 1;
  }
  const order: DateOrder = dayFirst && !monthFirst ? "DMY" : monthFirst && !dayFirst ? "MDY" : dayFirst && monthFirst ? "MIXED" : "UNKNOWN";
  return { order, dayFirstCells: dayFirst, monthFirstCells: monthFirst };
}

export type DateHeal =
  | { kind: "blank" }
  | { kind: "ok"; iso: string; changed: boolean }
  | {
      kind: "flag";
      code: "date.ambiguous" | "date.unparseable" | "date.impossible" | "date.mixed_order";
      message: string;
    };

/** One date cell under the file's order. Pure; exported for tests. */
export function healDate(value: RawCell, order: DateOrder): DateHeal {
  if (isBlankCell(value)) return { kind: "blank" };
  if (isExcelDate(value)) return { kind: "ok", iso: value.iso, changed: false };
  if (typeof value !== "string") {
    return { kind: "flag", code: "date.unparseable", message: "Not a date. Use DD-MM-YYYY, YYYY-MM-DD or an Excel date." };
  }
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isIsoDate(s)
      ? { kind: "ok", iso: s, changed: s !== value }
      : { kind: "flag", code: "date.impossible", message: `${s} is not a real calendar date.` };
  }
  const m = DMY_RE.exec(s);
  if (!m) {
    return { kind: "flag", code: "date.unparseable", message: `Cannot read "${s}" as a date. Use DD-MM-YYYY, YYYY-MM-DD or an Excel date.` };
  }
  const a = Number(m[1]);
  const b = Number(m[3]);
  const y = Number(m[4]);
  // S1 (John's QC): no reading works under either order (00-05, 05-00, 14-13, 31-02, 32-01). That is an
  // impossible date whatever the file's order; a format choice cannot help, so it is never "ambiguous".
  if (!isRealDate(y, b, a) && !isRealDate(y, a, b)) {
    return {
      kind: "flag",
      code: "date.impossible",
      message: `"${s}" is not a real calendar date.`,
    };
  }
  if (order === "MIXED") {
    // Whole-file rule: a file with both day-first and month-first dates is inconsistent; no cell is read.
    return {
      kind: "flag",
      code: "date.mixed_order",
      message: `"${s}" cannot be read safely: this file has both day-first and month-first dates. Use one format for the whole file, or YYYY-MM-DD.`,
    };
  }
  let day: number;
  let month: number;
  if (a > 12 && b <= 12) [day, month] = [a, b];
  else if (b > 12 && a <= 12) [day, month] = [b, a];
  else if (a === b) [day, month] = [a, b];
  else if (order === "DMY") [day, month] = [a, b];
  else if (order === "MDY") [day, month] = [b, a];
  else {
    return {
      kind: "flag",
      code: "date.ambiguous",
      message: `"${s}" is ambiguous: no date in this file has a day or month above 12, so it could be day-first or month-first. Choose the date format for this file (DD-MM-YYYY or MM-DD-YYYY), or use YYYY-MM-DD.`,
    };
  }
  if (!isRealDate(y, month, day)) {
    return { kind: "flag", code: "date.impossible", message: `"${s}" is not a real calendar date.` };
  }
  return { kind: "ok", iso: `${y}-${pad2(month)}-${pad2(day)}`, changed: true };
}

export type CustomerHeal =
  | { kind: "blank" }
  | { kind: "exact"; name: string }
  | { kind: "matched"; name: string; via: "normalized" | "space-insensitive" }
  | { kind: "multiple"; candidates: string[] }
  | { kind: "new"; name: string };

function compactKey(s: string): string {
  return normalizeName(s).replace(/ /g, "");
}

/** Customer index built once per sheet. Pure; exported for tests. */
export function customerMatcher(customers: readonly ExistingCustomerName[]) {
  const exact = new Set<string>();
  const byNorm = new Map<string, Set<string>>();
  const byCompact = new Map<string, Set<string>>();
  for (const c of customers) {
    const name = c.customer_name;
    if (!name || name.trim() === "") continue;
    exact.add(name);
    const norm = c.normalized_name && c.normalized_name.trim() !== "" ? c.normalized_name : normalizeName(name);
    (byNorm.get(norm) ?? byNorm.set(norm, new Set()).get(norm)!).add(name);
    const compact = compactKey(name);
    (byCompact.get(compact) ?? byCompact.set(compact, new Set()).get(compact)!).add(name);
  }
  return (raw: RawCell): CustomerHeal => {
    if (isBlankCell(raw)) return { kind: "blank" };
    const asTyped = display(raw).trim();
    if (exact.has(asTyped)) return { kind: "exact", name: asTyped };
    const typed = cleanCustomerName(asTyped);
    const norm = byNorm.get(normalizeName(typed));
    if (norm && norm.size === 1) return { kind: "matched", name: [...norm][0], via: "normalized" };
    if (norm && norm.size > 1) return { kind: "multiple", candidates: [...norm].sort() };
    const compact = byCompact.get(compactKey(typed));
    if (compact && compact.size === 1) return { kind: "matched", name: [...compact][0], via: "space-insensitive" };
    if (compact && compact.size > 1) return { kind: "multiple", candidates: [...compact].sort() };
    return { kind: "new", name: typed };
  };
}

type PriceHeal = { kind: "ok"; zero: boolean } | { kind: "fix"; rule: "price.blank_to_zero" | "price.invalid_to_zero" };

function healPrice(value: RawCell): PriceHeal {
  if (isBlankCell(value)) return { kind: "fix", rule: "price.blank_to_zero" };
  const n = parseStrictNumber(value);
  if (n === null || n < 0 || toCents(n) === null) return { kind: "fix", rule: "price.invalid_to_zero" };
  return { kind: "ok", zero: n === 0 };
}

const TRIM_FIELDS: readonly StrictField[] = ["potential_id", "lab_name", "system_config"];

/** Collapse unicode spaces and runs of spaces, then trim (same cleaning as customer names). */
function collapse(s: string): string {
  return cleanCustomerName(s);
}

/** Heal a parsed sheet. The input is not modified. */
/** "DD-MM-YYYY" / "MM-DD-YYYY" for messages and the preview picker. */
export function orderLabel(o: ChosenDateOrder): string {
  return o === "DMY" ? "DD-MM-YYYY" : "MM-DD-YYYY";
}

function isDmyShaped(v: RawCell): boolean {
  return typeof v === "string" && DMY_RE.test(v.trim());
}

/** Whole-file date order (pure): proof from the file, examples, ambiguous cells and the uploader's choice. */
function dateOrderReport(
  rows: readonly RawRow[],
  map: Map<StrictField, number>,
  dateFields: readonly StrictField[],
  isBlankRow: (row: RawRow) => boolean,
  chosen: ChosenDateOrder | null,
): DateOrderReport {
  const cells: RawCell[] = [];
  let dayFirstExample: string | null = null;
  let monthFirstExample: string | null = null;
  let ambiguousCells = 0;
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    for (const f of dateFields) {
      const i = map.get(f)!;
      const v = i < row.cells.length ? row.cells[i] : null;
      cells.push(v);
      if (typeof v !== "string") continue;
      const m = DMY_RE.exec(v.trim());
      if (!m) continue;
      const [a, b, y] = [Number(m[1]), Number(m[3]), Number(m[4])];
      const header = PROPOSED_RULES.columns.find((c) => c.field === f)!.header;
      const where = `line ${row.line}, ${header} "${v.trim()}"`;
      if (a > 12 && b <= 12 && isRealDate(y, b, a)) dayFirstExample ??= where;
      else if (b > 12 && a <= 12 && isRealDate(y, a, b)) monthFirstExample ??= where;
      else if (a >= 1 && b >= 1 && a <= 12 && b <= 12 && a !== b) ambiguousCells += 1;
    }
  }
  const { order, dayFirstCells, monthFirstCells } = detectDateOrder(cells);
  const choice = chosen === "DMY" || chosen === "MDY" ? chosen : null;
  let used: ChosenDateOrder | null = null;
  let source: DateOrderReport["source"] = null;
  if (order === "DMY" || order === "MDY") {
    used = order;
    source = "file";
  } else if (order === "UNKNOWN" && ambiguousCells > 0 && choice) {
    used = choice;
    source = "uploader";
  }
  return {
    order,
    dayFirstCells,
    monthFirstCells,
    ambiguousCells,
    used,
    source,
    needsChoice: order === "UNKNOWN" && ambiguousCells > 0 && !choice,
    chosen: choice,
    dayFirstExample,
    monthFirstExample,
  };
}

export function healSheet(header: string[], rows: readonly RawRow[], ctx: HealerContext): HealerResult {
  const { map } = matchHeaders(header, PROPOSED_RULES);
  const colOf = (f: StrictField) => PROPOSED_RULES.columns.find((c) => c.field === f)!;
  const templateIdx = [...map.values()];
  const isBlankRow = (row: RawRow) => templateIdx.length === 0 || templateIdx.every((i) => i >= row.cells.length || isBlankCell(row.cells[i]));

  const dateFields: StrictField[] = (["start_date", "end_date"] as StrictField[]).filter((f) => map.has(f));
  const dateOrder = dateOrderReport(rows, map, dateFields, isBlankRow, ctx.dateOrder ?? null);
  // Read cells with the file's proof, else the uploader's choice, else nothing (ambiguous cells block).
  const readOrder: DateOrder = dateOrder.order === "MIXED" ? "MIXED" : (dateOrder.used ?? "UNKNOWN");
  let conflictFlagged = false;
  const matchCustomer = customerMatcher(ctx.customers);

  const corrections: HealerCorrection[] = [];
  const flags: HealerFlag[] = [];
  const newCustomers = new Set<string>();
  const out: RawRow[] = [];

  for (const row of rows) {
    const cells = row.cells.slice();
    if (isBlankRow(row)) {
      out.push({ line: row.line, cells });
      continue;
    }
    const get = (f: StrictField): { idx: number; value: RawCell } | null => {
      const idx = map.get(f);
      if (idx === undefined) return null;
      return { idx, value: idx < cells.length ? cells[idx] : null };
    };
    const set = (idx: number, v: RawCell) => {
      while (cells.length <= idx) cells.push(null);
      cells[idx] = v;
    };
    const fix = (f: StrictField, idx: number, rule: HealerRule, original: string | null, healed: string) =>
      corrections.push({ line: row.line, field: f, header: colOf(f).header, column: columnLetter(idx), rule, original, healed });
    const flag = (f: StrictField, idx: number | null, value: RawCell, tier: IssueTier, code: HealerFlagCode, message: string) =>
      flags.push({ line: row.line, field: f, header: colOf(f).header, column: idx === null ? null : columnLetter(idx), value: display(value), tier, code, message });

    // Dates
    for (const f of dateFields) {
      const c = get(f)!;
      const r = healDate(c.value, readOrder);
      if (r.kind === "ok" && r.changed) {
        fix(f, c.idx, "date.reorder_to_iso", display(c.value), r.iso);
        set(c.idx, r.iso);
      } else if (r.kind === "flag") {
        const why =
          r.code === "date.mixed_order"
            ? ` Day-first: ${dateOrder.dayFirstExample}; month-first: ${dateOrder.monthFirstExample}.`
            : "";
        flag(f, c.idx, c.value, "blocker", r.code, `${colOf(f).header}: ${r.message}${why}`);
      }
      // Server re-check: a chosen order that contradicts what the file proves blocks (once, first DD-MM cell).
      const conflict =
        dateOrder.chosen !== null &&
        dateOrder.source === "file" &&
        dateOrder.chosen !== dateOrder.used;
      if (conflict && !conflictFlagged && isDmyShaped(c.value)) {
        conflictFlagged = true;
        const proof =
          dateOrder.used === "DMY" ? dateOrder.dayFirstExample : dateOrder.monthFirstExample;
        const msg = `${colOf(f).header}: the date format chosen (${orderLabel(dateOrder.chosen!)}) does not match this file, which is ${orderLabel(dateOrder.used!)} (${proof}). Send without a date format, or fix the file.`;
        flag(f, c.idx, c.value, "blocker", "date.order_conflict", msg);
      }
    }

    // Customer name
    const cust = get("customer_name");
    if (cust) {
      const r = matchCustomer(cust.value);
      if (r.kind === "matched") {
        fix("customer_name", cust.idx, "customer.match_existing", display(cust.value), r.name);
        set(cust.idx, r.name);
      } else if (r.kind === "multiple") {
        flag(
          "customer_name",
          cust.idx,
          cust.value,
          "blocker",
          "customer.multiple_matches",
          `"${display(cust.value).trim()}" matches several existing customers (${r.candidates.join(", ")}). Use the exact name.`,
        );
      } else if (r.kind === "new") {
        newCustomers.add(r.name);
        flag("customer_name", cust.idx, cust.value, "warning", "customer.new", `New customer "${r.name}" will be created when the import is approved.`);
        if (r.name !== display(cust.value).trim()) {
          fix("customer_name", cust.idx, "text.trim", display(cust.value), r.name);
          set(cust.idx, r.name);
        }
      }
    }

    // Provider alias (blank/unknown is left for validate to block; never guessed)
    const prov = get("cloud_provider");
    if (prov && !isBlankCell(prov.value)) {
      const n = normalizeProvider(display(prov.value));
      if (n.ok && display(prov.value) !== n.provider) {
        // Only trailing/leading spaces differ: same value, no visible fix.
        if (n.aliasApplied) fix("cloud_provider", prov.idx, "provider.alias", display(prov.value), n.provider);
        set(prov.idx, n.provider);
      }
    }

    // Prices: stored as 0 (NOT NULL); the original blank or text is kept in the correction.
    for (const f of ["input_cost", "selling_cost"] as StrictField[]) {
      const c = get(f);
      if (!c) continue;
      const r = healPrice(c.value);
      const label = colOf(f).header;
      if (r.kind === "fix") {
        fix(f, c.idx, r.rule, isBlankCell(c.value) ? null : display(c.value), "0");
        set(c.idx, "0");
        flag(
          f,
          c.idx,
          c.value,
          "warning",
          "price.zero",
          r.rule === "price.blank_to_zero"
            ? `${label} is blank. Stored as 0; the row is Incomplete until a price is entered.`
            : `${label} "${display(c.value).trim()}" is not a valid amount. Stored as 0; the row is Incomplete until a price is entered.`,
        );
      } else if (r.zero) {
        flag(f, c.idx, c.value, "warning", "price.zero", `${label} is 0. The row is Incomplete until a price is entered.`);
      }
    }

    // Text clean-up (inside-the-value changes only)
    for (const f of TRIM_FIELDS) {
      const c = get(f);
      if (!c || typeof c.value !== "string" || isBlankCell(c.value)) continue;
      const cleaned = collapse(c.value);
      if (cleaned !== c.value.trim()) {
        fix(f, c.idx, "text.trim", c.value, cleaned);
        set(c.idx, cleaned);
      }
    }

    out.push({ line: row.line, cells });
  }

  return {
    version: HEALER_VERSION,
    header: header.slice(),
    rows: out,
    corrections,
    flags,
    dateOrder,
    newCustomers: [...newCustomers].sort((a, b) => a.localeCompare(b)),
  };
}

/** Corrections counted by rule (every rule present, 0 when unused). */
export function correctionsByRule(corrections: readonly HealerCorrection[]): Record<HealerRule, number> {
  const out = Object.fromEntries(HEALER_RULES.map((r) => [r, 0])) as Record<HealerRule, number>;
  for (const c of corrections) out[c.rule] += 1;
  return out;
}
