# MML Transaction Hub: Gap Analysis

Prepared by Atlas (Executive Chief of Engineering) for Vivek C, 25 Sep 2026 (morning IST).
Scope: live Lovable project `cf3e24da-03ad-433c-be90-bd7ad878f932` (`mml-internal`, https://mml-internal.lovable.app). Reviewed at latest commit `544e54a0909a185a08b89986b700c56a263f7a1c` ("Added admin user mgmt & bulk import", 17 Sep 2026 20:01 IST).
> **Repository copy (redacted).** This copy of the gap analysis has had exploit-level detail removed (exact request headers, parameter names/values, line references to the open endpoints and step-by-step abuse paths). Findings, impact and fixes are unchanged. The unredacted working copy and `findings.json` are held privately by Atlas and are not in this repository.

Method: read-only. We read the source through the Lovable API. On the live database we ran SELECT queries against metadata only (tables, access rules, functions, triggers, indexes, grants, cron and HTTP-call status) plus row COUNTs and counts grouped by date/status. We read no customer, finance, user or ticket contents. Nothing was changed. Nobody was contacted.

Terms used: **RLS** = Row Level Security, the database's per-row access rules. **Publishable/anon key** = the public key every browser gets, which is not a secret. **Service key** = the server's all-powerful database key. **MCP** = the AI-connector endpoint (/mcp) that lets tools like ChatGPT or Claude query the app as a signed-in user. **Cron** = scheduled jobs.

## Summary

The app works and is broadly well organised for a Lovable build. Server functions validate their inputs, most tables have access rules, and there are audit logs. But its security depends almost entirely on the database access rules, and several of those rules are too open. Anyone on the internet can create an account and immediately read all transactions (including cost, revenue and margin), customer contacts and about 1,968 support tickets. One table of per-customer revenue snapshots is even readable without logging in. The "who can see finance KPIs" setting only hides cards in the browser; the data is still sent to every role, including through the AI connector. The scheduled job URLs are guarded by the public key, so anyone can trigger them, including a cleanup job that can delete the stored import files. Those files are the evidence behind a probable 17 Sep data problem: a bulk "update" import made 1,304 field changes to 22 transactions and may have squashed several spreadsheet lines into one, so finance totals need checking. Operationally, every scheduled call times out at the caller after 5 seconds, the Freshdesk sync keeps no run log, and about a third of tickets have not been refreshed for a day or more. The first four fixes (close sign-up, fix two access rules, secure the job URLs, preserve the import evidence) are small, safe to do while the app is live, and should happen this week.

Counts (from the database): 13 app accounts (1 admin, 1 disabled, 2 unconfirmed sign-ups), 24 customers, 58 transactions (0 soft-deleted), 1,968 Freshdesk tickets, 569 snapshot rows, 11 snapshot runs (all success), 3 cron jobs (hourly Freshdesk at :15, daily snapshot 02:00 UTC = 07:30 IST, daily import cleanup 03:15 UTC = 08:45 IST). All 27 public tables have RLS turned on.

**Findings: 26 in total (5 Critical, 6 High, 9 Medium, 6 Low).**

## Critical

### G-01: Anyone on the internet can sign up and read all finance, customer and ticket data

- **Area:** Auth / database access rules (RLS)
- **Evidence:** src/routes/auth.tsx: the 'Sign up' tab calls supabase.auth.signUp for any email (signUp function, ~line 48). DB function public.handle_new_user (SECURITY DEFINER) gives every new account the 'viewer' role with no email-domain check. Access rules 'Role-scoped read transactions', 'Role-scoped read customers', 'Roled users can view tickets', 'Roled users can view report snapshots' all let 'viewer' read. auth.users has 2 unconfirmed sign-ups (count only).
- **Impact:** A stranger can create an account and see revenue, input cost, margin, customer contacts and ~1,968 support tickets (requester names and emails). They can also connect an AI tool through the MCP server and pull the same data.
- **Recommended fix:** Turn off public sign-up in Lovable Cloud auth settings and remove the Sign-up tab. Change handle_new_user so new accounts get NO role (a 'pending' state) until an admin grants one, and optionally allow only company email domains. Review all 13 accounts (SCRUM-45).
- **Effort:** S
- **Safe while partially live:** Yes. Existing users are not affected. Needs Vivek approval because it changes who can get access.
- **Needs Vivek decision:** Yes

### G-02: People who are not signed in can read, and probably delete, the revenue snapshot table

- **Area:** Database access rules (RLS)
- **Evidence:** pg_policies: report_snapshots policy 'No direct writes to report snapshots' is FOR ALL, TO anon+authenticated, USING (true), WITH CHECK (false). sync_runs has the same pattern ('No direct writes to sync runs'). The table grants for the anonymous role are also too broad on both tables. Because Postgres allows access when ANY permissive rule allows it, this rule effectively opens the tables to unauthenticated callers. report_snapshots has 569 rows of revenue/cost/profit/margin per customer per month.
- **Impact:** Customer-level revenue and margin can be read without logging in. Snapshot history and sync history could be wiped. (Read from the rule definitions only. We did not test an actual exploit on live.)
- **Recommended fix:** Drop both 'No direct writes' rules (with no write rule, writes are already blocked) or recreate them as RESTRICTIVE rules. Revoke anon privileges on these tables. Verify the fix in the sandbox before applying it to live.
- **Effort:** S
- **Safe while partially live:** Yes. The server writes these tables with the service key, which ignores these rules.
- **Needs Vivek decision:** No

### G-03: Scheduled job URLs are 'protected' only by the public key, so anyone can trigger them, including deleting import evidence

- **Area:** Scheduled jobs / API routes
- **Evidence:** The three scheduled-job routes under src/routes/api/public/hooks/ (freshdesk-sync, mcp-sync, bulk-import-cleanup) authenticate callers by comparing a request value with the Supabase publishable key. That key is public by design (it ships to every browser), so it is not a real credential. The cleanup and Freshdesk routes also accept caller-supplied tuning values (retention window, page limit) without safe server-side bounds. [Exact request details redacted in this copy.]
- **Impact:** An outside party could: (a) trigger the cleanup job in a way that deletes the stored original import CSVs and error files, which are the evidence needed for the 17 Sep data issue (G-05); (b) trigger Freshdesk sync repeatedly, using up the company's Freshdesk API quota; (c) trigger snapshot runs.
- **Recommended fix:** Create a dedicated secret (for example CRON_SECRET) in Lovable/Supabase secrets. Check it with a constant-time compare, and update the three cron.job commands at the same time (keep the secret in Supabase Vault, not written into the job text). Ignore caller-supplied retention and page-limit values and use fixed server-side values. Add simple rate limiting.
- **Effort:** S
- **Safe while partially live:** Yes, if the code change and the cron job update ship together. Coordinate the timing.
- **Needs Vivek decision:** No

### G-04: Hiding finance KPIs is done only in the browser. The server still sends cost, revenue and margin to every role

- **Area:** Permissions / finance visibility
- **Evidence:** src/lib/permissions.ts usePermissions() reads role_permissions in the browser and hides cards. RLS 'Role-scoped read transactions' returns selling_cost and input_cost to all six roles, including viewer and ops_user. MCP tool src/lib/mcp/tools/reports-summary.ts returns revenue/profit/margin to any signed-in role. report_snapshots is readable by any user with a role. Excel exports use the same queries.
- **Impact:** Anyone told they cannot see revenue or margin can still get it through the browser's network tab, an export or an AI client connected over MCP. The permission matrix gives a false sense of control.
- **Recommended fix:** Decide the real rule (who sees finance). Then enforce it in the database: move cost fields behind a secure view or function that checks for the 'finance'/'leadership'/'admin' roles, give other roles a view without cost columns, and apply the same check in the MCP tools, exports and snapshot reads. Roll out in three steps: add the views, switch the UI, then revoke direct column access.
- **Effort:** M
- **Safe while partially live:** Yes, if staged as described. Needs Vivek decision on the visibility matrix.
- **Needs Vivek decision:** Yes

### G-05: A bulk 'update' import on 17 Sep likely overwrote transaction lines. Finance figures may be wrong

- **Area:** Data integrity / bulk import
- **Evidence:** Commit 544e54a (17 Sep 20:01 IST) changed src/components/bulk-import.tsx so duplicates match on potential_id+month+year+lab_name. Before, they matched on potential_id alone, and an 'update' rewrote the existing row. roadmap.md in that commit says 'honest updated_rows backfill (53a62ca5 -> 58)'. DB counts: on 17 Sep, transaction_activity_log recorded 1,304 field changes on only 22 distinct transactions (fields month, lab_name, start_date, end_date, selling_cost, total_users, cloud_provider). One completed 'update' import run reports 58 updated rows. Today every Potential ID has exactly one transaction. Commit 2aa5d8f (06:31 IST, 17 Sep) had just allowed several transactions per Potential ID.
- **Impact:** Where the spreadsheet had several lines (for example months) for one Potential ID, they were probably squashed into one transaction holding the LAST line's month, lab and price, and the other lines were never created. Monthly revenue, users and margin reports may be understated or wrong.
- **Recommended fix:** Treat this as a finance incident. (1) Preserve the evidence now: the 5 stored import CSVs, bulk_import_row_audit, and transaction_activity_log old/new values (see G-03 and G-19). (2) Rebuild the intended rows in the sandbox from those sources. (3) Have finance check the 22 affected transactions. (4) Apply the corrections to live only with Atlas go-ahead and Vivek approval.
- **Effort:** M
- **Safe while partially live:** The analysis is read-only and safe. Corrections need Vivek approval.
- **Needs Vivek decision:** Yes

## High

### G-06: Any signed-in user can read ANY ticket conversation in the company's whole Freshdesk, not just Cloud Labs

- **Area:** Freshdesk integration
- **Evidence:** src/lib/freshdesk.functions.ts getTicketHistory: no role check, and no check that the requested ticket belongs to the synced Cloud Labs set before it fetches conversations from Freshdesk with the company API key. getAgentDirectory returns every helpdesk agent's name and email to any signed-in user.
- **Impact:** A viewer (or a self-signup, see G-01) could read private ticket conversations belonging to other departments and customers.
- **Recommended fix:** Require an ops role, and require that the ticket exists in freshdesk_tickets (Cloud Labs group) before calling Freshdesk. Limit the agent directory to ops roles.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-07: All scheduled jobs time out on the caller's side, and Freshdesk sync keeps no run log. Failures are invisible

- **Area:** Scheduled jobs / observability
- **Evidence:** net._http_response: all 7 stored responses (24 Sep 21:15 UTC to 25 Sep 02:15 UTC; pg_net keeps only about 6 hours) show timed_out=true after 5,000 ms with no status code. The cron.job commands set no timeout_milliseconds. cron.job_run_details shows 193 'succeeded' Freshdesk runs, but that only means the request was sent. runFreshdeskSync returns a result that nothing stores: sync_runs holds only the 11 snapshot runs.
- **Impact:** Supabase logs show hourly timeouts, which are probably part of the 'known errors'. When Freshdesk sync really fails (wrong key, rate limit), nobody finds out.
- **Recommended fix:** Record every Freshdesk run in sync_runs (kind='freshdesk', status, counts, error). Have the hook reply at once (202) and keep working in the background, or set the pg_net timeout to about 60 seconds. Show Freshdesk runs on the Sync Status page and alert after 2 failures in a row.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-08: Freshdesk sync re-downloads everything every hour and leaves about a third of tickets stale

- **Area:** Freshdesk integration
- **Evidence:** src/lib/freshdesk.server.ts runFreshdeskSync always asks for updated_since=2026-04-01 (a fixed date, not the last sync), so every hourly run walks every page. The code comment says 'touches only the first page or two', which is wrong. Page numbers are sorted by updated_at desc, so tickets that change mid-run shift between pages and get skipped or repeated. Tickets moved out of the Cloud Labs group, or deleted, are never removed. A 429 (rate-limit) retry sleeps up to 60 s, 3 times, inside the web request. DB: of 1,968 rows, 1,347 were refreshed at 25 Sep 02:16 UTC, 510 not since 17 Sep 22:16 UTC, and the rest on various days.
- **Impact:** The Tickets page and agent KPIs show old status or agent for many tickets. Heavy Freshdesk API use risks rate limits for everyone using that Freshdesk account.
- **Recommended fix:** Sync from the last successful run (minus a 10-minute overlap) and store that point in a sync cursor. Filter by group on the Freshdesk side (search API). Run a nightly full check that marks tickets no longer in the group. Move retries out of the web request. Hard-code the group id and start date in config, not code.
- **Effort:** M
- **Safe while partially live:** Yes. Upserts are keyed on ticket id, so this is safe to change.
- **Needs Vivek decision:** No

### G-09: 'AI' Command Center puts fake demo data in live, quotes fixed prices, and can write to real Freshdesk

- **Area:** AI Command Center
- **Evidence:** src/lib/ai-command-center.functions.ts: no AI model or API key is used. The 'agents' are fixed templates. The generalist always quotes INR 1,350 per learner, 45 learners, 3 months, whatever the question. The cost_adr branch INSERTS a made-up 'Cognizant' CONFIRMED lab request (INR 182,500 / 312,000) into live when none exists. confirmInboxItem posts a private note and a status change to the real Freshdesk ticket; if that fails, it still marks the item 'confirmed' (write_result.stubbed). DB counts: 2 lab requests, 7 runs, 12 inbox items, 0 confirmed ticket proposals so far.
- **Impact:** Fake records mix with real ones. Staff could forward made-up cost quotes to customers. A confirm can change a live customer ticket. There is no prompt-injection risk today because no language model is called, but that will change once one is added.
- **Recommended fix:** Label the whole area 'Preview' or hide it behind a feature flag on live. Remove the demo seeding. Limit confirm-with-external-write to ops_lead/admin. If a Freshdesk write fails, fail loudly and do not mark the item confirmed. Before adding a real model, design data minimisation and injection defences.
- **Effort:** S
- **Safe while partially live:** Yes. Hiding or flagging is non-destructive. Needs Vivek decision on whether it stays visible.
- **Needs Vivek decision:** Yes

### G-10: Bulk import writes straight from the browser, row by row, with weak server checks and no duplicate protection in the database

- **Area:** Bulk import
- **Evidence:** src/components/bulk-import.tsx runs the apply loop in the browser using the browser Supabase client, with no database transaction. validateBulkImportRows (src/lib/bulk-import.functions.ts) checks only line_of_business and that fields are present, not numbers, dates or provider. Audit events are fire-and-forget ('void supabase.from(...).insert'). Closing the tab leaves 'pending' runs (a workaround 'Abandon pending import' button was added 17 Sep). No unique index on potential_id+month+year+lab_name (0 duplicates today). input_cost has no >= 0 check.
- **Impact:** Half-finished imports, silent duplicates if two people import at once, missing audit records, and bad values checked only by the browser.
- **Recommended fix:** Move 'apply' to a server function that calls a single database function (all-or-nothing). Validate every column on the server with the same zod schema. Add a unique index on the natural key (safe today, since there are 0 duplicates) and CHECK (input_cost >= 0).
- **Effort:** M
- **Safe while partially live:** Yes. The index and check are safe now. Move the apply step via the sandbox first.
- **Needs Vivek decision:** No

### G-11: Deleting a user will fail for anyone who created records, and admin actions are not all-or-nothing

- **Area:** Admin user management
- **Evidence:** src/lib/admin.functions.ts adminDeleteUser hard-deletes the auth user, but transactions_created_by_fkey, transactions_updated_by_fkey and customers_created_by_fkey reference auth.users with no ON DELETE rule, so deleting anyone who created or edited a transaction or customer fails with a foreign-key error. bulk_import_runs and user_roles use ON DELETE CASCADE (history lost). adminCreateUser deletes the default role and then inserts the new roles; if the insert fails, the user has NO role and sees empty or error pages. Disabling a user bans future logins, but a session already open lasts up to about 1 hour. has_role() ignores profiles.is_active.
- **Impact:** Likely source of 'Delete user' errors. Hard delete would destroy audit history. Half-created users.
- **Recommended fix:** Replace delete with deactivate (hide the delete button, or allow it only for users with no records). Wrap create/role changes in a single database function. On disable, sign out the user's sessions too. Make has_role check is_active.
- **Effort:** S
- **Safe while partially live:** Yes. Needs Vivek decision on whether hard delete is ever allowed.
- **Needs Vivek decision:** Yes

## Medium

### G-12: Only one Super Admin account exists

- **Area:** Admin / access
- **Evidence:** user_roles: exactly 1 row with role 'admin' (count only).
- **Impact:** If that person is unavailable, or the account is locked, nobody can manage users. Single point of failure.
- **Recommended fix:** Vivek names a second Super Admin (a break-glass account with strong password and MFA). Record who holds it.
- **Effort:** S
- **Safe while partially live:** Yes. Access change, so Vivek approves.
- **Needs Vivek decision:** Yes

### G-13: The anonymous role has full table privileges (including TRUNCATE) on almost every table

- **Area:** Database privileges
- **Evidence:** information_schema.role_table_grants: 'anon' and 'authenticated' have DELETE, INSERT, UPDATE, TRUNCATE, SELECT on nearly all public tables. Access rules (RLS) are the only barrier.
- **Impact:** Any future rule mistake (like G-02) immediately becomes a public data leak or data loss.
- **Recommended fix:** REVOKE ALL on public tables FROM anon; grant authenticated only what the app uses (SELECT plus the specific writes). Test in the sandbox first.
- **Effort:** S
- **Safe while partially live:** Yes, after a sandbox test (the app never reads data as anon).
- **Needs Vivek decision:** No

### G-14: Tickets page loads every ticket, including full text, on each visit and calls Freshdesk each time

- **Area:** Performance
- **Evidence:** src/lib/freshdesk.functions.ts getTicketsOverview pages through up to 5,000 rows of select('*') including description_text, adds everything up in memory, and calls checkFreshdeskConnection() (a live Freshdesk request) on every load. Rows above 5,000 are silently dropped.
- **Impact:** Slow page, uses Freshdesk quota, and wrong totals once there are more than 5,000 tickets.
- **Recommended fix:** Do counts and groupings in SQL (views or functions), paginate the list, load description only in the detail view, and cache the connection status.
- **Effort:** M
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-15: Type safety is switched off in many places and the database types may be out of date

- **Area:** Code quality / types
- **Evidence:** Repeated 'as never', 'as any', 'as unknown as { from: (t: string) => any }' in ai-command-center.functions.ts (eslint no-explicit-any disabled for the file), admin.functions.ts (sb: any), freshdesk.server.ts, sync.server.ts, bulk-import-cleanup.ts. src/lib/mcp/audit.ts says 'Types are regenerated after migration approval; cast until then'.
- **Impact:** Column renames or typos only show up at runtime, as errors for live users.
- **Recommended fix:** Regenerate src/integrations/supabase/types.ts from the live schema, remove the casts, and turn on typecheck and lint in CI.
- **Effort:** M
- **Safe while partially live:** Yes (code only).
- **Needs Vivek decision:** No

### G-16: Tests exist but nothing runs them; security rules have no tests

- **Area:** Testing / CI
- **Evidence:** 2 vitest unit tests (src/lib/__tests__). 27 Python Playwright scripts in tests/e2e need a local dev server plus injected session variables. No CI config. No tests for the access rules, admin functions, Freshdesk sync or MCP permissions.
- **Impact:** Changes reach live without automatic checks. That is how G-02 and G-05 slipped through.
- **Recommended fix:** Connect GitHub properly, then add GitHub Actions for typecheck + lint + vitest. Add SQL-level access-rule tests run against the sandbox. Move key Playwright flows to run against the sandbox.
- **Effort:** M
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-17: Errors are often swallowed or sent raw to the browser

- **Area:** Error handling
- **Evidence:** freshdesk.server.ts loadLookup ignores failures. Audit inserts use 'void' or empty catch. Storage delete errors are silently counted as 'not deleted'. The cleanup route ignores errors from clear_bulk_import_artifact_paths. Server functions throw raw database error text (error.message) to the UI.
- **Impact:** Failures go unnoticed, and internal details (table and constraint names) show up to users.
- **Recommended fix:** Add one error helper: log the full error on the server with a request id, and show users a friendly message plus the id. Stop ignoring audit failures.
- **Effort:** M
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-18: Spreadsheet library 'xlsx' 0.18.5 has known security flaws

- **Area:** Dependencies
- **Evidence:** package.json: "xlsx": "^0.18.5" (the last npm release; known issues include prototype pollution CVE-2023-30533 and ReDoS CVE-2024-22363). Used by src/lib/export-xlsx*.ts. We still need to check whether it also parses uploaded files.
- **Impact:** If it parses uploads, a crafted file from an insider could crash or corrupt the page.
- **Recommended fix:** Upgrade to the maintained SheetJS build (0.20.x from cdn.sheetjs.com) or switch to exceljs. Run npm audit in CI.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-19: Evidence for the 17 Sep issue will be auto-deleted (90-day cleanup), or sooner through G-03

- **Area:** Data retention
- **Evidence:** cron job 'bulk-import-cleanup-daily' (03:15 UTC daily) deletes original CSVs and error files for runs older than 90 days. 5 bulk_import_runs currently have stored CSV paths, all from 17 Sep.
- **Impact:** We lose the only original copy of what was imported. That copy is needed to fix G-05.
- **Recommended fix:** Pause the cleanup cron, or add a 'legal hold' flag the cleanup respects, and copy the 5 artifacts to a restricted archive. Only an admin should do this.
- **Effort:** S
- **Safe while partially live:** Yes. It touches finance evidence, so Atlas and then Vivek approve.
- **Needs Vivek decision:** Yes

### G-20: Users can edit their own profile email and active flag, and can write fake audit rows

- **Area:** Database access rules (RLS)
- **Evidence:** profiles rule 'Users update own profile' (USING id = auth.uid()) has no column limit, so a user can change their own email/is_active in profiles. That email is used for duplicate checks and audit names. ticket_action_log and mcp_tool_audit_log allow direct inserts by any user (only actor_id must match).
- **Impact:** Audit trails can be spoofed. The app's duplicate-email checks can be confused.
- **Recommended fix:** Restrict profile updates to full_name (column grants or a trigger). Write audit rows only from the server or triggers, never directly from the browser.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

## Low

### G-21: Reading pages rely on database rules only. Route guard checks login, not role

- **Area:** Routing / guards
- **Evidence:** src/routes/_authenticated/route.tsx only checks that a user exists. Pages like /admin, /sync-status, /mcp-audit hide content in the component. Read functions (getSyncOverview, listInbox, listAudit, getTicketsOverview) have no role checks and depend on RLS.
- **Impact:** Defence depends on RLS being perfect (see G-02). Users without a role see broken pages instead of a clear message.
- **Recommended fix:** Add a per-route role requirement in beforeLoad, plus the same check in each server function, and a clear 'no access' page.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-22: .env (public Supabase settings) is committed to the project

- **Area:** Env / secrets
- **Evidence:** .env lines 1-6 hold the Supabase project id, URL and publishable (anon) key. These are public by design, not secrets. No private keys, service keys or Freshdesk keys were found in source. The Freshdesk key and service key come from server env vars.
- **Impact:** No direct leak. But the same public key is used as the scheduled-job credential (G-03), and future secrets might get added to the same file.
- **Recommended fix:** Keep .env out of the GitHub repo. Add .env.example with names only. Document every env variable name in the README.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-23: Duplicate code, duplicate indexes and unused UI components

- **Area:** Maintainability
- **Evidence:** admin.functions.ts: adminSetUserRoles/adminSetUserActive repeat the logic of syncRoles/applyActive, and adminUpdateUser is an alias. has_role checks are copied inline in 6+ files. Identical indexes bulk_import_runs_parent_run_id_idx and idx_bulk_import_runs_parent. About 50 generated shadcn ui components, many unused.
- **Impact:** Fixes must be made in several places. Easy to miss one.
- **Recommended fix:** Add one requireRole() helper, remove the duplicate functions, drop the duplicate index, and prune unused components during the rebuild.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-24: Business settings are hard-coded in source

- **Area:** Configuration
- **Evidence:** freshdesk.server.ts: CLOUD_LABS_GROUP_ID = 1060000391179 and TICKETS_FROM = 2026-04-01. sync.functions.ts: the cron time is hard-coded for display. The snapshot cron points to mml-internal.lovable.app, while the other two crons point to project--<id>.lovable.app.
- **Impact:** Changing scope needs a code change. The crons break differently if a domain changes.
- **Recommended fix:** Move these to config_master or env vars, and use one base URL for all crons.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-25: Any user can claim to be any helpdesk agent

- **Area:** Freshdesk integration
- **Evidence:** freshdesk.functions.ts setMyAgentIdentity accepts any agentName/agentId from the caller.
- **Impact:** A user can view another agent's KPIs. Low harm, but confusing.
- **Recommended fix:** Allow only matching by email, or admin-assigned identities.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No

### G-26: Snapshot table grows forever

- **Area:** Data retention
- **Evidence:** sync.server.ts inserts about 56 rows per daily run and never prunes (569 rows now). There is no unique key per run+slice.
- **Impact:** Small today. It slowly adds clutter and cost.
- **Recommended fix:** Keep daily snapshots for 90 days and month-end snapshots forever.
- **Effort:** S
- **Safe while partially live:** Yes.
- **Needs Vivek decision:** No
## Likely causes of the known errors

We don't have John's list of known errors yet, so these are the best candidates from the evidence, most likely first:

1. **Hourly "timeout" errors from scheduled jobs (G-07).** Every pg_net call to the three job URLs times out after 5 s (all stored responses, 25 Sep 02:45–07:45 IST). Cron still reports "succeeded". Snapshot runs still finish (11 successes), and Freshdesk runs usually finish after the caller has given up. This shows up as a steady stream of errors in the Supabase logs.
2. **Wrong or missing transaction lines after the 17 Sep bulk update (G-05).** Before the 20:01 IST fix on 17 Sep, a bulk "update" matched on Potential ID only. The data shows 1,304 field changes on 22 transactions that day. Users would see wrong months, labs or prices, or missing lines.
3. **Bulk imports stuck on "pending" and blocking retries (G-10).** A workaround ("Abandon pending import") was added in the last commit. This points to a real, recurring symptom whenever a browser tab closes mid-import.
4. **"Delete user" fails with a foreign-key error (G-11)** for any user who created or edited a transaction or customer (`transactions_created_by_fkey`, `transactions_updated_by_fkey`, `customers_created_by_fkey` have no ON DELETE rule). The delete feature shipped in the last commit.
5. **Users seeing blank pages or "permission" errors** if `adminCreateUser` failed half-way and left them with no role (G-11). Also a self-signup who holds only 'viewer' will hit write errors.
6. **Stale or missing tickets and wrong agent KPIs (G-08).** 510 tickets not refreshed since 18 Sep 03:46 IST. Tickets that move group are never removed. Page-number drift during sync.
7. **Slow Tickets page / Freshdesk 429 rate limits (G-08, G-14).** Hourly full re-pull, a live Freshdesk call on every Tickets page load, and 60-second retry sleeps inside web requests.
8. **AI Command Center "confirmed" items that did nothing (G-09).** A failed Freshdesk write is recorded as confirmed ("stubbed").
9. **Runtime column errors** from out-of-date generated types hidden by `as never` casts (G-15). Possible, but we saw no direct evidence.

We could not see app or edge logs through the API. John's team should compare this list with the actual error messages.

## Questions for John's team

1. What exactly are the "known errors": which page, which message, since when, and for which users?
2. Was public sign-up on the login page intentional? Who are the 2 unconfirmed sign-ups? Which of the 13 accounts are real team members?
3. Bulk import run `53a62ca5…` on 17 Sep (strategy "update", 58 updated rows): which spreadsheet was it? Did it contain several lines per Potential ID? Do you still have the original file? Did anyone check the 22 changed transactions afterwards?
4. Is the 'viewer' role supposed to see cost, revenue and margin? Please send the intended finance visibility per role (admin, leadership, finance, ops_lead, ops_user, viewer).
5. Does any code or change live outside Lovable (local copies, another repo, manual SQL run in Supabase)? Did you already create a GitHub repo for this app?
6. Freshdesk: is the API key tied to a dedicated service agent or a person? What plan or rate limit do you have, and who else uses that quota? Should tickets moved out of Cloud Labs disappear from the app?
7. Who set up the three cron jobs, and where is their key stored? (The cron commands embed a key; we did not print it.)
8. MCP: which AI clients are connected, and by whom (6 tool calls logged)? Was the OAuth consent screen reviewed?
9. AI Command Center: which AI model or provider was planned? Were the 2 lab requests created by the demo seeding or by real users?
10. Supabase Auth settings: is email confirmation on? Password rules, leaked-password protection, MFA?
11. Are the 27 Python end-to-end tests run anywhere? Against which environment and accounts?
12. Why are there 11 'viewer' role rows for 13 users (many users hold viewer plus another role)? Intended or leftover?

## Needs owner (Vivek) decision

1. **Close public sign-up** and require admin-granted roles (G-01). This changes access.
2. **Finance visibility matrix:** who may see cost, revenue and margin. Then we enforce it on the server (G-04).
3. **A second Super Admin:** who holds it (G-12).
4. **User delete policy:** allow hard delete, or deactivate only (G-11)?
5. **17 Sep data correction:** approve a finance review of 22 transactions and any corrections to live (G-05). Approve pausing the import-file cleanup and archiving the 5 files (G-19).
6. **AI Command Center on live:** keep visible, label as Preview, or hide behind a flag (G-09)?
7. **GitHub home** (for the review snapshot this was settled on 25 Sep 2026 with a private repo under `Tech274`; the long-term home for Lovable's native GitHub sync is still open): `Admin-mmlabs` is a personal GitHub user account, not an organization, and the connected GitHub login (`Tech274`) cannot create repos under it. Choose: (a) create a real organization (e.g. convert or create "mmlabs") and add Tech274 as owner; (b) use the existing `MAKE-MY-LABS` organization (Tech274 is a member there, not an owner); or (c) sign in to GitHub as `Admin-mmlabs` in Lovable's GitHub integration.
8. **Publishing:** approve publishing each security fix once Atlas has signed it off in the sandbox.
