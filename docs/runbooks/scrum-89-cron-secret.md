# Runbook: SCRUM-89 (G-03) cron secret + SCRUM-98 legal hold

Status: **code merged to GitHub only. Nothing applied to the live database, nothing published.**
Apply only with Atlas's engineering go-ahead **and** Vivek's approval. The live Lovable project is
not yet connected to this repository; when it is, follow this order exactly. The full release
order for getting `main` live is in `docs/runbooks/publish-main.md`.

## Why the order matters
The new hook code rejects any call without a valid `x-cron-secret`. If the code goes live before the
cron jobs send that header, the hourly Freshdesk sync and the 02:00 UTC snapshot stop (401).
Adding the header first is harmless to the old code (it ignores unknown headers).

## The live cron jobs (checked read-only on 28 Sep 2026)

| Job name (live) | Schedule | Calls | Active | Header style in the command |
|---|---|---|---|---|
| `mml-daily-snapshot-sync` | `0 2 * * *` (02:00 UTC = 07:30 IST) | `/api/public/hooks/mcp-sync` | yes | `jsonb_build_object(...)` (per migration `20260916232816_…`) |
| `mml-hourly-freshdesk-sync` | `15 * * * *` (HH:15 UTC = HH:45 IST) | `/api/public/hooks/freshdesk-sync` | yes | JSON literal `'{...}'::jsonb` (per migration `20260917005823_…`) |
| `bulk-import-cleanup-daily` | `15 3 * * *` (03:15 UTC = 08:45 IST) | `/api/public/hooks/bulk-import-cleanup` | **no, must stay inactive** (SCRUM-98 legal hold) | not in any migration (created in the SQL editor): inspect it |

The Freshdesk job was created by migration `20260917005823_…` as `mml-daily-freshdesk-sync`, but on
live it is named **`mml-hourly-freshdesk-sync`** (renamed outside the migrations). An earlier version
of this runbook used the migration name, so its SQL matched no row and would have left the Freshdesk
job without the header. Always use the live names above, and stop if `cron.job` shows anything else.

## Order
1. **Pre-checks**
   - DB backup taken (record timestamp): `docs/runbooks/backup-before-live-change.md` (SCRUM-62).
   - Not within ±10 min of HH:15 UTC / HH:45 IST (Freshdesk) or 02:00 UTC / 07:30 IST (snapshot).
   - Confirm the three jobs and their state. **Stop if the names, count or `active` values differ
     from the table above**:
     ```sql
     select jobid, jobname, schedule, active from cron.job order by jobid;
     -- expected exactly: mml-daily-snapshot-sync (active), mml-hourly-freshdesk-sync (active),
     --                   bulk-import-cleanup-daily (active = false)
     ```
2. **Apply migrations** `20260925120000_scrum89_cron_secret.sql` and `20260925120100_scrum98_import_artifact_legal_hold.sql`.
   Verify:
   ```sql
   select count(*) from vault.secrets where name = 'cron_secret';              -- 1
   select has_function_privilege('anon', 'public.verify_cron_secret(text)', 'execute'); -- false
   select count(*) from public.expired_bulk_import_artifacts(1);               -- 0 (legal hold)
   ```
3. **Add the `x-cron-secret` header to all three cron commands** (run as SQL by an admin, not as a
   migration). The secret is read from Vault each time the job runs; it is never pasted anywhere.
   Inspect each command first and note which header style it uses (see the table):
   `select jobid, jobname, command from cron.job order by jobid;`
   - Snapshot job (`mml-daily-snapshot-sync`, headers built with `jsonb_build_object(...)`):
     ```sql
     select cron.alter_job(jobid, command := replace(command,
       'jsonb_build_object(',
       'jsonb_build_object(''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_secret''), '))
       from cron.job where jobname = 'mml-daily-snapshot-sync' and command not like '%x-cron-secret%';
     ```
   - Freshdesk job (`mml-hourly-freshdesk-sync`, headers given as a JSON literal `'{...}'::jsonb`):
     ```sql
     select cron.alter_job(jobid, command := regexp_replace(command,
       '(headers\s*:=\s*''[^'']*''::jsonb)',
       '\1 || jsonb_build_object(''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_secret''))'))
       from cron.job where jobname = 'mml-hourly-freshdesk-sync' and command not like '%x-cron-secret%';
     ```
   - Cleanup job (`bulk-import-cleanup-daily`): use the statement that matches its header style,
     with `jobname = 'bulk-import-cleanup-daily'`. Only the command changes: `cron.alter_job` is
     called **without** `active`, so the job stays `active = false`. Do not enable it (SCRUM-98).
     - `jsonb_build_object(...)` style: the snapshot statement above with the job name changed.
     - `'{...}'::jsonb` style: the Freshdesk statement above with the job name changed.
     - Any other style: stop and ask Atlas; do not improvise.
   - Each statement must return exactly one row. A statement that returns **0 rows** changed
     nothing: check the job name and header style before going on.
   Re-read and confirm every command now contains `x-cron-secret` exactly once and is otherwise
   unchanged (URL, body, schedule), and that the cleanup job is still inactive:
   ```sql
   select jobname, active,
          (length(command) - length(replace(command, 'x-cron-secret', ''))) / length('x-cron-secret') as header_count
     from cron.job order by jobid;
   -- expected: header_count = 1 for all three; bulk-import-cleanup-daily active = false
   ```
4. **Ship the code** through Lovable ↔ GitHub sync, then Vivek approves the publish
   (`docs/runbooks/publish-main.md`).
5. **Verify** after the next HH:15 UTC (HH:45 IST) run and the next 02:00 UTC (07:30 IST) run:
   `sync_runs` gets a new row for each; `freshdesk_tickets.synced_at` moves; anonymous
   `POST /api/public/hooks/mcp-sync` with only the public `apikey` returns 401. The cleanup job
   stays inactive and does not run.
6. Optional clean-up later: remove the old `apikey` header from the cron commands.

## Rollback
- Code: revert the publish in Lovable / revert the PR in GitHub (the old `apikey` header is still in
  the cron commands, so the old code keeps working).
- Cron: drop the header from each of the three commands with the inverse `replace(...)` /
  `regexp_replace(...)`, then re-run the check query (`header_count = 0`).
- Legal hold: only with Vivek's approval, restore the original function body quoted in the migration header.
