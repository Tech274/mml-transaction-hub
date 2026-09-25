# MML Transaction Hub: Top 15 Actions (ordered by impact ÷ effort)

Owner suggestions: **John's team** builds in the sandbox, **Atlas** reviews and gives the engineering go-ahead, **Vivek** decides and approves publishing. Every item goes through sandbox, then Atlas go-ahead, then live, then Vivek publish approval.

| # | Action | Finding | Effort | Owner | Vivek decision? |
|---|---|---|---|---|---|
| 1 | Turn off public sign-up. Remove the Sign-up tab. New accounts get no role until an admin grants one. | G-01 | S | John's team (Atlas reviews) | **Yes** (access change) |
| 2 | Fix the `report_snapshots` / `sync_runs` "No direct writes" rules (they currently allow anonymous read and delete) and revoke anon table privileges. | G-02, G-13 | S | John's team | No (security fix; publish needs approval) |
| 3 | Protect the 3 job URLs with a real secret (not the public key). Update the cron commands at the same time. Stop accepting caller-supplied tuning values; use fixed server-side values. | G-03 | S | John's team | No |
| 4 | Pause the import-file cleanup cron and archive the 5 stored CSVs from 17 Sep. | G-19, G-05 | S | Atlas (admin action) | **Yes** (finance evidence) |
| 5 | Investigate the 17 Sep bulk "update" run: rebuild the intended rows from activity log + CSVs in the sandbox; finance checks 22 transactions; correct live. | G-05 | M | John's team (analysis), finance (check), Atlas (review) | **Yes** (approve corrections) |
| 6 | Add role checks to ticket history (Cloud Labs tickets only) and the agent directory. | G-06 | S | John's team | No |
| 7 | Record every Freshdesk sync run in `sync_runs`. Fix the 5-second job timeouts (reply 202 at once, or raise the pg_net timeout). Show and alert on failures. | G-07 | S | John's team | No |
| 8 | Decide the finance visibility matrix, then enforce it in the database (secure views), in MCP tools and in exports. | G-04 | M | Vivek decides; John's team builds; Atlas reviews | **Yes** |
| 9 | Name a second Super Admin (break-glass account, MFA). | G-12 | S | Vivek | **Yes** |
| 10 | Replace "Delete user" with deactivate. Make create-user all-or-nothing. Sign out sessions on disable. has_role checks is_active. | G-11 | S | John's team | **Yes** (delete policy) |
| 11 | AI Command Center: label as Preview or feature-flag on live, remove the fake "Cognizant" demo seeding, make failed Freshdesk writes fail loudly. | G-09 | S | John's team | **Yes** (visibility) |
| 12 | Freshdesk sync: sync from the last run (cursor), filter by group in Freshdesk, run a nightly check that removes stale tickets, move retries out of the request. | G-08, G-14 | M | John's team | No |
| 13 | Bulk import: move apply to a server all-or-nothing function, validate every column on the server, add a unique index on potential_id+month+year+lab_name and CHECK input_cost >= 0. | G-10 | M | John's team | No |
| 14 | Connect GitHub properly (org decision), add CI (typecheck, lint, vitest, npm audit) and database access-rule tests against the sandbox. Upgrade `xlsx`. | G-16, G-18, G-15 | M | Vivek (org choice), workspace admin connects Lovable → GitHub, Atlas sets up CI | **Yes** (which GitHub org) |
| 15 | Lock audit tables to server-only writes and restrict profile self-edits to full name. | G-20 | S | John's team | No |

Later (after the top 15): route-level role guards (G-21), error-handling helper (G-17), folder restructure per REBUILD_PLAN.md, config out of code (G-24), cleanup of dead code and duplicate indexes (G-23), snapshot retention (G-26).
