# Database migrations: review before apply (SCRUM-64)

Goal: no schema change reaches the live database without review, a sandbox run and a written
rollback. Merging a migration to `main` **does not apply it**.

## Current state (28 Sep 2026)

- Live has every migration up to `20260925024238_…` (written and applied by Lovable, brought into
  the repo in PR #1).
- The 9 migrations listed in the [register](#register-of-migrations-not-yet-on-live) exist **in the
  repo only**. None has been applied to sandbox or live.
- Live has had edits made directly in the Lovable SQL editor that aren't in any migration file (see
  `docs/rls-audit.md`). Run the drift check below before the first apply.

## Rules

| # | Rule | How it's enforced |
|---|---|---|
| 1 | Every schema change is a file in `supabase/migrations/` (no SQL-editor changes to live) | Review. Drift check before each release |
| 2 | Each new file names its Jira ticket in the first 15 lines (`-- SCRUM-NN: …`) | CI (`scripts/ci/migration-lint.sh`) |
| 3 | Each new file has a rollback section (`-- Rollback: <SQL or steps>`, or `-- Rollback: none needed, <why>`) | CI |
| 4 | Destructive DDL (drop table/column/schema/type/function/index/view, truncate, delete from, alter column type) needs `-- approved-destructive: <ticket> <who approved>`, and Vivek's approval | CI, then review |
| 5 | File name is `YYYYMMDDHHMMSS_scrumNN_what.sql`, and the timestamp is later than every migration already on `main` (Supabase skips older files on push). Exception: `-- out-of-order-approved: <ticket> <who>` | CI |
| 6 | A migration already on `main` is never edited, renamed or deleted, because it may already be applied somewhere. Fix forward with a new file | CI |
| 7 | A migration PR needs a second reviewer (not the author) before merge, even when CI is green | Review (PR template checklist) |
| 8 | Sandbox first: each migration is applied and verified on sandbox before live | Register below |
| 9 | Live apply needs Atlas's engineering go-ahead **and** Vivek's approval, a fresh backup (SCRUM-62), and follows the release order | Register below |

A destructive change waiting for approval sits in `supabase/migrations-pending/`, outside the path
that any tool applies (see the README there).

Lovable sync PRs (live → repo, like PR #1) bring in files Lovable wrote. These have no ticket or
rollback header. For those PRs the lint failure is expected: the reviewer confirms the files match
live exactly, and nothing new is written into them.

## Lifecycle of one migration

1. **Write.** Make it additive where possible: `IF NOT EXISTS`, nullable columns, `NOT VALID`
   constraints validated later. Put the ticket, status, release order and rollback in the header.
2. **Test locally.** `bun run test` applies every migration to an in-process Postgres
   (`src/lib/__tests__/rls-policies.test.ts`). Add a test for the new behaviour, and a read-only
   check under `supabase/tests/` if it needs sandbox data.
3. **PR.** CI runs the lint. A second reviewer goes through the checklist in the PR template.
4. **Merge.** The migration is now repo-only. Add it to the register (sandbox: –, live: –).
5. **Approve.** Get Atlas's engineering go-ahead and Vivek's approval for this migration
   specifically, with the release order (migration before or after the app publish, flags).
6. **Backup.** Follow `docs/runbooks/backup-before-live-change.md` (SCRUM-62): latest daily
   backup, a manual export, and the fingerprint before and after.
7. **Sandbox.** Apply **one migration at a time**, in register order, then run its verify queries.
   Record the date and who applied it.
8. **Live.** Apply it in the approved window, in register order, then run the same verify queries
   and record them. If anything is off, run the rollback and tell Atlas.
9. **After.** Confirm `supabase_migrations.schema_migrations` lists the version. Update the register
   and the Jira ticket.

Never run a bulk push (`supabase db push`, or a Lovable/CLI sync) against live while the register
has migrations that aren't approved. It would apply all of them at once.

## Publish order for getting `main` live

Full steps: **`docs/runbooks/publish-main.md`**. In short:

1. Owner/admin links the Lovable project to GitHub (Lovable creates a new repository), then push
   `main` into it **without the 9 register migration files**. Do not publish yet.
2. Apply 1 and 2, then add `x-cron-secret` to all three cron jobs
   (`docs/runbooks/scrum-89-cron-secret.md`). This comes before the publish.
3. Publish, avoiding ±10 min around HH:45 IST (HH:15 UTC) and 07:30 IST (02:00 UTC).
4. Apply 8, then 9.
5. After a fresh drift check, apply 3, 5, 6 and 7 one at a time.
6. Hold 4 until the SCRUM-103 rules are decided.
7. Verify the next sync and snapshot runs, the 401 for the old `apikey`, and the register.

## Drift check (read-only; run on sandbox and live before a release)

```sql
-- Which migration versions does this database think it has?
select version, name from supabase_migrations.schema_migrations order by version desc limit 20;
```

Compare the result with `ls supabase/migrations`. Everything up to `20260925024238` should be
present, and nothing from the register should be. Then run the policy and grant drift queries in
`docs/rls-audit.md`.

## Second-reviewer checklist (also in `.github/pull_request_template.md`)

- [ ] The ticket is named, and the header says REPO ONLY / NOT APPLIED plus the release order
- [ ] It's additive, or destructive with `approved-destructive` and Vivek's approval recorded on the ticket
- [ ] The rollback is written and would actually work (and the reviewer has thought about data written in the meantime)
- [ ] Safe while the current live app runs (old code + new schema, and new code + old schema)
- [ ] RLS/grants: new tables have RLS on, no anon grant, and a policy per command that's needed
- [ ] Locking: no long rewrite or full-table lock on large tables (`transactions`, `freshdesk_tickets`)
- [ ] Local tests cover it. Sandbox verify queries are written down

## Register of migrations not yet on live

Order = the order to apply them (timestamp order). "Needs first" = what must happen before the
migration.

| # | Version / file | Ticket | What it does | Needs first / release order | Rollback | Sandbox | Live |
|---|---|---|---|---|---|---|---|
| 1 | `20260925120000_scrum89_cron_secret` | SCRUM-89 | Vault `cron_secret` plus `verify_cron_secret()` (service role only) | Backup. Then migration → cron headers → code (`docs/runbooks/scrum-89-cron-secret.md`) | Revert the code first. Remove the cron header. Then `DROP FUNCTION public.verify_cron_secret(text);` and `DELETE FROM vault.secrets WHERE name='cron_secret';` (destructive: approval) | – | – |
| 2 | `20260925120100_scrum98_import_artifact_legal_hold` | SCRUM-98 | Legal hold: `expired_bulk_import_artifacts()` returns nothing, so no import evidence can be auto-deleted | None; safe any time | Restore the original body quoted in the file header. **Only with Vivek's approval** (lifts the hold) | – | – |
| 3 | `20260925121000_scrum99_profile_guard_audit_writes` | SCRUM-99, SCRUM-57 | Users can edit only their own display name. Audit tables are trigger-only. No default anon grants | None; admin flows use the service role | `DROP TRIGGER profiles_guard_self_update ON public.profiles; DROP FUNCTION public.guard_profile_self_update();` `GRANT INSERT, UPDATE, DELETE ON public.customer_audit_log, public.permission_audit_log, public.role_audit_log, public.transaction_activity_log TO authenticated;` (anon grants are not restored) | – | – |
| 4 | `20260925130000_scrum103_import_batches` | SCRUM-103, SCRUM-79 | `import_batches` table, batch link on transactions, NOT VALID checks, all-or-nothing import function | Rule decisions (SCRUM-103, Vivek). No app code uses it until the strict importer ships | If `select count(*) from import_batches` = 0: drop the function, the two constraints, the unique index, the two `transactions` columns, and `import_batches`. If batches exist: needs a Vivek decision (data loss) | – | – |
| 5 | `20260925140000_scrum74_sync_runs_freshdesk` | SCRUM-74, SCRUM-72 | `fetched_count` / `upserted_count` on `sync_runs`, plus an index | None; the code works without it | `DROP INDEX public.idx_sync_runs_kind_started; ALTER TABLE public.sync_runs DROP COLUMN fetched_count, DROP COLUMN upserted_count;` (loses the counts only) | – | – |
| 6 | `20260925150000_scrum92_freshdesk_stale_marker` | SCRUM-92 | `freshdesk_tickets.stale_since`, plus a partial index | Migration first, then set `FRESHDESK_STALE_SWEEP_ENABLED=true` | Unset the flag, then `DROP INDEX public.idx_freshdesk_tickets_stale; ALTER TABLE public.freshdesk_tickets DROP COLUMN stale_since;` | – | – |
| 7 | `20260928010000_scrum57_revoke_unused_write_grants` | SCRUM-57 | Removes write grants that no policy uses. No behaviour change | Drift check first (`docs/rls-audit.md`) | GRANT statements in the file header | – | – |
| 8 | `20260928020000_scrum102_agent_identities_server_writes` | SCRUM-102 | `agent_identities` becomes read-own for users; the server writes it after its check | **Publish the app code first**, then apply (before the code, "link my agent" fails with an error, no data lost) | Policy + GRANT statements in the file header | – | – |
| 9 | `20260928030000_scrum77_mcp_audit_server_writes` | SCRUM-77 | MCP audit rows written by the server only (users lose INSERT) | **Publish the app code first**, then apply (before the code, audit rows fail to save, logged) | Policy + GRANT statements in the file header | – | – |

Waiting for approval, not migrations yet (`supabase/migrations-pending/`):
`scrum100_drop_duplicate_bulk_import_index.sql` (SCRUM-100, destructive, needs Vivek).

Files 1–6 were merged before rule 3 existed, so their rollback lives here instead of in the file.
Rule 6 means the files themselves are not edited.
