import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  HookTimeoutError,
  hookTimeoutMsFromEnv,
  respondThenRun,
  withTimeout,
} from "../background-hook";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function req(waitUntil?: (p: Promise<unknown>) => void): Request {
  const r = new Request("https://example.test/api/public/hooks/freshdesk-sync", { method: "POST" });
  if (waitUntil) (r as unknown as { waitUntil: unknown }).waitUntil = waitUntil;
  return r;
}

describe("hookTimeoutMsFromEnv", () => {
  it("defaults to 25 s (under Cloudflare's ~30 s limit for work after the response)", () => {
    expect(DEFAULT_HOOK_TIMEOUT_SECONDS).toBe(25);
    expect(hookTimeoutMsFromEnv({})).toBe(25_000);
    expect(hookTimeoutMsFromEnv({ HOOK_TIMEOUT_SECONDS: "" })).toBe(25_000);
  });
  it("accepts whole seconds from 5 to 900", () => {
    expect(hookTimeoutMsFromEnv({ HOOK_TIMEOUT_SECONDS: "5" })).toBe(5_000);
    expect(hookTimeoutMsFromEnv({ HOOK_TIMEOUT_SECONDS: " 120 " })).toBe(120_000);
    expect(hookTimeoutMsFromEnv({ HOOK_TIMEOUT_SECONDS: "900" })).toBe(900_000);
  });
  it("logs and falls back to the default on a bad value (the job still runs)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const v of ["4", "901", "2.5", "abc", "-1"]) expect(hookTimeoutMsFromEnv({ HOOK_TIMEOUT_SECONDS: v })).toBe(25_000);
    expect(err).toHaveBeenCalledTimes(5);
  });
});

describe("withTimeout", () => {
  it("resolves with the job's value when it finishes in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "job")).resolves.toBe(7);
  });
  it("rejects with HookTimeoutError when the job overruns", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 25_000, "freshdesk-sync");
    vi.advanceTimersByTime(25_000);
    await expect(p).rejects.toThrow(HookTimeoutError);
    await expect(p).rejects.toThrow("freshdesk-sync did not finish within 25 s");
  });
});

describe("respondThenRun: background mode (host has waitUntil)", () => {
  it("replies 202 before the job finishes and hands the job to waitUntil", async () => {
    const handed: Promise<unknown>[] = [];
    let finish!: (v: { ok: boolean; body: unknown }) => void;
    const run = vi.fn(() => new Promise<{ ok: boolean; body: unknown }>((r) => (finish = r)));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await respondThenRun(req((p) => handed.push(p)), { name: "freshdesk-sync", timeoutMs: 25_000, run });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, job: "freshdesk-sync", mode: "background", timeout_seconds: 25 });
    expect(handed).toHaveLength(1);
    finish({ ok: true, body: { upserted: 3 } });
    await handed[0];
    expect(log).toHaveBeenCalledWith("[hooks] freshdesk-sync finished:", JSON.stringify({ upserted: 3 }));
  });

  it("passes the job a deadline of now + timeout", async () => {
    const run = vi.fn(async (_deadline: number) => ({ ok: true, body: {} }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const handed: Promise<unknown>[] = [];
    await respondThenRun(req((p) => handed.push(p)), { name: "j", timeoutMs: 25_000, run }, () => 1_000_000);
    await handed[0];
    expect(run).toHaveBeenCalledWith(1_025_000);
  });

  it("a failing or throwing job is logged, never an unhandled rejection", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const handed: Promise<unknown>[] = [];
    await respondThenRun(req((p) => handed.push(p)), { name: "a", timeoutMs: 5000, run: async () => ({ ok: false, body: { error_message: "boom" } }) });
    await respondThenRun(req((p) => handed.push(p)), { name: "b", timeoutMs: 5000, run: async () => { throw new Error("kaput"); } });
    await Promise.all(handed);
    expect(err).toHaveBeenCalledWith("[hooks] a failed:", JSON.stringify({ error_message: "boom" }));
    expect(err).toHaveBeenCalledWith("[hooks] b failed:", "kaput");
  });
});

describe("respondThenRun: inline fallback (no waitUntil)", () => {
  it("runs the job and returns its result like before (200 / 500)", async () => {
    const ok = await respondThenRun(req(), { name: "j", timeoutMs: 5000, run: async () => ({ ok: true, body: { status: "success" } }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "success" });
    const bad = await respondThenRun(req(), { name: "j", timeoutMs: 5000, run: async () => ({ ok: false, body: { status: "error" } }) });
    expect(bad.status).toBe(500);
  });

  it("returns 504 if the job ignores its deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const p = respondThenRun(req(), { name: "slow", timeoutMs: 5000, run: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(7000); // timeout + 2 s grace
    const res = await p;
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ ok: false, job: "slow", error: "slow did not finish within 7 s" });
  });
});

describe("hooks use it (source check)", () => {
  const hooks = import.meta.glob("../../routes/api/public/hooks/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  it("finds the three scheduled hooks", () => {
    expect(Object.keys(hooks).map((k) => k.split("/").pop()).sort()).toEqual(["bulk-import-cleanup.ts", "freshdesk-sync.ts", "mcp-sync.ts"]);
  });
  it.each(Object.entries(hooks))("%s checks the cron secret first, then replies via respondThenRun", (_path, src) => {
    const auth = src.indexOf("isAuthorizedCronRequest(request)");
    const run = src.indexOf("respondThenRun(request,");
    expect(auth).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(auth);
    expect(src).toMatch(/timeoutMs: hookTimeoutMsFromEnv\(process\.env\)/);
  });
  it("the Freshdesk hook passes the deadline into the sync", () => {
    const src = Object.entries(hooks).find(([k]) => k.endsWith("freshdesk-sync.ts"))![1];
    expect(src).toMatch(/runFreshdeskSync\(\{ trigger_source: "cron", deadline \}\)/);
  });
});
