// SCRUM-60: guard rails so secrets never end up in browser code or in the repo.
// Reads the source text of every file under src/ via Vite's import.meta.glob.
import { describe, it, expect } from "vitest";

const files = import.meta.glob(["/src/**/*.{ts,tsx}", "!/src/**/__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SERVER_ONLY_SECRETS: Record<string, string[]> = {
  SUPABASE_SERVICE_ROLE_KEY: ["/src/integrations/supabase/client.server.ts"],
  FRESHDESK_API_KEY: ["/src/lib/freshdesk.server.ts"],
};

describe("secrets stay server-side", () => {
  it("scans a realistic number of files", () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
  });

  for (const [name, allowed] of Object.entries(SERVER_ONLY_SECRETS)) {
    it(`${name} is read only in ${allowed.join(", ")}`, () => {
      const readers = Object.entries(files)
        .filter(([, src]) => new RegExp(`process\\.env\\.${name}\\b|env\\[["']${name}["']\\]`).test(src))
        .map(([p]) => p);
      expect(readers.sort()).toEqual([...allowed].sort());
      for (const p of allowed) expect(p.endsWith(".server.ts")).toBe(true);
    });
  }

  it("no VITE_ variable (shipped to the browser) has a secret-looking name", () => {
    const names = new Set<string>();
    for (const src of Object.values(files)) {
      for (const m of src.matchAll(/\bVITE_[A-Z0-9_]+/g)) names.add(m[0]);
    }
    const bad = [...names].filter((n) => /SECRET|SERVICE|PRIVATE|API_KEY|PASSWORD|TOKEN/.test(n));
    expect(bad).toEqual([]);
  });

  it("no hard-coded JWTs, Supabase secret keys or private keys in source", () => {
    const pattern = /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    const hits = Object.entries(files).filter(([, src]) => pattern.test(src)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
});
