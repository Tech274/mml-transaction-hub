// SCRUM-59: MCP tool wrapper fails closed on the revocation check and never sends raw DB text.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setErrorLogger } from "../app-error";

type Res = { data: unknown; error: unknown };
const state: { revoked: Res; inserts: Record<string, unknown>[] } = { revoked: { data: null, error: null }, inserts: [] };

vi.mock("../mcp/supabase-for-user", () => ({
  supabaseForUser: () => ({
    from: (table: string) => {
      if (table === "mcp_tool_audit_log") {
        return { insert: async (row: Record<string, unknown>) => { state.inserts.push(row); return { error: null }; } };
      }
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => state.revoked };
      return chain;
    },
  }),
}));

const { withAudit, REVOCATION_CHECK_FAILED } = await import("../mcp/audit");
const { toolDbError } = await import("../mcp/errors");

const ctx = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    isAuthenticated: () => true,
    getUserId: () => "00000000-0000-4000-8000-000000000001",
    getUserEmail: () => "u@example.test",
    getClientId: () => "client-1",
    getToken: () => "t",
    ...over,
  }) as never;

const ok = async () => ({ content: [{ type: "text" as const, text: "fine" }] });
let prev: (l: string) => void;
beforeEach(() => {
  state.revoked = { data: null, error: null };
  state.inserts = [];
  prev = setErrorLogger(() => {});
});
afterEach(() => { setErrorLogger(prev); });

describe("withAudit revocation check", () => {
  it("runs the tool when the client is not revoked, and audits it", async () => {
    const fn = vi.fn(ok);
    const r = await withAudit("t", fn)({}, ctx());
    expect(fn).toHaveBeenCalledOnce();
    expect(r.isError).toBeUndefined();
    expect(state.inserts[0]).toMatchObject({ tool_name: "t", success: true, client_id: "client-1" });
  });
  it("refuses when the client is revoked", async () => {
    state.revoked = { data: { client_id: "client-1" }, error: null };
    const fn = vi.fn(ok);
    const r = await withAudit("t", fn)({}, ctx());
    expect(fn).not.toHaveBeenCalled();
    expect(r.structuredContent?.error).toMatchObject({ code: "revoked" });
  });
  it("fails CLOSED when the revocation lookup errors (used to run the tool anyway)", async () => {
    state.revoked = { data: null, error: { message: 'relation "mcp_revoked_clients" does not exist', code: "42P01" } };
    const fn = vi.fn(ok);
    const r = await withAudit("t", fn)({}, ctx());
    expect(fn).not.toHaveBeenCalled();
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(REVOCATION_CHECK_FAILED);
    expect(r.content[0].text).not.toContain("mcp_revoked_clients");
    expect(state.inserts[0]).toMatchObject({ success: false, error_code: "internal" });
  });
  it("unauthenticated calls never reach the tool", async () => {
    const fn = vi.fn(ok);
    const r = await withAudit("t", fn)({}, ctx({ isAuthenticated: () => false }));
    expect(fn).not.toHaveBeenCalled();
    expect(r.structuredContent?.error).toMatchObject({ code: "unauthenticated" });
  });
  it("a thrown error reaches the client as a generic message with a ref; raw text only in the audit row", async () => {
    const r = await withAudit("t", async () => { throw new Error('column "secret_col" of relation "transactions" does not exist'); })({}, ctx());
    expect(r.content[0].text).not.toContain("secret_col");
    expect(r.content[0].text).toMatch(/ref [0-9A-F]{8}/);
    expect(String(state.inserts[0].error_message)).toContain("secret_col");
  });
});

describe("toolDbError", () => {
  it("maps permission errors and hides database names", () => {
    const e = toolDbError({ code: "42501", message: 'permission denied for table transactions' }, "x");
    expect(e.structuredContent.error.code).toBe("permission_denied");
    expect(e.content[0].text).not.toContain("transactions");
    const i = toolDbError({ code: "23505", message: 'duplicate key value violates unique constraint "customers_pkey"' }, "x");
    expect(i.structuredContent.error.code).toBe("internal");
    expect(i.content[0].text).not.toContain("customers_pkey");
    expect(i.content[0].text).toMatch(/\(ref [0-9A-F]{8}\)/);
  });
});

const src = import.meta.glob("/src/lib/mcp/tools/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
describe("tools", () => {
  it.each(Object.keys(src))("%s never returns error.message to the client", (f) => {
    expect(src[f]).not.toMatch(/makeError\([^)]*error\.message/);
    expect(src[f]).toContain("annotations: { readOnlyHint: true");
  });
});
