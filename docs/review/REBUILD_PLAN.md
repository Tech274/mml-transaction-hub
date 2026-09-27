# MML Transaction Hub: Rebuild Plan (restructure without breaking live data)

Prepared by Atlas, 25 Sep 2026. Companion to `GAP_ANALYSIS.md` (finding IDs G-xx).

## 1. Principles

- **Improve in place, don't start over.** The live database (58 transactions, 24 customers, 1,968 tickets, 13 accounts, audit logs) is the asset to protect. We refactor the code around it in small, reversible steps. No big-bang rewrite, and no new database.
- **Database rules are the real security.** Every rule the UI shows (finance visibility, admin-only) must also hold in the database and in server functions. The UI only hides things for convenience.
- **Additive schema changes only.** Add first, switch readers, then remove the old thing in a later release. Never rename or drop a column in the same release that stops using it.
- **Sandbox first, always.** Sandbox project `57fec23b-77d4-4b8b-840b-19d0b5d26131` (no real data). Then Atlas's engineering go-ahead, apply to live, and Vivek approves the publish.

## 2. Phase 0: Stop the bleeding (this week, all small, all safe while live)

In order: close sign-up and change new accounts to no role (G-01) → fix the report_snapshots/sync_runs rules and revoke anon privileges (G-02, G-13) → put a real secret on the job URLs and update the cron commands together (G-03) → pause import-file cleanup and archive the 5 files (G-19) → add role checks to ticket history and the agent directory (G-06) → log Freshdesk runs and fix the job timeouts (G-07) → hide or label the AI Command Center and remove demo seeding (G-09) → replace hard delete with deactivate (G-11). Each is a single Jira ticket under SCRUM-44, tested in the sandbox, and published only with Vivek's approval.

## 3. Target folder structure

```
src/
  app/                      # TanStack routes only: thin, no business logic
    routes/
      _authenticated/...    # each route declares requiredRoles in beforeLoad
      api/hooks/...         # cron endpoints (secret-checked)
      mcp.ts
  features/                 # one folder per business area
    transactions/
      ui/                   # components (table, drawer, ADR form)
      server/               # createServerFn wrappers: auth + validation + call domain
      domain/               # pure logic: classification, metrics, validation schemas (zod)
      data/                 # repository: the only place that talks to Supabase for this area
      __tests__/
    customers/  reports/  tickets/  bulk-import/  admin/  sync/  ai-command-center/
  shared/
    auth/                   # requireAuth, requireRole(roles), session helpers
    db/                     # supabase clients (user-scoped, service), generated types
    errors/                 # AppError, toUserMessage, logger with request id
    config/                 # typed env loader (zod) + business config (Freshdesk group, dates)
    ui/                     # only the shadcn components actually used
  integrations/
    freshdesk/              # API client, pagination, retry, rate limit
    mcp/                    # tools call features/*/data, never raw queries
supabase/
  migrations/               # timestamped, reviewed, idempotent where possible
  tests/                    # SQL tests for RLS (pgTAP or plain SQL asserts)
tests/
  e2e/                      # Playwright (TypeScript), runs against sandbox
docs/                       # README, ARCHITECTURE, RUNBOOK (cron, Freshdesk, MCP), ADRs
```

## 4. Layering rules

1. **UI** (`features/*/ui`) calls server functions or React Query hooks only. No direct `supabase.from(...)` writes from components. Today the bulk import and some admin flows write from the browser.
2. **Server functions** (`features/*/server`) do exactly three things: authenticate (`requireAuth`), authorise (`requireRole([...])`), and validate input (shared zod schema). Then they call domain + data.
3. **Domain** holds pure TypeScript with no I/O, so it is easy to unit-test: metrics, margin, classification, bulk-row validation, snapshot aggregation.
4. **Data / repositories** are the only place that builds queries. They use the user-scoped client by default. The service-key client is allowed only in `sync`, `admin`, and cron code, and each use carries a comment explaining why.
5. **Multi-step writes** (bulk apply, create user + roles, confirm + external write) go into one Postgres function or one server step that is all-or-nothing, with audit written in the same transaction.

## 5. Typing

- Regenerate `types.ts` from the live schema after every migration. CI fails if the types differ from the migrations.
- Remove `as never` / `as any` / `unknown as { from: ... }` casts (G-15). Use typed row types (`Tables<'transactions'>`).
- Use one zod schema per entity, shared by form validation, server validation and bulk-import validation.
- Turn on TypeScript `strict`, `noUncheckedIndexedAccess`, and make ESLint `no-explicit-any` an error.

## 6. Error handling and observability

- One `AppError` type with a code, a user message and internal detail. Server functions log the internal detail with a request id and return only the user message plus the id (G-17).
- No empty `catch {}` and no `void insert(...)` for audit.
- Every scheduled job writes a `sync_runs` row (kind = snapshot | freshdesk | cleanup) with start, end, counts and error (G-07). The Sync Status page shows all kinds. Alert after 2 consecutive failures.
- Cron endpoints return 202 quickly and do the work in the background, or pg_net gets a realistic timeout.

## 7. Tests

- **Unit (vitest):** domain logic (metrics, snapshot aggregation, bulk validation, Freshdesk mapping), aiming for about 80% of `domain/`.
- **Database access-rule tests** (run against the sandbox): for each role and for anon, assert what they can read and write on every table, especially finance columns, report_snapshots and tickets. This is the test that would have caught G-02 and G-04.
- **Integration:** Freshdesk client against recorded fixtures (pagination drift, 429, deleted tickets).
- **E2E (Playwright, TypeScript):** sign-in, ADR entry, bulk import (happy path plus a bad file), admin create/deactivate, run against the sandbox with seeded fake data only.

## 8. CI (after GitHub is connected by a workspace admin)

GitHub Actions on every pull request: install → typecheck → lint → vitest → build → `npm audit --audit-level=high` → migration lint (no destructive DDL without an `-- approved-destructive` marker). `main` is protected and requires Atlas's approval. Lovable syncs `main` both ways, but publishing to live still needs Vivek's approval.

## 9. Env and secrets

- Commit `.env.example` with names only (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, VITE_*, and server-only SUPABASE_SERVICE_ROLE_KEY, FRESHDESK_DOMAIN, FRESHDESK_API_KEY, CRON_SECRET). Keep `.env` out of git.
- A typed env loader (zod) fails fast with a clear message if a variable is missing.
- The cron secret lives in Supabase Vault, and cron jobs read it from there. Rotate the Freshdesk key once we know who owns it.
- Never use the publishable key as an authentication secret (G-03).

## 10. Migrations discipline

- One migration per change, with a clear name (Lovable's UUID names stay, plus a header comment describing the change and the ticket number).
- Expand, then migrate, then contract. Destructive steps (DROP, column type change, data backfill) need a written rollback, a sandbox run and Vivek's approval.
- Data fixes (like G-05) are one-off scripts that save a before-image table first (`_backup_YYYYMMDD_<table>`), run inside a transaction, and are recorded in Jira.
- Planned migrations: fix the report_snapshots/sync_runs rules; revoke anon grants; handle_new_user gives no role; finance secure views; unique index (potential_id, month, year, lab_name); CHECK input_cost >= 0; FK rules for created_by/updated_by (ON DELETE SET NULL); has_role checks is_active; freshdesk sync cursor + `last_seen_at`; snapshot retention; drop the duplicate index.

## 11. Staged rollout

| Stage | Where | Gate |
|---|---|---|
| 1. Build and test | Sandbox (empty DB, seeded fake data) | Tests green, Jira ticket updated |
| 2. Review | Pull request (once GitHub is connected) or Lovable diff | Atlas engineering go-ahead |
| 3. Apply | Live project editor (`mml-internal`), migrations first, code second | Atlas |
| 4. Publish | Live site | **Vivek approves** |
| 5. Verify | Live smoke checks (sign-in per role, Sync Status, one import dry-run) | John reports in the daily Jira update |

Order of work after Phase 0: (1) finance enforcement on the server (G-04) → (2) bulk import moved to the server with an all-or-nothing database function (G-10) plus the G-05 data correction → (3) incremental Freshdesk sync (G-08, G-14) → (4) folder restructure, one feature at a time (start with `admin`, then `bulk-import`, `tickets`, `transactions`, `reports`) → (5) CI and tests throughout.

## 12. What must be preserved

- All live rows and IDs: transactions, customers, account_managers, config_master, role_permissions, profiles, user_roles, freshdesk_tickets.
- All audit history: transaction_activity_log (needed to repair G-05), customer_audit_log, role_audit_log, permission_audit_log, bulk_import_* tables, ticket_action_log, mcp_tool_audit_log, ai_cc_audit.
- Stored import files in the `bulk-imports` bucket (pause cleanup first).
- Existing sign-ins and passwords (no auth migration). The MCP OAuth issuer URL and `/mcp` path, so connected AI clients keep working.
- Cron schedules (hourly :15 Freshdesk, 02:00 UTC snapshot, 03:15 UTC cleanup). Only the auth header and timeout change.
- The URLs users bookmark (/dashboard, /transactions, /tickets?view=mine, etc.).

## 13. Planned only (not designed here)

- Annual ADR (yearly view and entry of the Master ADR).
- "Pack 3" items currently in preview.
- A real AI model behind the Command Center (needs its own design for data minimisation, prompt-injection defence and cost limits).
- Other future features from roadmap.md.
