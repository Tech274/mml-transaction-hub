# RLS audit (SCRUM-57, G-02 / G-13), 28 Sep 2026

**Method.** Every migration in `supabase/migrations/` is applied to an in-process Postgres
(PGlite) on top of a small Supabase stand-in (`supabase/tests/local/platform-stub.sql`: roles,
`auth.uid()`, and Supabase's default grants to `anon` / `authenticated`). Access is then checked
as each role with `src/lib/__tests__/rls-policies.test.ts`, which runs in CI on every PR.
Synthetic data only. Nothing here touched sandbox or live.

**Limits.** The stand-in is not Supabase. Live may hold grants or policies that were never
written as migrations (edits made in the Lovable SQL editor). Before relying on this audit for
live, run the drift check at the end of this page in the sandbox and on live (read-only).

## Result

- RLS is **on for all 28 tables** in `public`.
- `anon` (logged out) has **no privilege on any table**. It can't call any SECURITY DEFINER function. The 25 Sep lockdown holds.
- A signed-in user with **no role** (the default for new accounts) sees **no rows** in any business table and can't give itself a role.
- **G-02 / G-13 are fixed in code.** The "No direct writes" policies on `report_snapshots` and `sync_runs` are `AS RESTRICTIVE`, so they don't widen reads. Write privileges were revoked on 25 Sep (`20260925024238`). The tests prove anon and no-role users can't read or delete there.
- Audit tables (`role_audit_log`, `permission_audit_log`, `customer_audit_log`, `transaction_activity_log`) are written by triggers only (SCRUM-99, #5).
- The two sandbox SQL checks that had never been run (`supabase/tests/rls/scrum99_profiles_audit.sql`, `scrum103_import_batch.sql`) **pass** against the local database.

## Change in this PR (migration file only, not applied)

`20260928010000_scrum57_revoke_unused_write_grants.sql`: defence in depth, **no behaviour change**.
Supabase's default grants give `authenticated` INSERT/UPDATE/DELETE on every table. Where no
policy allows the command, the database already returns 0 rows. The migration removes those
unused privileges so a mistaken future policy can't open them:

| Table(s) | Privilege removed from `authenticated` | Why it's safe |
|---|---|---|
| `ai_cc_runs`, `ai_cc_inbox`, `ai_cc_audit`, `ai_cc_lab_requests` | INSERT, UPDATE, DELETE | Users read only; the server writes with the service role |
| `bulk_import_audit_events`, `bulk_import_row_audit`, `bulk_import_jobs`, `mcp_tool_audit_log`, `ticket_action_log` | UPDATE, DELETE | Append-only; no update/delete policy |
| `transactions`, `customers`, `bulk_import_runs` | DELETE | Soft delete / deactivate; no delete policy |
| `mcp_revoked_clients` | UPDATE | Rows are added or removed only |
| all tables | TRIGGER, REFERENCES (also from `anon`) | Never needed by app users |
| `fuzzy_search_transactions()` | EXECUTE from PUBLIC/anon | Still granted to `authenticated` |

The rollback SQL is in the migration header.

## Table by table (after the migration)

Roles: A admin, L leadership, F finance, OL ops_lead, OU ops_user, V viewer, "any role" = any of these.

| Table | Read | Write from the browser | Notes |
|---|---|---|---|
| transactions | any role | insert: A/OL/OU (own `created_by`); update: A/OL, OU own rows | no delete (soft delete); finance columns visible to every role, see finding 1 |
| customers | any role | insert A/OL/OU; update A/OL | no delete |
| report_snapshots, sync_runs | any role | none | finding 1 |
| transaction_activity_log | any role | none (trigger) | |
| customer_audit_log | A/OL | none (trigger) | |
| role_audit_log, permission_audit_log | A | none (trigger) | |
| profiles | own row; A all | own `full_name` only (trigger guard); A all | |
| user_roles | own rows; A all | A | |
| role_permissions, config_master | any role | A | |
| account_managers | any role | A/OL | |
| freshdesk_tickets | any role | none | finding 1 (ticket history scope is SCRUM-91) |
| ticket_action_log | any role | insert own `actor_id` | append-only |
| agent_identities | own; A all | own row (insert/update/delete) | finding 2 |
| ai_cc_* (4 tables) | any role | none (server only) | |
| bulk_import_runs | own; A/L/OL all | insert/update own | finding 3 |
| bulk_import_jobs | own; A/OL all | insert own (A/OL/OU) | |
| bulk_import_presets | shared or own | own (A/OL/OU); A all | |
| bulk_import_audit_events, bulk_import_row_audit | own; A/OL(/L) all | insert own | append-only |
| import_batches | A/OL/OU/L | none (function only) | |
| mcp_tool_audit_log | own; A all | insert own | append-only |
| mcp_revoked_clients | own; A all | insert/delete own | finding 4 |
| storage `bulk-imports` | own folder; A/OL all | insert own folder (A/OL/OU); update/delete own | finding 3 |

## Findings that need a decision or another ticket (not changed here)

1. **Finance and ticket data are readable by every role, including viewer.** This covers transactions (costs, selling price), report_snapshots (revenue/cost/profit) and freshdesk_tickets. Narrowing this is the finance visibility matrix: **SCRUM-58, Vivek decision**. Ticket scope: SCRUM-91.
2. **agent_identities can be written directly.** `setMyAgentIdentity` checks on the server that the agent exists and its email matches (SCRUM-102), but the policy "Users manage their own agent identity" also lets a user upsert any agent id straight through the REST API with their own token. Fix (separate PR, needs a release order): replace the policy with read/delete-own and write through the service role after the check.
3. **Import evidence can be changed by its uploader.** The uploader can update their own `bulk_import_runs` rows (including `original_csv_path` / `error_artifact_path`) and update or delete their own files in the `bulk-imports` bucket. The SCRUM-98 legal hold only stops the clean-up job. Tightening this belongs to **SCRUM-98 (on hold)**.
4. **A user can delete their own MCP revocation** (`mcp_revoked_clients`), which re-enables a client they revoked. Probably intended ("undo"), but it should be confirmed in the MCP scope review (**SCRUM-59**).
5. **`has_role` / `has_any_role` accept any user id.** Any signed-in user can ask whether another user id holds a role (they'd need the id first). Low risk; restricting it needs care because RLS policies and server code call it. Logged for later.

## Drift check (read-only; run in sandbox, then live with approval)

```sql
-- Compare with the "Table by table" section. Read-only.
select tablename, policyname, permissive, cmd, roles::text, qual, with_check
  from pg_policies where schemaname in ('public','storage') order by 1, 2;
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
 group by 1, 2 order by 1, 2;
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;  -- expect 0 rows
```
