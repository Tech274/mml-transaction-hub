import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hasAnyRole, requireRole, PERMISSION_CHECK_FAILED } from "../require-role";
import { AppError, setErrorLogger } from "../app-error";

const ctx = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn(async () => result);
  return { ctx: { supabase: { rpc }, userId: "00000000-0000-0000-0000-000000000001" }, rpc };
};
let prev: (l: string) => void;
beforeEach(() => { prev = setErrorLogger(() => {}); });
afterEach(() => { setErrorLogger(prev); });

describe("hasAnyRole / requireRole", () => {
  it("asks the database with has_any_role and the caller id", async () => {
    const { ctx: c, rpc } = ctx({ data: true, error: null });
    expect(await hasAnyRole(c, ["admin", "ops_lead"])).toBe(true);
    expect(rpc).toHaveBeenCalledWith("has_any_role", { _user_id: c.userId, _roles: ["admin", "ops_lead"] });
  });
  it("only a literal true counts as allowed (fails closed)", async () => {
    for (const data of [false, null, undefined, "true", 1]) {
      expect(await hasAnyRole(ctx({ data, error: null }).ctx, ["admin"])).toBe(false);
    }
  });
  it("a failed lookup is an error, never 'allowed' and never a silent 'denied'", async () => {
    const p = hasAnyRole(ctx({ data: true, error: { message: "db down" } }).ctx, ["admin"]);
    await expect(p).rejects.toBeInstanceOf(AppError);
    await expect(hasAnyRole(ctx({ data: null, error: { message: "x" } }).ctx, ["admin"])).rejects.toThrow(PERMISSION_CHECK_FAILED);
  });
  it("requireRole throws the given message when the role is missing", async () => {
    await expect(requireRole(ctx({ data: false, error: null }).ctx, ["admin"], "Forbidden: admin only")).rejects.toThrow("Forbidden: admin only");
    await expect(requireRole(ctx({ data: true, error: null }).ctx, ["admin"], "x")).resolves.toBeUndefined();
  });
  it("an empty role list never grants access and does not call the database", async () => {
    const { ctx: c, rpc } = ctx({ data: true, error: null });
    expect(await hasAnyRole(c, [])).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
