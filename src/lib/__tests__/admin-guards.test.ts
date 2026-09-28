import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { adminUserIds, applyActive, assignCreatedUserRoles, removesLastAdmin, syncRoles } from "../admin-guards";
import { setErrorLogger } from "../app-error";

// Tiny in-memory stand-in for the service-role client (synthetic data only).
function fakeSb(init: { roles: Array<{ id: string; user_id: string; role: string }>; failAdminLookup?: boolean; failInsert?: boolean }) {
  const roles = [...init.roles];
  const calls: string[] = [];
  const sb = {
    from(table: string) {
      const q: any = { table, filters: [] as Array<[string, unknown]> };
      q.select = () => q;
      q.eq = (col: string, val: unknown) => { q.filters.push([col, val]); return q; };
      q.then = (res: any) => {
        if (table === "user_roles") {
          if (init.failAdminLookup && q.filters.some(([c, v]: any) => c === "role" && v === "admin")) return res({ data: null, error: { message: "boom" } });
          const rows = roles.filter((r) => q.filters.every(([c, v]: any) => (r as any)[c] === v));
          return res({ data: rows, error: null });
        }
        return res({ data: null, error: null });
      };
      q.delete = () => ({ in: async (_c: string, ids: string[]) => { calls.push(`delete:${ids.join(",")}`); for (const id of ids) roles.splice(roles.findIndex((r) => r.id === id), 1); return { error: null }; } });
      q.insert = async (rows: any[]) => {
        calls.push(`insert:${rows.map((r) => r.role).join(",")}`);
        if (init.failInsert) return { error: { message: "insert failed", code: "23502" } };
        rows.forEach((r, i) => roles.push({ id: `n${i}`, ...r }));
        return { error: null };
      };
      q.update = (v: any) => ({ eq: async () => { calls.push(`update:${table}:${JSON.stringify(v)}`); return { error: null }; } });
      return q;
    },
    auth: { admin: { updateUserById: async (_id: string, v: any) => { calls.push(`ban:${v.ban_duration}`); return { error: null }; } } },
  };
  return { sb, roles, calls };
}

let prev: (l: string) => void;
beforeEach(() => { prev = setErrorLogger(() => {}); });
afterEach(() => { setErrorLogger(prev); });

describe("admin guards", () => {
  it("removesLastAdmin rule", () => {
    expect(removesLastAdmin(new Set(["a"]), "a", false)).toBe(true);
    expect(removesLastAdmin(new Set(["a"]), "a", true)).toBe(false);
    expect(removesLastAdmin(new Set(["a", "b"]), "a", false)).toBe(false);
    expect(removesLastAdmin(new Set(["a"]), "z", false)).toBe(false);
  });

  it("a failed admin lookup blocks the change (it used to look like 'no admins' and pass)", async () => {
    const { sb } = fakeSb({ roles: [{ id: "1", user_id: "a", role: "admin" }], failAdminLookup: true });
    await expect(adminUserIds(sb)).rejects.toThrow(/Something went wrong/);
    await expect(syncRoles(sb, "a", ["viewer"])).rejects.toThrow(/Something went wrong/);
    await expect(applyActive(sb, "a", false, "caller")).rejects.toThrow(/Something went wrong/);
  });

  it("syncRoles refuses to remove the last admin", async () => {
    const { sb, calls } = fakeSb({ roles: [{ id: "1", user_id: "a", role: "admin" }] });
    await expect(syncRoles(sb, "a", ["viewer"])).rejects.toThrow("Cannot remove the last Super Admin.");
    expect(calls).toEqual([]);
  });

  it("syncRoles inserts missing roles before it deletes removed ones", async () => {
    const { sb, calls, roles } = fakeSb({ roles: [
      { id: "1", user_id: "a", role: "admin" }, { id: "2", user_id: "b", role: "admin" }, { id: "3", user_id: "b", role: "viewer" },
    ] });
    await syncRoles(sb, "b", ["finance", "viewer", "finance"]);
    expect(calls).toEqual(["insert:finance", "delete:2"]);
    expect(roles.filter((r) => r.user_id === "b").map((r) => r.role).sort()).toEqual(["finance", "viewer"]);
  });

  it("an insert failure leaves the roles the user already has", async () => {
    const before = [
      { id: "1", user_id: "a", role: "admin" }, { id: "2", user_id: "b", role: "admin" }, { id: "3", user_id: "b", role: "viewer" },
    ];
    const { sb, calls, roles } = fakeSb({ roles: before, failInsert: true });
    await expect(syncRoles(sb, "b", ["finance"])).rejects.toThrow(/A required value is missing/);
    expect(calls).toEqual(["insert:finance"]);
    expect(roles).toEqual(before);
  });

  it("assignCreatedUserRoles disables the new account when role sync fails, and does not remove the default role", async () => {
    const { sb, calls, roles } = fakeSb({
      roles: [{ id: "1", user_id: "a", role: "admin" }, { id: "3", user_id: "n", role: "viewer" }],
      failInsert: true,
    });
    await expect(assignCreatedUserRoles(sb, "n", ["finance"])).rejects.toThrow(/A required value is missing/);
    expect(calls).toEqual(["insert:finance", 'update:profiles:{"is_active":false}', "ban:876000h"]);
    expect(roles.filter((r) => r.user_id === "n").map((r) => r.role)).toEqual(["viewer"]);
  });

  it("assignCreatedUserRoles does not disable when the last-admin guard refuses before any write", async () => {
    const { sb, calls, roles } = fakeSb({ roles: [{ id: "1", user_id: "a", role: "admin" }] });
    await expect(assignCreatedUserRoles(sb, "a", ["viewer"])).rejects.toThrow("Cannot remove the last Super Admin.");
    expect(calls).toEqual([]);
    expect(roles).toEqual([{ id: "1", user_id: "a", role: "admin" }]);
  });

  it("adminCreateUser assigns roles through assignCreatedUserRoles and does not delete every role first", () => {
    const code = readFileSync(path.resolve(__dirname, "../admin.functions.ts"), "utf8");
    const start = code.indexOf("export const adminCreateUser");
    const end = code.indexOf("export const adminSetUserActive");
    const block = code.slice(start, end);
    expect(block).toContain("await assignCreatedUserRoles(supabaseAdmin, newUserId, data.roles)");
    expect(block).not.toMatch(/from\("user_roles"\)\.delete\(\)/);
  });

  it("applyActive: cannot disable yourself or the last admin; disabling bans, enabling unbans", async () => {
    const one = fakeSb({ roles: [{ id: "1", user_id: "a", role: "admin" }] });
    await expect(applyActive(one.sb, "a", false, "a")).rejects.toThrow("You cannot disable your own account.");
    await expect(applyActive(one.sb, "a", false, "caller")).rejects.toThrow("Cannot disable the last Super Admin.");
    const two = fakeSb({ roles: [{ id: "1", user_id: "a", role: "admin" }, { id: "2", user_id: "b", role: "ops_user" }] });
    await applyActive(two.sb, "b", false, "a");
    await applyActive(two.sb, "b", true, "a");
    expect(two.calls).toEqual(['update:profiles:{"is_active":false}', "ban:876000h", 'update:profiles:{"is_active":true}', "ban:none"]);
  });
});
