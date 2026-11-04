// Eng QC P-N1 (SCRUM-131): a field holding only NBSP (or other is_blank_text whitespace) is blank
// in BOTH the Incomplete badge (isIncompleteTransaction) and the /transactions completeness filter
// (PostgREST query from applyCompletenessQuery, driven by ?completeness=). One helper: isBlankField.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  BLANK_CHAR_CLASS,
  BLANK_TEXT_REGEX,
  REQUIRED_NUMERIC_FIELDS,
  REQUIRED_TRANSACTION_FIELDS,
  applyCompletenessQuery,
  completeQueryFilters,
  incompleteQueryOr,
  isBlankField,
  isEmptyBusinessValue,
  isIncompleteTransaction,
  selectTransactions,
  type CompletenessFilter,
} from "@/lib/transaction-completeness";

const MIGRATION = "supabase/migrations/20261006070000_scrum131_import_staging_approval.sql";

/**
 * The function definition of public.is_blank_text, found by content (not by line number: it is
 * line 271 on eedae34 and 277 on 269b9f9). Exactly one definition, and its body is the btrim rule.
 */
const IS_BLANK_TEXT_DEF =
  /CREATE OR REPLACE FUNCTION public\.is_blank_text\(p text\)[\s\S]*?AS \$f\$\s*SELECT p IS NULL OR pg_catalog\.btrim\(p, U&'([^']*)'\) = '';\s*\$f\$;/g;

/** Code points of the btrim set in public.is_blank_text, read from the migration (not changed). */
function serverBlankCodePoints(): number[] {
  const sql = readFileSync(path.resolve(process.cwd(), MIGRATION), "utf8");
  const defs = [...sql.matchAll(IS_BLANK_TEXT_DEF)];
  expect(defs).toHaveLength(1);
  const set = defs[0][1];
  const out: number[] = [];
  for (let i = 0; i < set.length; ) {
    if (set[i] === "\\") {
      out.push(parseInt(set.slice(i + 1, i + 5), 16));
      i += 5;
    } else {
      out.push(set.codePointAt(i)!);
      i += 1;
    }
  }
  return out.sort((a, b) => a - b);
}

/** Code points matched by BLANK_CHAR_CLASS (ranges expanded). */
function clientBlankCodePoints(): number[] {
  const out: number[] = [];
  const re = /\\u([0-9a-f]{4})(?:-\\u([0-9a-f]{4}))?/g;
  for (const m of BLANK_CHAR_CLASS.matchAll(re)) {
    const lo = parseInt(m[1], 16);
    const hi = m[2] ? parseInt(m[2], 16) : lo;
    for (let c = lo; c <= hi; c++) out.push(c);
  }
  return out.sort((a, b) => a - b);
}

// Synthetic rows only.
type Row = {
  id: string;
  created_at: string;
  potential_id: string | null;
  month: number | null;
  year: number | null;
  customer_name: string | null;
  lab_name: string | null;
  cloud_provider: string | null;
  input_cost: number | null;
  selling_cost: number | null;
  total_users: number | null;
};
const base: Row = {
  id: "syn",
  created_at: "2026-10-06T00:00:00Z",
  potential_id: "SYN-PID-1",
  month: 10,
  year: 2026,
  customer_name: "Synthetic Co",
  lab_name: "Synthetic Lab",
  cloud_provider: "AWS",
  input_cost: 10,
  selling_cost: 20,
  total_users: 3,
};

const NBSP = "\u00a0";
const CASES: { name: string; value: string; blank: boolean }[] = [
  { name: "NBSP only", value: `${NBSP}${NBSP}`, blank: true },
  { name: "tab and newline", value: "\t\n\r", blank: true },
  { name: "normal spaces", value: "   ", blank: true },
  { name: "empty string", value: "", blank: true },
  {
    name: "mixed unicode spaces (U+2007 U+202F U+FEFF U+3000)",
    value: "\u2007\u202f\ufeff\u3000",
    blank: true,
  },
  { name: "real value", value: "SYN-VALUE", blank: false },
  { name: "real value padded with NBSP", value: `${NBSP}SYN-VALUE${NBSP}`, blank: false },
  { name: "zero-width space (not trimmed by the server)", value: "\u200b", blank: false },
];
const TEXT_FIELDS = REQUIRED_TRANSACTION_FIELDS.filter((f) => !REQUIRED_NUMERIC_FIELDS.includes(f));

// Postgres ARE semantics for the regex, as measured on Postgres 17.11 (locale C.UTF-8) for every BMP code
// point (peter-ui-patches/P-N1-pg17-parity.sql/.out): `\uXXXX` means the same as in JS, but `\s` matches
// the is_blank_text set MINUS U+00A0, U+2007, U+202F, U+FEFF. JS `\s` would hide exactly the bug P-N1 is about.
const PG_BACKSLASH_S =
  "[\\u0009-\\u000d\\u0020\\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000]";
function pgRegex(pattern: string): RegExp {
  return new RegExp(pattern.replaceAll("\\s", PG_BACKSLASH_S));
}

// In-memory PostgREST evaluator for the operators the completeness query uses (SQL NULL semantics,
// Postgres regex semantics for match / not.match).
type Op = { column: string; operator: string; value: string };
function evalOp(row: Record<string, unknown>, op: Op): boolean {
  const v = row[op.column];
  const isNull = v == null;
  switch (op.operator) {
    case "is":
      return op.value === "null" && isNull;
    case "not.is":
      return op.value === "null" && !isNull;
    case "gt":
      return !isNull && Number(v) > Number(op.value);
    case "lte":
      return !isNull && Number(v) <= Number(op.value);
    case "match":
      return !isNull && pgRegex(op.value).test(String(v));
    case "not.match":
      return !isNull && !pgRegex(op.value).test(String(v));
    default:
      throw new Error(`operator not covered: ${op.operator}`);
  }
}
function parseOr(or: string): Op[] {
  return or.split(",").map((part) => {
    const [column, operator, ...rest] = part.split(".");
    return { column, operator, value: rest.join(".") };
  });
}
const filterSaysIncomplete = (row: Row) =>
  parseOr(incompleteQueryOr()).some((op) => evalOp(row as unknown as Record<string, unknown>, op));
const filterSaysComplete = (row: Row) =>
  completeQueryFilters().every((op) => evalOp(row as unknown as Record<string, unknown>, op));

describe("P-N1: isBlankField mirrors the server's is_blank_text", () => {
  it("BLANK_CHAR_CLASS is exactly the btrim set of public.is_blank_text (found by content in the migration)", () => {
    const server = serverBlankCodePoints();
    expect(server).toHaveLength(25);
    expect(clientBlankCodePoints()).toEqual(server);
  });

  it("the set equals what JS String.prototype.trim removes (import side: isBlankCell / healer)", () => {
    const re = new RegExp(BLANK_TEXT_REGEX);
    const trimmed: number[] = [];
    for (let c = 1; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCharCode(c);
      const byTrim = ch.trim() === "";
      if (byTrim) trimmed.push(c);
      expect(isBlankField(ch)).toBe(byTrim);
      expect(re.test(ch)).toBe(byTrim);
    }
    expect(trimmed).toEqual(serverBlankCodePoints());
    // ~130k expect calls: under full parallel load it ran past vitest's 5 s default (SCRUM-128 Eng QC N14).
  }, 20_000);

  it.each(CASES)("isBlankField: $name -> $blank", ({ value, blank }) => {
    expect(isBlankField(value)).toBe(blank);
    expect(isEmptyBusinessValue(value)).toBe(blank);
    expect(new RegExp(BLANK_TEXT_REGEX).test(value)).toBe(blank);
  });

  it("null/undefined are blank; numbers are not (month/year use is.null only)", () => {
    expect(isBlankField(null)).toBe(true);
    expect(isBlankField(undefined)).toBe(true);
    expect(isBlankField(0)).toBe(false);
    expect(isBlankField(2026)).toBe(false);
  });

  it("regression guard: the old Postgres `^\\s*$` filter missed NBSP (the P-N1 bug); the new regex does not", () => {
    for (const ch of ["\u00a0", "\u2007", "\u202f", "\ufeff"]) {
      expect(pgRegex("^\\s*$").test(ch)).toBe(false); // old filter: NBSP-only row counted Complete
      expect(isBlankField(ch)).toBe(true); // badge: Incomplete
      expect(pgRegex(BLANK_TEXT_REGEX).test(ch)).toBe(true); // new filter: Incomplete too
    }
    expect(pgRegex("^\\s*$").test("\t\n ")).toBe(true);
  });

  it("the regex is PostgREST-safe and ASCII-only (no quoting, no encoding surprises)", () => {
    expect(BLANK_TEXT_REGEX).not.toMatch(/[,.:()"]/);
    expect(BLANK_TEXT_REGEX).toMatch(/^[\x21-\x7e]+$/);
    expect(BLANK_TEXT_REGEX).not.toContain("\\s");
  });
});

describe("P-N1: badge path and /transactions filter path agree", () => {
  for (const field of TEXT_FIELDS) {
    it.each(CASES)(
      `${field} = $name: badge, cloud-view filter and DB filter agree`,
      ({ value, blank }) => {
        const row: Row = { ...base, [field]: value };
        // Badge path (Incomplete badge on /transactions, cloud views, Bulk Upload review).
        expect(isIncompleteTransaction(row)).toBe(blank);
        // Client filter path (cloud-view tabs / selectTransactions).
        const pick = (c: CompletenessFilter) =>
          selectTransactions([row], { completeness: c, sortMode: "recent" }).length;
        expect(pick("incomplete")).toBe(blank ? 1 : 0);
        expect(pick("complete")).toBe(blank ? 0 : 1);
        // DB filter path (/transactions ?completeness= -> PostgREST).
        expect(filterSaysIncomplete(row)).toBe(blank);
        expect(filterSaysComplete(row)).toBe(!blank);
      },
    );
  }

  it("the regex reaches PostgREST unchanged through supabase-js (Complete and Incomplete)", async () => {
    const urls: URL[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      urls.push(
        new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url),
      );
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = createClient("https://synthetic.invalid", "synthetic-public-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fakeFetch },
      // Never connects; an inert transport keeps createClient working on Node 20 (no native WebSocket).
      realtime: { transport: class {} as never },
    });
    await applyCompletenessQuery(client.from("transactions").select("id"), "complete");
    await applyCompletenessQuery(client.from("transactions").select("id"), "incomplete");
    expect(urls).toHaveLength(2);
    const [complete, incomplete] = urls;
    for (const f of TEXT_FIELDS) {
      expect(complete.searchParams.getAll(f)).toContain(`not.match.${BLANK_TEXT_REGEX}`);
    }
    expect(incomplete.searchParams.get("or")).toBe(`(${incompleteQueryOr()})`);
    for (const f of TEXT_FIELDS) {
      expect(incompleteQueryOr()).toContain(`${f}.match.${BLANK_TEXT_REGEX}`);
    }
  });
});
