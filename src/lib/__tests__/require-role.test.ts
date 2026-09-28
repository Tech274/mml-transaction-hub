import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SupabaseClient } from "@supabase/supabase-js";
import { hasAnyRole, requireRole, PERMISSION_CHECK_FAILED, ACCOUNT_DISABLED_MESSAGE } from "../require-role";
import { AppError, setErrorLogger } from "../app-error";

const ctx = (
  result: { data: unknown; error: unknown },
  profile: { data: unknown; error: unknown } = { data: { is_active: true }, error: null },
) => {
  const rpc = vi.fn(async () => result);
  const maybeSingle = vi.fn(async () => profile);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table !== "profiles") throw new Error(`unexpected table ${table}`);
    return { select };
  });
  return {
    ctx: { supabase: { rpc, from }, userId: "00000000-0000-0000-0000-000000000001" },
    rpc,
    from,
    select,
    eq,
  };
};
let prev: (l: string) => void;
beforeEach(() => { prev = setErrorLogger(() => {}); });
afterEach(() => { setErrorLogger(prev); });

describe("hasAnyRole / requireRole", () => {
  it("asks the database with has_any_role and the caller id, and reads the caller's profile", async () => {
    const { ctx: c, rpc, from, select, eq } = ctx({ data: true, error: null });
    expect(await hasAnyRole(c, ["admin", "ops_lead"])).toBe(true);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("is_active");
    expect(eq).toHaveBeenCalledWith("id", c.userId);
    expect(rpc).toHaveBeenCalledWith("has_any_role", { _user_id: c.userId, _roles: ["admin", "ops_lead"] });
  });
  it("only a literal true counts as allowed (fails closed)", async () => {
    for (const data of [false, null, undefined, "true", 1]) {
      expect(await hasAnyRole(ctx({ data, error: null }).ctx, ["admin"])).toBe(false);
    }
  });
  it("an active profile is required: inactive throws a clear message and does not check roles", async () => {
    const { ctx: c, rpc } = ctx({ data: true, error: null }, { data: { is_active: false }, error: null });
    const p = hasAnyRole(c, ["admin"]);
    await expect(p).rejects.toBeInstanceOf(AppError);
    await expect(p).rejects.toThrow(ACCOUNT_DISABLED_MESSAGE);
    await expect(requireRole(c, ["admin"], "Forbidden: admin only")).rejects.toThrow(ACCOUNT_DISABLED_MESSAGE);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a missing profile is not allowed and is not reported as a disabled account", async () => {
    const { ctx: c, rpc } = ctx({ data: true, error: null }, { data: null, error: null });
    expect(await hasAnyRole(c, ["admin"])).toBe(false);
    await expect(requireRole(c, ["admin"], "Forbidden: admin only")).rejects.toThrow("Forbidden: admin only");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a profile lookup error is an error, never 'allowed'", async () => {
    const { ctx: c, rpc } = ctx({ data: true, error: null }, { data: null, error: { message: "db down" } });
    const p = hasAnyRole(c, ["admin"]);
    await expect(p).rejects.toBeInstanceOf(AppError);
    await expect(p).rejects.toThrow(PERMISSION_CHECK_FAILED);
    await expect(p).rejects.toThrow(/\(ref [0-9A-F]+\)/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a failed role lookup is an error, never 'allowed' and never a silent 'denied'", async () => {
    const p = hasAnyRole(ctx({ data: true, error: { message: "db down" } }).ctx, ["admin"]);
    await expect(p).rejects.toBeInstanceOf(AppError);
    await expect(hasAnyRole(ctx({ data: null, error: { message: "x" } }).ctx, ["admin"])).rejects.toThrow(PERMISSION_CHECK_FAILED);
  });
  it("requireRole throws the given message when the role is missing", async () => {
    await expect(requireRole(ctx({ data: false, error: null }).ctx, ["admin"], "Forbidden: admin only")).rejects.toThrow("Forbidden: admin only");
    await expect(requireRole(ctx({ data: true, error: null }).ctx, ["admin"], "x")).resolves.toBeUndefined();
  });
  it("calls SupabaseClient.from on the instance; a detached from() throws", async () => {
    // Real SupabaseClient.from / rpc read `this.rest`. A subclass only stubs rest
    // so the methods under test are the library's, not a lookalike.
    class TestClient extends SupabaseClient {
      readonly fromSpy = vi.fn((_relation: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_active: true }, error: null }) }) }),
      }));
      constructor() {
        super("http://127.0.0.1:54321", "public-anon-key-test", {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        const rest = this.rest as unknown as { from: TestClient["fromSpy"]; rpc: () => Promise<{ data: boolean; error: null }> };
        rest.from = this.fromSpy;
        rest.rpc = async () => ({ data: true, error: null });
      }
    }
    const client = new TestClient();
    try {
      expect(client.from).toBe(SupabaseClient.prototype.from);
      const detached = client.from;
      expect(() => detached("profiles")).toThrow(TypeError);
      const c = { supabase: client, userId: "00000000-0000-0000-0000-000000000001" };
      expect(await hasAnyRole(c, ["admin"])).toBe(true);
      expect(client.fromSpy).toHaveBeenCalledWith("profiles");
      await expect(requireRole(c, ["admin"], "x")).resolves.toBeUndefined();
    } finally {
      client.realtime.disconnect();
    }
  });
  it("an empty role list never grants access and does not call the database", async () => {
    const { ctx: c, rpc, from } = ctx({ data: true, error: null });
    expect(await hasAnyRole(c, [])).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
