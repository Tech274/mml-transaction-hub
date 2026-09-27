// SCRUM-77: sensitive values never reach the MCP audit log.
import { describe, it, expect } from "vitest";
import { redactArguments, REDACTED } from "../mcp/redact";

describe("redactArguments", () => {
  it("keeps today's tool filters as they are", () => {
    const input = { year: 2026, cloud_provider: "AWS", line_of_business: "VILT", customer_id: "00000000-0000-4000-8000-0000000000c1", search: "acme", limit: 50 };
    expect(redactArguments(input)).toEqual(input);
  });

  it.each(["password", "api_key", "apiKey", "access_token", "Authorization", "client_secret", "session", "selling_cost", "input_cost", "price", "revenue", "amount", "margin_pct", "profit"])(
    "redacts the value of %s",
    (key) => {
      expect(redactArguments({ [key]: "x" })[key]).toBe(REDACTED);
    },
  );

  it("redacts token-looking values under harmless keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl";
    const out = redactArguments({ note: `Bearer ${"a".repeat(20)}`, q: jwt, k: "sb_secret_" + "x".repeat(24), long: "A".repeat(64) });
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it("redacts inside nested objects and arrays, and limits depth", () => {
    const out = redactArguments({ filter: { token: "t", name: "ok", list: [{ price: 5 }, "fine"] }, deep: { a: { b: { c: { d: 1 } } } } });
    expect(out.filter).toEqual({ token: REDACTED, name: "ok", list: [{ price: REDACTED }, "fine"] });
    expect(JSON.stringify(out.deep)).toContain("[nested]");
  });

  it("caps long strings and drops undefined; non-objects give {}", () => {
    const out = redactArguments({ s: "word ".repeat(200), u: undefined });
    expect((out.s as string).length).toBe(501);
    expect("u" in out).toBe(false);
    expect(redactArguments(null)).toEqual({});
    expect(redactArguments("x")).toEqual({});
    expect(redactArguments([1, 2])).toEqual({});
  });

  it("limits the number of keys", () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(redactArguments(many)).length).toBe(51);
  });
});
