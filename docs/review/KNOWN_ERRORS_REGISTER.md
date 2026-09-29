# Known errors register (SCRUM-63)

One place for every known error in MML Transaction Hub: where it came from, its ticket, how it
is reproduced, what is fixed in `main`, and what is still open. Updated 28 Sep 2026 (main after
PR #31). All times IST.

- **Code status** covers `main` only. **Nothing from GitHub is live yet.** Live still runs the
  Lovable build from 25 Sep. The only live fixes are the 25 Sep emergency lockdown changes
  (sign-up closed, no default role, anon locked out), which PR #1 brought into the repo.
- **Reproduced** means an automated test in the repo shows the faulty behaviour is gone (it
  fails on the old code or rules), or, where marked, a sandbox check is still needed. Live data is
  never used to reproduce.
- **Data-impacting** errors (they can change, lose or expose business data) are marked **High** and
  come first in the 30-day plan (`docs/review/CURRENT_STATE_AND_30_DAY_ROADMAP.md`, SCRUM-46).
- Exploit-level detail is kept out of this file, the same as `GAP_ANALYSIS.md` (repository copy).

## 1. Owner-reported errors

**Not received yet.** The ticket asks for the errors the owner has seen: page, message, since when,
which user. That list has to come from Vivek, or from John's team, whose first question in
GAP_ANALYSIS asks for it. Until it arrives, section 3 lists the best candidates from the evidence.
Add each report here as it comes in:

| # | Reported by / date | Page | Message / symptom | Since | Users | Matches | Reproduced? | Ticket |
|---|---|---|---|---|---|---|---|---|
| – | _waiting for the list_ | | | | | | | |

## 2. Review findings G-01 … G-26 (GAP_ANALYSIS, 25 Sep)

| G | Error (short) | Sev | Data-impacting | Ticket | Fix in `main` (PRs) | Reproduced by | Code status | Still open / next step | Waits on |
|---|---|---|---|---|---|---|---|---|---|
| G-01 | Anyone could sign up and read all data | Critical | **High** | SCRUM-88 | #1 (live lockdown synced) | `src/lib/__tests__/rls-policies.test.ts` (no-role account sees nothing) | Fixed; live since 25 Sep | Review existing accounts (SCRUM-45) | Vivek (each access change) |
| G-02 | Revenue snapshots readable/deletable without login | Critical | **High** | SCRUM-57 | #5, #28 | `src/lib/__tests__/rls-policies.test.ts` | Fixed in code | Read-only drift check on sandbox, then live; apply the #28 migration | Approval to apply |
| G-03 | Job URLs guarded only by the public key | Critical | **High** | SCRUM-89 | #3, #25 | `src/lib/__tests__/cron-auth.test.ts` | Fixed in code; migration not applied | Follow `docs/runbooks/scrum-89-cron-secret.md` | Lovable credits (SCRUM-104); approval |
| G-04 | Finance KPIs hidden only in the browser | Critical | **High** | SCRUM-58 | #46 (HOLD) | `src/lib/__tests__/finance-visibility.test.ts`, `src/lib/__tests__/reports-summary-visibility.test.ts` | Safe default shipped in code: MCP `reports_summary` now returns finance totals only for admin/leadership/finance, with explicit `finance_totals_visible` | Final matrix decision still required for DB-level enforcement and exports | **Vivek: finance visibility matrix** |
| G-05 | 17 Sep bulk update likely overwrote lines | Critical | **High** | SCRUM-90 | Evidence hold #3 | Old importer behaviour pinned in `src/lib/__tests__/pack3-behaviour.test.ts` | Ledger wiped 25 Sep after a verified backup; the strict importer replaces the old one | Finance review of the 22 transactions | **Vivek** |
| G-06 | Any user could read any Freshdesk conversation | High | **High** | SCRUM-91 | #4 | `src/lib/__tests__/ticket-access.test.ts` | Fixed in code | Publish | Publish GO |
| G-07 | Job calls time out; no Freshdesk run log | High | no | SCRUM-74, SCRUM-72 | #12, #25 | `src/lib/__tests__/sync-health.test.ts`, `src/lib/__tests__/background-hook.test.ts` | Fixed in code; migration not applied | Apply migration; external alert | **Vivek: alert channel** |
| G-08 | Freshdesk re-downloads everything; ~⅓ stale | High | **High** | SCRUM-92 | #14, #24 | `src/lib/__tests__/freshdesk-cursor.test.ts`, `src/lib/__tests__/freshdesk-stale.test.ts` | Fixed in code; stale marker behind a flag | Apply migration, then turn on `FRESHDESK_STALE_SWEEP_ENABLED` | Approval |
| G-09 | AI Command Center: demo data, stub writes | High | **High** | SCRUM-76 | #26 | `src/lib/__tests__/ai-cc-policy.test.ts` | Fixed in code | Publish; remove any seeded demo rows on live | **Vivek: keep / Preview / hide; approve removal** |
| G-10 | Bulk import from the browser; merges rows, blank→0 | High | **High** | SCRUM-79, SCRUM-103 | #7–#11, #46 (HOLD) | `src/lib/strict-import/__tests__/validate.test.ts`, `src/lib/strict-import/__tests__/parse.test.ts`, `src/lib/__tests__/pack3-behaviour.test.ts` | Strict importer is the only UI path; legacy row-by-row importer remains in code but is no longer exposed in `/entry` | Sandbox acceptance with a real sample still required before release | **Vivek: Excel sample + 7 rules** |
| G-11 | Delete user fails; admin actions not all-or-nothing | High | **High** | SCRUM-78 | slice 1 in #42 + #46 (HOLD) | `src/lib/__tests__/require-role.test.ts`, `src/lib/__tests__/admin-guards.test.ts`, `src/lib/__tests__/scrum78-active-role.test.ts`, `src/lib/__tests__/pack3-behaviour.test.ts` | Delete replaced by admin-only soft-disable (history preserved; last-admin protection and server audit log entry) | Optional owner policy follow-up only if hard delete is ever reintroduced | None for safe default |
| G-12 | Only one Super Admin | Medium | no | SCRUM-93 | – | – | Not started | Pick the second admin | **Vivek** |
| G-13 | anon had full table privileges | Medium | **High** | SCRUM-57 | #5, #28 | `src/lib/__tests__/rls-policies.test.ts` | Fixed in code (live revoked 25 Sep) | Drift check; apply the #28 migration | Approval |
| G-14 | Tickets page loads everything; totals wrong >5,000 | Medium | no | SCRUM-94 | #15 | `src/lib/__tests__/paging.test.ts` | Slice 1 fixed | Server-side totals overlap paused SCRUM-105 | Atlas Eng GO on SCRUM-105 |
| G-15 | Type safety off; DB types may be stale | Medium | no | SCRUM-95 | – | – | Not started | Regenerate types from the sandbox schema | Sandbox schema access |
| G-16 | No CI; security rules untested | Medium | no | SCRUM-83 | #2, #28 | CI on every PR; `src/lib/__tests__/rls-policies.test.ts` | Fixed | Branch protection on `main` | Repo owner setting |
| G-17 | Errors swallowed or sent raw | Medium | no | SCRUM-96 | #18, #22, #27, #29 | `src/lib/__tests__/app-error.test.ts`, `src/lib/__tests__/artifact-cleanup.test.ts`, `src/lib/__tests__/mcp-audit.test.ts` | Fixed in code | Publish; external alert | **Vivek: alert channel** |
| G-18 | xlsx 0.18.5 vulnerable | Medium | no | SCRUM-97 | #7 | CI dependency audit | Fixed in code | Publish | Publish GO |
| G-19 | 17 Sep evidence would be auto-deleted | Medium | **High** | SCRUM-98 | #3 | `src/lib/__tests__/cron-auth.test.ts` (retention fixed at 90 days; callers can't shorten it) + hold in migration `supabase/migrations/20260925120100_scrum98_import_artifact_legal_hold.sql` | Hold written, not applied (cleanup job paused on live) | Apply the hold migration | On hold; approval |
| G-20 | Users could edit own email/active; fake audit rows | Medium | **High** | SCRUM-99 | #5 | `supabase/tests/rls/scrum99_profiles_audit.sql` (runs in `src/lib/__tests__/rls-policies.test.ts`) | Fixed in code; migration not applied | Apply migration | Approval |
| G-21 | Route guard checks login, not role | Low | no | SCRUM-61 | #6, #20 | `src/lib/__tests__/route-roles.test.ts`, `src/lib/__tests__/require-role.test.ts` | Fixed in code | Publish | Publish GO |
| G-22 | .env committed | Low | no | SCRUM-82, SCRUM-60 | #17 | `src/lib/__tests__/no-secrets-in-client.test.ts` | Fixed (public values only; guard test) | Turn on GitHub secret scanning | Repo owner setting |
| G-23 | Duplicate code, index, unused UI | Low | no | SCRUM-100 | #20 | CI (typecheck, build) | Code done | Drop the duplicate index (`supabase/migrations-pending/`) | **Vivek (destructive)** |
| G-24 | Business settings hard-coded | Low | no | SCRUM-101 | #13 | `src/lib/__tests__/app-config.test.ts` | Fixed in code | Publish | Publish GO |
| G-25 | Any user can claim any helpdesk agent | Low | **High** | SCRUM-102 | #4 | `src/lib/__tests__/ticket-access.test.ts` | Fixed in code: server check (#4); server-only writes + read-own migration (#34) | Publish, then apply migration `20260928020000` | Approval (release order) |
| G-26 | Snapshot table grows forever | Low | no | SCRUM-73 | – | – | Not started | Retention job (90 days daily, month-end forever) deletes rows | **Vivek: confirm retention** (destructive) |

## 3. Likely causes of the known errors (GAP_ANALYSIS, before the owner list)

| # | Symptom users would see | From | Status in `main` |
|---|---|---|---|
| 1 | Hourly "timeout" errors from scheduled jobs | G-07 | Fixed: hooks answer 202 and run in the background (#25) |
| 2 | Wrong or missing transaction lines after 17 Sep | G-05 | Ledger wiped; strict importer never merges lines (#8–#11); finance review waits on Vivek |
| 3 | Bulk imports stuck on "pending" | G-10 | Strict importer is all-or-nothing in one database call (#9, #10); flag off |
| 4 | "Delete user" fails with a foreign-key error | G-11 | Open: slice 1 (#42) does not change delete. Still waits on the delete policy (Vivek, SCRUM-78) |
| 5 | Blank pages / permission errors after half-created users | G-11 | Slice 1 in #42: new roles are inserted before old ones are removed, and a failed create sets is_active false and bans the account instead of leaving it active with no or wrong roles. Disabled users are turned away by the server role check ("Your account is disabled. Contact an admin."). The database check for a still-open session (`20260928090500_scrum78_role_check_respects_active`) was applied to live 28 Sep ~14:34 IST. Delete still waits on Vivek. Permission check failures still say so instead of a blank page (#18, #20) |
| 6 | Stale or missing tickets, wrong agent KPIs | G-08 | Fixed in code (#14, #24); stale marker needs its migration and flag |
| 7 | Slow Tickets page / Freshdesk 429 | G-08, G-14 | Incremental sync and cached checks (#14, #15) |
| 8 | AI Command Center "confirmed" items that did nothing | G-09 | Fixed: a failed write stays pending and shows the error (#26) |
| 9 | Runtime column errors hidden by `as never` casts | G-15 | Open: SCRUM-95 needs sandbox schema access |

## 4. Found since the review (28 Sep)

| Finding | From | Ticket | Status |
|---|---|---|---|
| `agent_identities` can be written directly, bypassing the SCRUM-102 server check | RLS audit #28 | SCRUM-102 | Fixed in #34 (migration not applied) |
| Uploader can edit own import-run paths and delete own import files | RLS audit #28 | SCRUM-98 | On hold |
| MCP disconnect failed open when the revocation lookup errored | MCP review #29 | SCRUM-59 | Fixed in #29 |
| Finance and ticket data readable by every role incl. viewer | RLS audit #28 | SCRUM-58 | Waits on the finance matrix (Vivek) |
