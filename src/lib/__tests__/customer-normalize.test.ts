import { describe, it, expect } from "vitest";
import { cleanCustomerName, normalizeName, normalizeEmail, normalizePhone } from "@/lib/customer-normalize";

describe("normalizeName", () => {
  it("trims, collapses spaces, lowercases", () => {
    expect(normalizeName("  Acme  Corp ")).toBe("acme corp");
    expect(normalizeName("ACME\tCorp")).toBe("acme corp");
    expect(normalizeName("Acme    Corp")).toBe("acme corp");
  });
  it("treats spelling variants as identical when equal after normalization", () => {
    expect(normalizeName("ACME corp")).toBe(normalizeName("acme  CORP"));
  });
  it("treats NBSP like a space, matching the import RPC key", () => {
    const nbsp = "Acme\u00A0  Labs";
    expect(cleanCustomerName(nbsp)).toBe("Acme Labs");
    expect(normalizeName(nbsp)).toBe("acme labs");
    expect(normalizeName("acme\u00A0labs")).toBe(normalizeName("  ACME   labs "));
    expect(normalizeName("\u00A0")).toBe("");
  });
});

describe("normalizeEmail", () => {
  it("returns null for empty / whitespace / null", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
  it("trims and lowercases", () => {
    expect(normalizeEmail(" JANE.DOE@Example.COM ")).toBe("jane.doe@example.com");
  });
  it("matches across casing variants", () => {
    expect(normalizeEmail("Foo@Bar.com")).toBe(normalizeEmail("foo@bar.COM"));
  });
});

describe("normalizePhone", () => {
  it("returns null when fewer than 7 digits", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("(12) 34-56")).toBeNull();
  });
  it("strips formatting and leading zeros", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toBe("14155552671");
    expect(normalizePhone("0044 20 7946 0958")).toBe("442079460958");
  });
  it("matches across format variants", () => {
    const variants = [
      "+91 98765 43210",
      "+91-98765-43210",
      "(91) 98765 43210",
      "919876543210",
      "0091 9876543210",
    ];
    const set = new Set(variants.map(normalizePhone));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe("919876543210");
  });
  it("rejects letters-only or symbol-only input", () => {
    expect(normalizePhone("abcdefg")).toBeNull();
    expect(normalizePhone("----")).toBeNull();
  });
});

describe("duplicate detection logic", () => {
  // Mirrors the assertContactUnique check on the server: a candidate is a
  // duplicate of an existing row when their normalized values match.
  function isDuplicateEmail(a: string | null, b: string | null) {
    const na = normalizeEmail(a); const nb = normalizeEmail(b);
    return !!na && !!nb && na === nb;
  }
  function isDuplicatePhone(a: string | null, b: string | null) {
    const na = normalizePhone(a); const nb = normalizePhone(b);
    return !!na && !!nb && na === nb;
  }

  it("flags casing variants of the same email as duplicates", () => {
    expect(isDuplicateEmail("Test@Example.com", "test@example.com")).toBe(true);
    expect(isDuplicateEmail(" test@example.com ", "TEST@EXAMPLE.COM")).toBe(true);
  });
  it("does not flag different emails as duplicates", () => {
    expect(isDuplicateEmail("a@example.com", "b@example.com")).toBe(false);
  });
  it("flags formatting variants of the same phone as duplicates", () => {
    expect(isDuplicatePhone("+1 (415) 555-2671", "1-415-555-2671")).toBe(true);
    expect(isDuplicatePhone("0091 98765 43210", "+919876543210")).toBe(true);
  });
  it("does not collapse different country codes into the same number", () => {
    // 14155552671 (US) and 4155552671 (no country code) are intentionally
    // distinct — we don't guess country codes.
    expect(isDuplicatePhone("+1 (415) 555-2671", "4155552671")).toBe(false);
  });
  it("does not flag two missing/blank values as duplicates", () => {
    expect(isDuplicateEmail(null, null)).toBe(false);
    expect(isDuplicatePhone("", "")).toBe(false);
  });
});

// SCRUM-103: the app key and the SQL key must treat the same unicode spaces as a space.
// Parse both lists from source so a change on one side fails here.
describe("TS and SQL unicode space lists match", () => {
  it("UNICODE_SPACES in customer-normalize.ts equals the translate() list in the pending SQL", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../..");
    const ts = readFileSync(path.join(root, "src/lib/customer-normalize.ts"), "utf8");
    const sql = readFileSync(path.join(root, "supabase/migrations-pending/scrum103_customer_name_normalize.sql"), "utf8");

    const cls = ts.match(/const UNICODE_SPACES = \/\[([^\]]+)\]\/g;/);
    expect(cls).not.toBeNull();
    const tsPoints = new Set<number>();
    const re = /\\u([0-9A-Fa-f]{4})(?:-\\u([0-9A-Fa-f]{4}))?/g;
    let consumed = "";
    for (let m = re.exec(cls![1]); m; m = re.exec(cls![1])) {
      consumed += m[0];
      const a = parseInt(m[1], 16);
      const b = m[2] ? parseInt(m[2], 16) : a;
      for (let c = a; c <= b; c++) tsPoints.add(c);
    }
    expect(consumed).toBe(cls![1]); // nothing in the class that the parser skipped

    const fn = sql.match(/FUNCTION public\.clean_customer_name[\s\S]*?translate\(\s*coalesce\(p_name, ''\),([\s\S]*?),\s*repeat\(' ', (\d+)\)/);
    expect(fn).not.toBeNull();
    const chrs = [...fn![1].matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(fn![1].replace(/chr\(\d+\)|\|\||\s/g, "")).toBe(""); // only chr(n) || chr(n) ...
    expect(chrs.length).toBe(Number(fn![2])); // one replacement space per character
    expect(new Set(chrs).size).toBe(chrs.length);
    expect([...new Set(chrs)].sort((x, y) => x - y)).toEqual([...tsPoints].sort((x, y) => x - y));
  });
});
