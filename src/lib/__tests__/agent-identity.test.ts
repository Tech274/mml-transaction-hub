// SCRUM-102 follow-up: identity rows come only from the Freshdesk agent record and are saved by
// the server with the service-role client; failures are logged with a ref, never silent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { identityRow, saveAgentIdentity } from "../agent-identity";
import { setErrorLogger } from "../app-error";

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  setErrorLogger((l) => logged.push(l));
});
afterEach(() => setErrorLogger((l) => console.error(l)));

const fakeDb = (result: { error: unknown } | Error) => {
  const upsert = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const from = vi.fn(() => ({ upsert }));
  return { db: { from }, from, upsert };
};

describe("identityRow", () => {
  it("takes name and id from the Freshdesk agent, trimmed", () => {
    expect(identityRow("u1", { id: 7, name: "  Priya  " }, false)).toEqual({ user_id: "u1", agent_name: "Priya", agent_id: 7, auto_matched: false });
  });
  it("rejects a missing user or an agent without id/name", () => {
    expect(() => identityRow("", { id: 7, name: "x" }, false)).toThrow(/Not signed in/);
    expect(() => identityRow("u1", { id: Number.NaN, name: "x" }, false)).toThrow(/not found/);
    expect(() => identityRow("u1", { id: 7, name: " " }, true)).toThrow(/not found/);
  });
});

describe("saveAgentIdentity", () => {
  const row = identityRow("u1", { id: 7, name: "Priya" }, false);
  it("upserts one row keyed on user_id", async () => {
    const f = fakeDb({ error: null });
    expect(await saveAgentIdentity(f.db, row, "t")).toEqual({ ok: true });
    expect(f.from).toHaveBeenCalledWith("agent_identities");
    expect(f.upsert).toHaveBeenCalledWith(row, { onConflict: "user_id" });
    expect(logged).toEqual([]);
  });
  it("returns a ref and logs when the database refuses", async () => {
    const f = fakeDb({ error: { code: "42501", message: "permission denied for table agent_identities" } });
    const r = await saveAgentIdentity(f.db, row, "freshdesk.setMyAgentIdentity");
    expect(r.ok).toBe(false);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain((r as { ref: string }).ref);
    expect(logged[0]).toContain("freshdesk.setMyAgentIdentity");
  });
  it("returns a ref when the client throws", async () => {
    const r = await saveAgentIdentity(fakeDb(new Error("network down")).db, row, "t");
    expect(r).toMatchObject({ ok: false, ref: expect.stringMatching(/^[0-9A-F]{8}$/) });
  });
});

describe("no browser-token writes to agent_identities remain", () => {
  it("every write in src/ goes through saveAgentIdentity", () => {
    const src = readFileSync(path.resolve(__dirname, "../freshdesk.functions.ts"), "utf8");
    // Reads via the user's client are fine; writes (upsert/insert/update/delete) are not.
    const writes = src.match(/from\("agent_identities"\)\s*\.(upsert|insert|update|delete)\(/g) ?? [];
    expect(writes).toEqual([]);
    expect(src.match(/saveAgentIdentity\(/g)?.length).toBe(2);
  });
});
