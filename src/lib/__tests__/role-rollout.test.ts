import { describe, expect, it } from "vitest";
import { ASSIGNABLE_ROLES, LIVE_ROLES, PARKED_ROLES, isParkedRole } from "@/lib/role-rollout";

describe("role rollout configuration", () => {
  it("keeps only super admin and leadership live", () => {
    expect(LIVE_ROLES).toEqual(["admin", "leadership"]);
  });

  it("parks non-live personas and excludes them from assignment", () => {
    expect(PARKED_ROLES).toEqual(["finance", "ops_lead", "ops_user", "viewer"]);
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "leadership"]);
    expect(PARKED_ROLES.every((role) => !ASSIGNABLE_ROLES.includes(role))).toBe(true);
  });

  it("identifies parked roles correctly", () => {
    expect(isParkedRole("finance")).toBe(true);
    expect(isParkedRole("ops_lead")).toBe(true);
    expect(isParkedRole("admin")).toBe(false);
  });
});
