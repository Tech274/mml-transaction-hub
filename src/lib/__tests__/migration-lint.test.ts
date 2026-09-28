// SCRUM-64: the migration discipline check (scripts/ci/migration-lint.sh) run against a throwaway
// git repository, so each rule is proven to pass good files and fail bad ones.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../../scripts/ci/migration-lint.sh");
const hasGit = spawnSync("git", ["--version"]).status === 0;

let dir: string;
/** Pin git to the throwaway repo. A parent GIT_DIR (this workspace) would otherwise lint the real tree. */
const gitEnv = () => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_DIR: path.join(dir, ".git"),
  GIT_WORK_TREE: dir,
});
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    stdio: "pipe",
    env: gitEnv(),
  }).toString();
const write = (rel: string, body: string) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
};
const commit = (msg: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
};
/** Runs the lint the way CI does for a PR: HEAD compared with origin/main. */
const lint = () => {
  const r = spawnSync("bash", [SCRIPT], {
    cwd: dir,
    env: { ...gitEnv(), GITHUB_BASE_REF: "main" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const GOOD = `-- SCRUM-64: example additive migration.
-- Status: REPO ONLY, NOT APPLIED.
-- Rollback: ALTER TABLE public.t DROP COLUMN IF EXISTS c;
ALTER TABLE public.t ADD COLUMN IF NOT EXISTS c integer;
`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "miglint-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "ci@example.invalid");
  git("config", "user.name", "ci");
  // The agent image signs every commit and enables fsmonitor. Either one can stall a throwaway repo.
  git("config", "commit.gpgsign", "false");
  git("config", "core.fsmonitor", "false");
  git("config", "core.untrackedcache", "false");
  write(
    "supabase/migrations/20260925120000_existing.sql",
    "-- SCRUM-1: old\nCREATE TABLE public.t (id int);\n",
  );
  commit("base");
  // Simulate the PR checkout: origin/main = base commit, HEAD = feature branch.
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-q", "-b", "feature");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

(hasGit ? describe.sequential : describe.skip)("migration lint (SCRUM-64)", () => {
  it("passes when no migration changes", () => {
    write("README.md", "x");
    commit("docs");
    expect(lint()).toMatchObject({ code: 0 });
  });

  it("passes a well-formed new migration", () => {
    write("supabase/migrations/20260928010000_scrum64_example.sql", GOOD);
    commit("add");
    const r = lint();
    expect(r.out).toContain("Migration lint: OK");
    expect(r.code).toBe(0);
  });

  it("fails without a ticket header", () => {
    write("supabase/migrations/20260928010000_x.sql", GOOD.replace("SCRUM-64", "no ticket"));
    commit("add");
    const r = lint();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/name its Jira ticket/);
  });

  it("fails without a rollback section, passes with 'none needed'", () => {
    write("supabase/migrations/20260928010000_x.sql", GOOD.replace(/^-- Rollback.*$/m, ""));
    commit("add");
    expect(lint()).toMatchObject({ code: 1, out: expect.stringMatching(/rollback section/) });

    write(
      "supabase/migrations/20260928010000_x.sql",
      `${GOOD.replace(/^-- Rollback.*$/m, "-- Rollback: none needed, comment only")}`,
    );
    commit("fix");
    expect(lint().code).toBe(0);
  });

  it("fails destructive DDL without approval, passes with the marker", () => {
    const body = `-- SCRUM-100: drop duplicate index\n-- Rollback: CREATE INDEX i ON public.t (id);\nDROP INDEX IF EXISTS public.i;\n`;
    write("supabase/migrations/20260928010000_drop.sql", body);
    commit("add");
    expect(lint()).toMatchObject({ code: 1, out: expect.stringMatching(/approved-destructive/) });

    write(
      "supabase/migrations/20260928010000_drop.sql",
      `-- approved-destructive: SCRUM-100 Vivek 2026-09-30\n${body}`,
    );
    commit("approve");
    expect(lint().code).toBe(0);
  });

  it("does not treat DROP inside a rollback comment as destructive", () => {
    write("supabase/migrations/20260928010000_x.sql", GOOD); // its rollback line contains DROP COLUMN
    commit("add");
    expect(lint().code).toBe(0);
  });

  it("fails a timestamp that is not later than the latest migration on main", () => {
    write("supabase/migrations/20260920000000_older.sql", GOOD);
    commit("add");
    expect(lint()).toMatchObject({
      code: 1,
      out: expect.stringMatching(/not later than the latest migration.*20260925120000/),
    });

    write(
      "supabase/migrations/20260920000000_older.sql",
      `-- out-of-order-approved: SCRUM-64 Atlas\n${GOOD}`,
    );
    commit("approve");
    expect(lint().code).toBe(0);
  });

  it("fails a badly named migration file", () => {
    write("supabase/migrations/add_column.sql", GOOD);
    commit("add");
    expect(lint()).toMatchObject({ code: 1, out: expect.stringMatching(/YYYYMMDDHHMMSS/) });
  });

  it("fails when a committed migration is edited", () => {
    const f = path.join(dir, "supabase/migrations/20260925120000_existing.sql");
    writeFileSync(f, `${readFileSync(f, "utf8")}ALTER TABLE public.t ADD COLUMN x int;\n`);
    commit("edit");
    expect(lint()).toMatchObject({
      code: 1,
      out: expect.stringMatching(/never edit, rename or delete/),
    });
  });

  it("fails when a committed migration is renamed or deleted", () => {
    renameSync(
      path.join(dir, "supabase/migrations/20260925120000_existing.sql"),
      path.join(dir, "supabase/migrations/20260925120000_renamed.sql"),
    );
    commit("rename");
    expect(lint()).toMatchObject({
      code: 1,
      out: expect.stringMatching(/was changed \(git status R/),
    });

    rmSync(path.join(dir, "supabase/migrations/20260925120000_renamed.sql"));
    commit("delete");
    expect(lint()).toMatchObject({
      code: 1,
      out: expect.stringMatching(/was changed \(git status D\)/),
    });
  });

  it("ignores files outside supabase/migrations (e.g. migrations-pending)", () => {
    write("supabase/migrations-pending/x.sql", "DROP TABLE public.t;\n");
    commit("pending");
    expect(lint().code).toBe(0);
  });

  it("on a push to main (no PR), checks the last merge", () => {
    write("supabase/migrations/20260928010000_x.sql", GOOD.replace(/^-- Rollback.*$/m, ""));
    commit("add");
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "merge", "feature");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    expect(lint()).toMatchObject({ code: 1, out: expect.stringMatching(/rollback section/) });
  });
});

describe("repo migrations follow the rules that apply to them", () => {
  it("every migration added since SCRUM-64 has ticket + rollback headers", () => {
    const files = import.meta.glob("/supabase/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const recent = Object.entries(files).filter(([p]) => path.basename(p) >= "20260928010000");
    expect(recent.length).toBeGreaterThan(0);
    for (const [p, src] of recent) {
      expect(src.split("\n").slice(0, 15).join("\n"), p).toMatch(/-- *SCRUM-\d+/);
      expect(src, p).toMatch(/^\s*-- *rollback/im);
    }
  });
});
