# Runbook: SCRUM-89 (G-03) cron secret + SCRUM-98 legal hold

Status: **code merged to GitHub only. Nothing applied to the live database, nothing published.**
Apply only with Atlas's engineering go-ahead **and** Vivek's approval. The live Lovable project is
not yet connected to this repository; when it is, follow this order exactly.

## Why the order matters
The new hook code rejects any call without a valid `x-cron-secret`. If the code goes live before the
cron jobs send that header, the hourly Freshdesk sync and the 02:00 UTC snapshot stop (401).
Adding the header first is harmless to the old code (it ignores unknown headers).

## Order
1. **Pre-checks**
   - DB backup taken (record timestamp) — SCRUM-62.
   - Not within ±10 min of HH:15 UTC (Freshdesk) or 02:00 UTC (snapshot).
   - `select jobid, jobname, active from cron.job order by jobid;` — note ids; cleanup job must stay `active = false`.
2. **Apply migrations** `20260925120000_scrum89_cron_secret.sql` and `20260925120100_scrum98_import_artifact_legal_hold.sql`.
   Verify:
   ```sql
   select count(*) from vault.secrets where name = 'cron_secret';              -- 1
   select has_function_privilege('anon', 'public.verify_cron_secret(text)', 'execute'); -- false
   select count(*) from public.expired_bulk_import_artifacts(1);               -- 0 (legal hold)
   ```
3. **Add the header to the existing cron commands** (run as SQL by an admin, not as a migration).
   The secret is read from Vault at run time; it is never pasted anywhere.
   Inspect each command first: `select jobid, jobname, command from cron.job;`
   - Snapshot job (`mml-daily-snapshot-sync`, headers built with `jsonb_build_object(...)`):
     ```sql
     select cron.alter_job(jobid, command := replace(command,
       'jsonb_build_object(',
       'jsonb_build_object(''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_secret''), '))
       from cron.job where jobname = 'mml-daily-snapshot-sync' and command not like '%x-cron-secret%';
     ```
   - Freshdesk job (`mml-daily-freshdesk-sync`, headers given as a JSON literal `'{...}'::jsonb`):
     ```sql
     select cron.alter_job(jobid, command := regexp_replace(command,
       '(headers\s*:=\s*''[^'']*''::jsonb)',
       '\1 || jsonb_build_object(''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''cron_secret''))'))
       from cron.job where jobname = 'mml-daily-freshdesk-sync' and command not like '%x-cron-secret%';
     ```
   - Cleanup job (`bulk-import-cleanup-daily`): same pattern as whichever header style it uses; **keep `active = false`**.
   Re-read `select jobname, command from cron.job;` and confirm every command now contains `x-cron-secret`
   and is otherwise unchanged (URL, body, schedule).
4. **Ship the code** (this PR) through Lovable ↔ GitHub sync, then Vivek approves the publish.
5. **Verify** after the next HH:15 UTC run and the next 02:00 UTC run:
   `sync_runs` gets a new row; `freshdesk_tickets.updated_at` moves; anonymous
   `POST /api/public/hooks/mcp-sync` with only the public `apikey` returns 401.
6. Optional clean-up later: remove the old `apikey` header from the cron commands.

## Rollback
- Code: revert this PR in GitHub (the old `apikey` header is still in the cron commands, so the old code keeps working).
- Cron: drop the header with the inverse `replace(...)`.
- Legal hold: only with Vivek's approval, restore the original function body quoted in the migration header.
