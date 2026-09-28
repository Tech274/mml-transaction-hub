# Runbook: getting `main` live (publish order)

Status: **done on 28 Sep 2026 (04:17–04:50 IST), except migration 4 (held).** Steps 1–7 ran in
this order with Vivek's approval: `main` 3cb7202f pushed to the Lovable-linked repository
`Tech274/mml-internal` (commit `35943226`), migrations 1+2 and the cron header at 04:22–04:23 IST,
publish at 04:23 IST (Lovable deploy `565140ef`), then 8, 9, drift check, 3, 5, 6, 7 by 04:50 IST.
Before this release the live project ran the 25 Sep code (Lovable commit `7db1fd06`).

Every live step below needs Atlas's engineering go-ahead **and** Vivek's approval. Timings are
given in UTC and IST.

## Why the order matters

- The hook code on `main` accepts only the Vault `cron_secret` (`x-cron-secret` header, SCRUM-89).
  Published before migration 1 and the cron header change, the hourly Freshdesk sync and the daily
  snapshot fail with 401.
- Migrations 8 and 9 remove the users' own write access to `agent_identities` and
  `mcp_tool_audit_log`. The code on `main` writes those with the service role. Applied before the
  publish, "link my agent" fails and MCP audit rows are not saved.
- Everything else on `main` works against the current live schema (missing `sync_runs` counts are
  logged, the strict importer and the stale sweep are behind flags that stay off).

## Steps

### 0. Before anything
- Approvals recorded: Vivek for the publish and for each migration by number; Atlas go-ahead.
- Backup: `docs/runbooks/backup-before-live-change.md` (SCRUM-62).
- Drift check (read-only) from `docs/migrations.md`: live must list everything up to
  `20260925024238` and nothing from the register.

### 1. Link the Lovable project to GitHub (workspace owner or admin only)
- The Lovable workspace owner (or an admin) adds a workspace GitHub connection and links the live
  project. A Lovable **member** cannot do this.
- Lovable always creates a **new** repository when a project is linked; it cannot link this
  repository. The new repository starts from the live code (`7db1fd06`).
- If the workspace is out of credits, the owner adds credits first.

### 2. Push `main` into the Lovable-created repository, without the 9 migration files
- Add one commit on the synced branch that brings the tree to `main`. `main` only adds and changes
  files relative to the live code (none deleted). Keep the Lovable-managed `.env` that is already in
  that repository (it holds only public values; it is not in this repository).
- **Leave out the 9 register migration files** (`supabase/migrations/20260925120000_…` through
  `20260928030000_…`) and `supabase/migrations-pending/`. A sync or bulk push must never apply
  them all at once (`docs/migrations.md`). They are applied one at a time in the steps below and
  added to the Lovable repository afterwards.
- Check: the Lovable project's latest commit moves to the pushed commit and the preview builds.
  **Do not publish yet.**

### 3. Apply migrations 1 and 2, then add the cron header (before the publish)
- Follow `docs/runbooks/scrum-89-cron-secret.md` steps 1 to 3: apply
  `20260925120000_scrum89_cron_secret` and `20260925120100_scrum98_import_artifact_legal_hold`, run
  their verify queries, then add `x-cron-secret` to all three jobs (`mml-daily-snapshot-sync`,
  `mml-hourly-freshdesk-sync`, `bulk-import-cleanup-daily`, which stays inactive).
- The live code ignores the extra header, so this is safe before the publish.

### 4. Publish
- Publish the live project with Vivek's approval.
- Avoid ±10 min around **HH:15 UTC (HH:45 IST)**, the hourly Freshdesk sync, and
  **02:00 UTC (07:30 IST)**, the daily snapshot.

### 5. Apply migrations 8 and 9 (after the publish)
- `20260928020000_scrum102_agent_identities_server_writes`, then
  `20260928030000_scrum77_mcp_audit_server_writes`, one at a time, each with its verify step.

### 6. Apply migrations 3, 5, 6 and 7 (after a fresh drift check)
- Re-run the drift check and the policy/grant drift queries in `docs/rls-audit.md` first.
- Then, one at a time in register order: `20260925121000_scrum99_profile_guard_audit_writes`,
  `20260925140000_scrum74_sync_runs_freshdesk`, `20260925150000_scrum92_freshdesk_stale_marker`,
  `20260928010000_scrum57_revoke_unused_write_grants`.
- `FRESHDESK_STALE_SWEEP_ENABLED` stays unset until migration 6 is live and Vivek approves turning it on.

### 7. Hold migration 4
- `20260925130000_scrum103_import_batches` waits until Vivek decides the SCRUM-103 import rules.
  It adds columns and a unique index on `transactions` and a function that writes finance rows.
  `STRICT_IMPORT_ENABLED` stays unset.

### 8. Verify
- After the next HH:15 UTC (HH:45 IST) run and the next 02:00 UTC (07:30 IST) run: a new
  `sync_runs` row for each job with status `success`, and `freshdesk_tickets.synced_at` moves.
- Anonymous `POST /api/public/hooks/mcp-sync` with only the public `apikey` returns 401.
- `bulk-import-cleanup-daily` is still inactive; `expired_bulk_import_artifacts(1)` returns 0 rows.
- `supabase_migrations.schema_migrations` lists each applied version; update the register
  (sandbox/live columns) and the Jira tickets.
- Sign in and open the main pages (dashboard, transactions, Freshdesk tickets, Sync Status, admin).

## Rollback
- Code: re-publish the previous Lovable version. The cron commands still carry the old `apikey`
  header, so the old code keeps working with the new header in place.
- Migrations: each rollback is in the register in `docs/migrations.md` (and in the file headers for
  7 to 9). Roll back 8 and 9 before reverting the code.
