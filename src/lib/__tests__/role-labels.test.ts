import { describe, expect, it } from "vitest";
import type { AppRole } from "@/lib/auth-context";
import {
  NO_ROLE_LABEL,
  ROLE_LABEL,
  ROLE_ORDER,
  primaryRole,
  primaryRoleLabel,
  roleLabel,
} from "@/lib/role-labels";

const ALL_ROLES: AppRole[] = ["admin", "leadership", "finance", "ops_lead", "ops_user", "viewer"];

describe("role labels (SCRUM-128 §3.3, N8)", () => {
  it("has exactly one label per role, all different", () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...ALL_ROLES].sort());
    expect(new Set(Object.values(ROLE_LABEL)).size).toBe(ALL_ROLES.length);
    expect([...ROLE_ORDER].sort()).toEqual([...ALL_ROLES].sort());
  });

  it("never shows a raw role key", () => {
    for (const role of ALL_ROLES) {
      const label = roleLabel(role);
      expect(label).not.toMatch(/_/);
      expect(label).not.toBe(role);
    }
    expect(Object.values(ROLE_LABEL)).not.toContain("super_admin");
    expect(roleLabel("admin")).toBe("Super Admin");
  });

  it("shows a user's highest role, the same one the Dashboard shows", () => {
    expect(primaryRole(["viewer", "admin"])).toBe("admin");
    expect(primaryRole(["ops_user", "ops_lead"])).toBe("ops_lead");
    expect(primaryRoleLabel(["finance", "viewer"])).toBe("Finance");
  });

  it("says 'No role' when there is none and keeps unknown values visible", () => {
    expect(primaryRole([])).toBeNull();
    expect(primaryRoleLabel([])).toBe(NO_ROLE_LABEL);
    expect(roleLabel(undefined)).toBe(NO_ROLE_LABEL);
    expect(roleLabel("auditor")).toBe("auditor");
  });
});
