import { describe, it, expect } from "vitest";
import { canClaimAgent, normalizeEmail, TICKET_OPS_ROLES } from "@/lib/ticket-access";

// Synthetic people only.
const agent = { id: 101, email: "Alex.Agent@example.test" };

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => expect(normalizeEmail("  A@B.test ")).toBe("a@b.test"));
  it("treats blank as null", () => expect(normalizeEmail("  ")).toBeNull());
});

describe("canClaimAgent", () => {
  it("allows a user whose sign-in email matches the agent (case-insensitive)", () => {
    expect(canClaimAgent({ callerEmail: "alex.agent@EXAMPLE.test", isAdmin: false, agent })).toEqual({ ok: true });
  });
  it("blocks a user claiming someone else's agent", () => {
    const r = canClaimAgent({ callerEmail: "someone.else@example.test", isAdmin: false, agent });
    expect(r.ok).toBe(false);
  });
  it("blocks when the caller has no email", () => {
    expect(canClaimAgent({ callerEmail: null, isAdmin: false, agent }).ok).toBe(false);
  });
  it("blocks when the agent has no email in Freshdesk", () => {
    expect(canClaimAgent({ callerEmail: "alex.agent@example.test", isAdmin: false, agent: { id: 1, email: null } }).ok).toBe(false);
  });
  it("blocks an agent id that is not in the directory, even for admins", () => {
    expect(canClaimAgent({ callerEmail: "admin@example.test", isAdmin: true, agent: undefined }).ok).toBe(false);
  });
  it("lets admins choose any existing agent", () => {
    expect(canClaimAgent({ callerEmail: "admin@example.test", isAdmin: true, agent })).toEqual({ ok: true });
  });
});

describe("TICKET_OPS_ROLES", () => {
  it("does not include viewer, finance or leadership", () => {
    expect(TICKET_OPS_ROLES).toEqual(["admin", "ops_lead", "ops_user"]);
  });
});
