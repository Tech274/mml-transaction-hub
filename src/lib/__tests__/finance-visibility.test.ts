import { describe, expect, it } from "vitest";
import {
  FINANCE_TOTAL_ROLES,
  canViewFinanceTotalsForRoles,
  normalizeAppRoles,
} from "../finance-visibility";

describe("finance visibility defaults", () => {
  it("keeps finance totals scoped to admin + leadership + finance", () => {
    expect(FINANCE_TOTAL_ROLES).toEqual(["admin", "leadership", "finance"]);
  });

  it("normalizes role rows and drops unknown values", () => {
    expect(normalizeAppRoles(["viewer", "admin", "viewer", "bogus"])).toEqual(["viewer", "admin"]);
  });

  it("allows totals only when at least one finance-visible role is present", () => {
    expect(canViewFinanceTotalsForRoles(["viewer"])).toBe(false);
    expect(canViewFinanceTotalsForRoles(["ops_user", "ops_lead"])).toBe(false);
    expect(canViewFinanceTotalsForRoles(["finance"])).toBe(true);
    expect(canViewFinanceTotalsForRoles(["viewer", "leadership"])).toBe(true);
  });
});
