import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractCronToken, CRON_SECRET_HEADER, CLEANUP_RETENTION_DAYS } from "@/lib/cron-auth";

// Synthetic values only. None of these are real secrets.
const GOOD = "a".repeat(64);

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => rpc(...args) },
}));

function req(headers: Record<string, string>) {
  return new Request("https://example.test/api/public/hooks/mcp-sync", { method: "POST", headers });
}

describe("extractCronToken", () => {
  it("returns null when the header is missing", () => {
    expect(extractCronToken(new Headers())).toBeNull();
  });
  it("ignores the public apikey header entirely", () => {
    expect(extractCronToken(new Headers({ apikey: GOOD }))).toBeNull();
  });
  it("rejects tokens shorter than 32 chars", () => {
    expect(extractCronToken(new Headers({ [CRON_SECRET_HEADER]: "short-token" }))).toBeNull();
  });
  it("rejects tokens containing whitespace", () => {
    expect(extractCronToken(new Headers({ [CRON_SECRET_HEADER]: `${"a".repeat(20)} ${"b".repeat(20)}` }))).toBeNull();
  });
  it("trims surrounding whitespace and returns the token", () => {
    expect(extractCronToken(new Headers({ [CRON_SECRET_HEADER]: `  ${GOOD} ` }))).toBe(GOOD);
  });
  it("keeps retention fixed at 90 days", () => {
    expect(CLEANUP_RETENTION_DAYS).toBe(90);
  });
});

describe("isAuthorizedCronRequest", () => {
  beforeEach(() => rpc.mockReset());

  it("does not call the database when the header is missing", async () => {
    const { isAuthorizedCronRequest } = await import("@/lib/cron-auth.server");
    expect(await isAuthorizedCronRequest(req({ apikey: GOOD }))).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts only when verify_cron_secret returns true", async () => {
    const { isAuthorizedCronRequest } = await import("@/lib/cron-auth.server");
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await isAuthorizedCronRequest(req({ [CRON_SECRET_HEADER]: GOOD }))).toBe(true);
    expect(rpc).toHaveBeenCalledWith("verify_cron_secret", { _token: GOOD });
  });

  it("rejects when verify_cron_secret returns false", async () => {
    const { isAuthorizedCronRequest } = await import("@/lib/cron-auth.server");
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await isAuthorizedCronRequest(req({ [CRON_SECRET_HEADER]: GOOD }))).toBe(false);
  });

  it("fails closed on a database error", async () => {
    const { isAuthorizedCronRequest } = await import("@/lib/cron-auth.server");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    expect(await isAuthorizedCronRequest(req({ [CRON_SECRET_HEADER]: GOOD }))).toBe(false);
    spy.mockRestore();
  });
});
