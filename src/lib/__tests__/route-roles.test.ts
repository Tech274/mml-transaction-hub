import { describe, it, expect } from "vitest";
import { ROUTE_ROLES, rolesFor, hasAnyOf } from "@/lib/route-roles";

describe("ROUTE_ROLES", () => {
  it("keeps admin pages admin-only", () => {
    expect(rolesFor("/admin")).toEqual(["admin"]);
    expect(rolesFor("/mcp-audit")).toEqual(["admin"]);
  });
  it("never lets viewer or finance open Master ADR Entry", () => {
    expect(ROUTE_ROLES["/entry"]).not.toContain("viewer");
    expect(ROUTE_ROLES["/entry"]).not.toContain("finance");
  });
  it("hides the cost catalog from viewer and shows the lab pages to signed-in roles", () => {
    expect(ROUTE_ROLES["/mml-lab/cost-catalog"]).not.toContain("viewer");
    expect(ROUTE_ROLES["/mml-lab/lab-catalog"]).toContain("viewer");
    expect(ROUTE_ROLES["/mml-lab/batches"]).toContain("finance");
  });
  it("blocks leadership from support, sync and ai command center routes", () => {
    expect(ROUTE_ROLES["/tickets"]).toEqual(["admin"]);
    expect(ROUTE_ROLES["/sync-status"]).toEqual(["admin"]);
    expect(ROUTE_ROLES["/ai-command-center"]).toEqual(["admin"]);
    expect(ROUTE_ROLES["/ai-command-center/agents"]).toEqual(["admin"]);
    expect(ROUTE_ROLES["/ai-command-center/inbox"]).toEqual(["admin"]);
    expect(ROUTE_ROLES["/ai-command-center/run-now"]).toEqual(["admin"]);
    expect(ROUTE_ROLES["/ai-command-center/audit"]).toEqual(["admin"]);
  });
  it("returns a copy, not the shared constant", () => {
    const a = rolesFor("/admin");
    a.push("viewer");
    expect(rolesFor("/admin")).toEqual(["admin"]);
  });
});

describe("hasAnyOf", () => {
  it("is true when any required role is held", () => {
    expect(hasAnyOf(["viewer", "ops_user"], ["admin", "ops_user"])).toBe(true);
  });
  it("is false for a user with no roles", () => {
    expect(hasAnyOf([], ["admin"])).toBe(false);
  });
});
