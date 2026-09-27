# Runbook: backup before any live change (SCRUM-62)

Every change to live **data or schema** starts with a backup that can be restored, taken and
recorded right before the change. This covers migrations, data fixes, SQL-editor changes,
cron edits and bulk imports done by engineers. The app publish on its own doesn't change data,
but when it ships together with a migration, the migration's backup covers it.

Status (28 Sep 2026): this is written from the platform documentation and the repo.
**Nothing below has been confirmed on the live project yet.** Live checks L1–L3 fill in the blanks.

## What the platform gives us

The live database is the Lovable Cloud project's managed Postgres (Supabase underneath), so
the Lovable Cloud rules apply ([Lovable docs: Database → Backup and restore](https://docs.lovable.dev/features/database),
[Advanced settings → Export](https://docs.lovable.dev/features/advanced-settings)):

| | Daily backup | Manual export |
|---|---|---|
| Taken | automatically, once a day | on request: Cloud → Overview → Advanced settings → Export project data → Database |
| Kept | about 14 days | until you delete it from Cloud storage (download it and keep a copy off-platform) |
| Covers | whole database, schema and data | whole database, schema and data (up to 5 GB, one export per 24 h) |
| Doesn't cover | Storage files (bucket `bulk-imports`), function code, secrets | the same |
| Restore | **in place only**: the whole database goes back to that day; everything written since is lost; a few minutes of downtime; anyone with edit access can do it | `pg_restore` into a **separate** Postgres/Supabase project (sandbox or scratch) |
| Point-in-time | no | no |

If L1 shows the project is actually a connected Supabase project (not Lovable Cloud), the Supabase
plan decides instead: Pro and above keep daily backups (7 days on Pro), with PITR as a paid add-on.
Record which one applies.

**What this means for us.** An in-place restore undoes every transaction the team entered since the
backup, so it's the last resort. The normal way back is the change's own rollback (every
migration has one, see `docs/migrations.md`). The pre-change export is the copy we use to recover
specific rows, restored into a separate project, never over live.

## Live checks (read-only, no change; record the results here and on SCRUM-62)

| # | Check | Result |
|---|---|---|
| L1 | Backend type: Lovable Cloud or a connected Supabase project? Which plan? | _to fill_ |
| L2 | Cloud → Database → Backups: how many daily backups are listed, and the oldest and newest timestamps (UTC → IST). This confirms retention | _to fill_ |
| L3 | Who has edit access to the Lovable project, since they can restore in place? The list goes to Vivek; changing it is Vivek's call | _to fill_ |

## Pre-change checklist (copy into the release log for each change)

1. **Approval**: Atlas engineering GO and Vivek GO are recorded on the Jira ticket, naming this change.
2. **Window**: not within ±10 min of HH:15 UTC (Freshdesk sync) or 02:00 UTC (snapshot job).
   Nobody is mid-import.
3. **Latest daily backup**: note its timestamp (UTC and IST) from Cloud → Database → Backups.
4. **Manual export**: start it, wait for the email, download it, and store it in the agreed
   off-platform place. Record the file name, size and `sha256sum`. Never put it in the repo, Jira,
   chat or email. Only one export per 24 h, so plan releases around it.
5. **Storage**: if the change touches import evidence or the `bulk-imports` bucket, download the
   affected files first (they aren't in any database backup).
6. **Fingerprint before**: run `supabase/tests/reports/pre_change_fingerprint.sql` (read-only; counts
   and hashes only) and save the result as CSV with the time.
7. **Data fixes only**: inside the same transaction, save a before-image table first
   (`create table _backup_YYYYMMDD_<table> as select * from <table> where <rows being fixed>;`).
   Record it on the ticket, and drop it only after sign-off (a destructive step, so it needs approval).
8. **Apply** the change, following `docs/migrations.md` for migrations.
9. **Fingerprint after**: run it again and compare it with step 6. **Only the objects the change was
   meant to touch may differ.** Anything else means stop and roll back (see below).
10. **Record**: fill in the release log below and comment on the Jira ticket.

## If something goes wrong (in this order)

1. **Change's own rollback**: the migration's rollback SQL or the flag switch-off. Re-run the
   fingerprint; it should match step 6, apart from rows users wrote in between.
2. **Data fix**: put rows back from the `_backup_…` before-image table.
3. **Specific rows lost**: restore the pre-change export into sandbox or a scratch project, then
   copy the needed rows back with reviewed SQL.
4. **Last resort, in-place daily restore**: only with Vivek's explicit approval. First export the
   current state (if the 24 h limit allows) so today's writes can be re-entered. Afterwards, ask
   Lovable to check the app against the restored schema.

## Restore test (acceptance: tested at least once into sandbox)

Run once, then again whenever the platform or plan changes. Sandbox only:

1. Take a manual export of the **sandbox** project (synthetic data). Download it and record its sha256.
2. Run the fingerprint on sandbox and save it.
3. Restore the export into a scratch Postgres/Supabase project: `pg_restore --no-owner --no-acl -d <scratch url> <file>`.
   Then run the fingerprint there.
4. Compare: the `data`, `columns` and `functions` rows should match. `grants`/`policies` may differ
   if `--no-acl` was used, so repeat without it if the target has the same roles.
5. Record how long each step took, any errors, and the result on SCRUM-62. Delete the scratch project.

Restoring a **live** export into sandbox would put real customer and finance data into sandbox. That
needs Vivek's decision and isn't part of this test.

## Release log (one row per live change)

| Date/time (IST) | Ticket | Change | Approved by | Daily backup ts | Export file + sha256 | Fingerprint before/after | Result |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
