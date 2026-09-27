# MML Transaction Hub

Internal web app for MML's lab business: record cloud-lab transactions (public and
private cloud), manage customers, see revenue/cost/margin dashboards and reports,
work the Freshdesk support queue, and expose read-only reporting tools to AI
assistants over MCP.

> Status: partially live. The production app is published from Lovable. This
> GitHub repository is where engineering changes are reviewed (pull requests + CI).
> Nothing here is deployed automatically.

## Architecture (one screen)

```
Browser (React 19 + TanStack Router/Query, shadcn/ui, Tailwind)
   │  supabase-js with the user's session  → Postgres with Row Level Security
   │  server functions (createServerFn)    → run on the server with the user's token
   ▼
TanStack Start server (Vite + Nitro via @lovable.dev/vite-tanstack-config; SSR entry src/server.ts)
   ├─ src/lib/*.functions.ts      server functions called from the UI
   ├─ src/lib/*.server.ts         server-only code (service-role client, Freshdesk API)
   ├─ src/routes/api/public/hooks scheduled jobs, called by pg_cron with x-cron-secret
   └─ src/routes/mcp.ts           MCP endpoint (per-user, RLS-scoped tools in src/lib/mcp)
   ▼
Supabase (Postgres, Auth, Storage, Vault, pg_cron)   ← migrations in supabase/migrations
Freshdesk REST API                                   ← ticket sync (src/lib/freshdesk.server.ts)
```

Main screens (`src/routes/_authenticated/`): Dashboard, Entry (manual + bulk/strict
import), Transactions, Public/Private cloud, Customers, Reports, Tickets, Sync Status,
AI Command Center, MCP audit, Admin.

Roles and access: `src/lib/route-roles.ts` (UI) plus RLS policies in the database.
The database is the real security boundary; hiding a menu item is not.

## Local setup

Requirements: [Bun](https://bun.sh) (CI uses the latest version).

```bash
bun install --frozen-lockfile
cp .env.example .env.local   # fill in SANDBOX values only (see docs/configuration.md)
bun run dev                  # open the local URL Vite prints
```

Never point a local checkout at the live Supabase project.

## Checks (the same as CI, `.github/workflows/ci.yml`)

```bash
bunx tsc --noEmit            # typecheck
bun run test                 # unit tests (vitest), synthetic data only
bun run build                # production build
bash scripts/ci/secret-scan.sh
bash scripts/ci/migration-lint.sh
```

Access-rule (RLS) tests: `src/lib/__tests__/rls-policies.test.ts` applies every migration to an
in-process Postgres (PGlite, no network, synthetic data) and checks what each role can read and
write. It runs with `bun run test` and in CI. See `docs/rls-audit.md`.
The SQL files in `supabase/tests/` are for the **sandbox** database (and also run locally in that test).

## Database changes

Full process, reviewer checklist and the register of migrations not yet on live:
**`docs/migrations.md`** (SCRUM-64). In short:

- One file per change in `supabase/migrations/`, named `YYYYMMDDHHMMSS_scrumNN_what.sql`,
  later than every existing one, with `-- SCRUM-NN` in the first 15 lines and a
  `-- Rollback:` section (CI checks all three).
- Destructive statements (drop, truncate, destructive alter) need an
  `-- approved-destructive: <ticket> <who>` line and Vivek's approval.
- A committed migration is never edited, renamed or deleted (CI checks); fix forward.
- A second reviewer approves every migration PR.
- Every live change starts with a backup: `docs/runbooks/backup-before-live-change.md` (SCRUM-62).
- Merging a migration **does not apply it**. It is applied to sandbox first, then to
  live in the agreed release order (migrations before the app publish), with approval.

## Deploy

Today the live app is published from Lovable. The Lovable ↔ GitHub connection
(SCRUM-81) and the release order are still to be agreed. Until then:

1. Changes land on `main` through reviewed pull requests with green CI.
2. Migrations are applied to sandbox, tested, then applied to live by an approved person.
3. The app is published from Lovable after its migrations are live.

The step-by-step order for getting today's `main` live is in `docs/runbooks/publish-main.md`.

Scheduled jobs (pg_cron): Freshdesk sync, snapshot sync, bulk-import cleanup. They
call `/api/public/hooks/*` with the Vault `cron_secret` (see
`docs/runbooks/scrum-89-cron-secret.md`).

## Integrations

| Integration | Where | Notes |
|---|---|---|
| Supabase Auth | `src/integrations/supabase/`, `src/lib/auth-context.tsx` | email + password sign-in; roles in `user_roles` |
| Freshdesk | `src/lib/freshdesk.server.ts`, `freshdesk.functions.ts`, `freshdesk-cursor.ts` | incremental sync plus a daily full pass; every run is logged in `sync_runs` |
| MCP | `src/routes/mcp.ts`, `src/lib/mcp/` | tools run as the calling user (RLS applies); calls are audited |
| Strict Excel import | `src/lib/strict-import/` | behind `STRICT_IMPORT_ENABLED`, off by default (SCRUM-103) |

## More documentation

- `docs/configuration.md`: every environment variable, sandbox vs live
- `docs/secrets-inventory.md`: secrets, where they live, rotation plan
- `docs/kpi-definitions.md`: how revenue, cost, margin and the other KPIs are computed
- `docs/runbooks/`: operational runbooks
- `docs/review/`: 2026-09-25 code review, gap analysis and rebuild plan
