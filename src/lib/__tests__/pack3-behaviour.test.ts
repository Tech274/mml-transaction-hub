// SCRUM-80: characterisation tests for "Pack 3" (roadmap.md: preview-only items
// 3A Super Admin user management + RBAC, 3B bulk import apply loop). They pin
// today's behaviour so a change is deliberate. See docs/pack3-preview.md.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({}) }));

const src = import.meta.glob(["/src/lib/admin.functions.ts", "/src/components/bulk-import.tsx", "/src/routes/_authenticated/entry.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("3A: every admin server function checks admin on the server first", () => {
  const code = src["/src/lib/admin.functions.ts"];
  const blocks = code.split(/(?=export const \w+ = createServerFn)/).filter((b) => b.startsWith("export const"));
  it("finds the five admin functions the Admin screen uses", () => {
    const names = blocks.map((b) => b.match(/export const (\w+)/)![1]).sort();
    expect(names).toEqual(["adminCreateUser", "adminDeleteUser", "adminResetPassword", "adminSetUserActive", "adminUpdateUserProfile"]);
  });
  it.each(["adminCreateUser", "adminDeleteUser", "adminResetPassword", "adminSetUserActive", "adminUpdateUserProfile"])(
    "%s: requires sign-in and calls assertAdmin before using the service-role client",
    (name) => {
      const b = blocks.find((x) => x.startsWith(`export const ${name} `))!;
      expect(b).toContain(".middleware([requireSupabaseAuth])");
      const guard = b.indexOf("await assertAdmin(context)");
      const admin = b.indexOf("supabaseAdmin");
      expect(guard).toBeGreaterThan(-1);
      expect(admin === -1 || guard < admin).toBe(true);
    },
  );
  it("self-protection rules exist (cannot disable yourself; last Super Admin protected)", () => {
    expect(code).toContain("You cannot disable your own account.");
    expect(code).toMatch(/assertNotLastAdmin\(supabaseAdmin, data\.userId, false, "disable"/);
    expect(code).toMatch(/applyActive\(supabaseAdmin, data\.userId, false, context\.userId\)/);
    expect(code).not.toContain("auth.admin.deleteUser");
  });
});

describe("3A: RBAC admin permission group", () => {
  it("admin-only keys are exactly the 'Admin' group and exist in the matrix", async () => {
    const { PERMISSIONS, ADMIN_ONLY_PERM_KEYS } = await import("@/lib/permissions");
    const adminGroup = PERMISSIONS.filter((p) => p.group === "Admin").map((p) => p.key).sort();
    expect([...ADMIN_ONLY_PERM_KEYS].sort()).toEqual(adminGroup);
    expect(new Set(PERMISSIONS.map((p) => p.key)).size).toBe(PERMISSIONS.length);
  });
});

describe("3B: legacy bulk import is insert-only", () => {
  const code = src["/src/components/bulk-import.tsx"];
  it("inserts every non-blank row and does not match on potential_id + month + year + lab_name", () => {
    expect(code).not.toMatch(/const \{ data: match/);
    expect(code).not.toMatch(/\.eq\("potential_id"/);
    expect(code).not.toMatch(/\.update\(partial as never\)/);
    expect(code).toMatch(/from\("transactions"\)\.insert\(fullPayload as never\)/);
    expect(code).toMatch(/Every non-blank row is a new transaction/);
  });
  it("has no duplicate-strategy picker and no preset UI", () => {
    expect(code).not.toMatch(/bulk_import_presets/);
    expect(code).not.toMatch(/Save preset/);
    expect(code).not.toMatch(/setDupStrategy/);
    expect(code).not.toMatch(/duplicate choices/);
  });
});

describe("3B: strict import is the only UI import path", () => {
  const code = src["/src/routes/_authenticated/entry.tsx"];
  it("keeps StrictImport and removes the Legacy import tab", () => {
    expect(code).toContain("<StrictImport />");
    expect(code).not.toContain("Legacy import");
    expect(code).not.toContain("<BulkImport />");
    expect(code).not.toContain("value=\"legacy\"");
  });
});
