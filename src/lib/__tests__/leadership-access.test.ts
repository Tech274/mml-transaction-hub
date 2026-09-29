import { describe, expect, it } from "vitest";
import {
  canLeadershipOpenRoute,
  isLeadershipAllowedPath,
  isLeadershipOnlyRoleSet,
} from "@/lib/leadership-access";

describe("leadership access policy", () => {
  it("detects leadership-only role sets", () => {
    expect(isLeadershipOnlyRoleSet(["leadership"])).toBe(true);
    expect(isLeadershipOnlyRoleSet(["admin", "leadership"])).toBe(false);
    expect(isLeadershipOnlyRoleSet(["admin"])).toBe(false);
  });

  it("allows only dashboard and customer drill-down routes", () => {
    expect(isLeadershipAllowedPath("/dashboard")).toBe(true);
    expect(isLeadershipAllowedPath("/customers")).toBe(true);
    expect(isLeadershipAllowedPath("/customers/details")).toBe(true);
    expect(isLeadershipAllowedPath("/public-cloud")).toBe(false);
    expect(isLeadershipAllowedPath("/tickets")).toBe(false);
    expect(isLeadershipAllowedPath("/ai-command-center")).toBe(false);
  });

  it("keeps the routing helper in sync with allowed path checks", () => {
    expect(canLeadershipOpenRoute("/dashboard")).toBe(true);
    expect(canLeadershipOpenRoute("/customers")).toBe(true);
    expect(canLeadershipOpenRoute("/reports")).toBe(false);
  });
});
