# Current-state audit and 30-day roadmap (SCRUM-46)

Prepared by Atlas, 28 Sep 2026 (IST). Sources: the 25 Sep review (`docs/review/GAP_ANALYSIS.md`,
`REBUILD_PLAN.md`, `PRIORITIZED_ACTIONS.md`), the code in `main` after PR #32, and the Jira tickets.
Registers: `docs/review/KNOWN_ERRORS_REGISTER.md` (every error) and `docs/migrations.md` (every
migration not yet on live).

**How to read this.** The page walk below is a **code-level** audit of `main`. The ticket also asks
for a hands-on walk of each page on the live app. That's step 1 of week 1 for John's team (read-only,
with Vivek's approved accounts), and their findings get added to the "Live walk" column.

## Baseline

| | Value | Source |
|---|---|---|
| Transactions / customers | 58 / 24 on 24 Sep. **Wiped on 25 Sep** after a verified backup; the ledger is empty and waiting for the real load through the strict importer | SCRUM-46, SCRUM-44 briefing |
| Freshdesk tickets | ~1,968 (about a third stale on 25 Sep) | GAP_ANALYSIS |
| Last snapshot sync before review | 24 Sep 2026 07:30 IST | SCRUM-46 |
| Accounts | 13 (1 admin); review pending | SCRUM-45 |
| Live build | Lovable, 25 Sep emergency lockdown (sign-up closed, no default role, anon locked out) | PR #1 |
| GitHub `main` | PRs #1–#32 merged; **nothing from GitHub is live**; 7 migrations repo-only | this repo |
| Tests / CI | ~370 unit tests, incl. access-rule tests on a local Postgres with every migration; CI on every PR | `README.md` |

## Page by page (code in `main`)

Status key: **OK** = works in code, no open issue · **Fixed, not live** = fixed in `main`, waiting
for publish/migration · **Open** = known gap · **Waits** = blocked on a decision.

| Page / route | What it does | Status in `main` | Open items (ticket) | Live walk |
|---|---|---|---|---|
| Sign-in `src/routes/auth.tsx` | Email + password; no public sign-up | OK (live since 25 Sep) | Account review (SCRUM-45, Vivek) | _to do_ |
| Dashboard `src/routes/_authenticated/dashboard.tsx` | Revenue/cost/margin KPIs, agent KPIs | Fixed, not live: reads all rows (no 1,000 cap, #16) | Finance cards hidden only in the browser (SCRUM-58, Vivek); KPI definitions (SCRUM-69, Vivek) | _to do_ |
| Master ADR entry `src/routes/_authenticated/entry.tsx` | Single entry form + bulk import + import history | Fixed, not live: shared validation and server-side create (#21); strict importer behind a flag, legacy importer admin-only (#8–#11) | Strict importer rules + sample (SCRUM-103, Vivek) | _to do_ |
| Transactions `src/routes/_authenticated/transactions.tsx` | Paged list, search, soft delete | OK; unused delete grants removed in a repo-only migration (#28) | Cost columns visible to all roles (SCRUM-58) | _to do_ |
| Public cloud `src/routes/_authenticated/public-cloud.tsx` | Transactions filtered to public cloud | OK | Classification rules (SCRUM-68, Vivek) | _to do_ |
| Private cloud `src/routes/_authenticated/private-cloud.tsx` | Transactions filtered to private cloud | OK | Classification rules (SCRUM-68, Vivek) | _to do_ |
| Customers `src/routes/_authenticated/customers.tsx` | Customer list and edit | OK (all-rows read) | Duplicate detection rules (SCRUM-67, Vivek) | _to do_ |
| Reports `src/routes/_authenticated/reports.tsx` | Report views and Excel export | Fixed, not live: all-rows reads (#16), SheetJS upgrade (#7) | Export role visibility (SCRUM-71, after SCRUM-58) | _to do_ |
| Tickets `src/routes/_authenticated/tickets.tsx` | Freshdesk tickets, conversations, agent claim | Fixed, not live: no 5k cap (#15), conversations limited to synced tickets and ops roles (#4), incremental sync (#14) | Server-side totals + status labels (SCRUM-94/105, paused); direct `agent_identities` writes (SCRUM-102 follow-up) | _to do_ |
| AI Command Center: agents `src/routes/_authenticated/ai-command-center.agents.tsx` | Agent list | Fixed, not live (#26) | Keep / Preview / hide on live (Vivek) | _to do_ |
| AI Command Center: inbox `src/routes/_authenticated/ai-command-center.inbox.tsx` | Proposals to confirm or reject | Fixed, not live: helpdesk writes need ops_lead/admin + explicit confirm; failures stay pending (#26) | Same decision; remove seeded demo rows on live (Vivek) | _to do_ |
| AI Command Center: run now `src/routes/_authenticated/ai-command-center.run-now.tsx` | Run an agent on demand | Fixed, not live: no demo seeding (#26) | Same decision | _to do_ |
| AI Command Center: audit `src/routes/_authenticated/ai-command-center.audit.tsx` | Agent action log | OK | – | _to do_ |
| Agent integrations `src/routes/_authenticated/agent-integrations.tsx` | Connected AI clients; disconnect | Fixed, not live: revocation check fails closed, lookup errors shown (#29) | 4 dashboard checks (SCRUM-59) | _to do_ |
| MCP audit `src/routes/_authenticated/mcp-audit.tsx` | AI tool-call log | OK: admin-only page and server check (#6) | – | _to do_ |
| Sync status `src/routes/_authenticated/sync-status.tsx` | Job health, runs, clean-up | Fixed, not live: run log + health alert (#12), failures shown not hidden (#27) | External alert channel (SCRUM-72, Vivek) | _to do_ |
| Admin `src/routes/_authenticated/admin.tsx` | Users, roles, bulk-import admin (Pack 3) | Fixed, not live: server role checks, last-admin protection, errors checked (#20, #22) | Delete → deactivate policy (SCRUM-78, Vivek); second Super Admin (SCRUM-93, Vivek) | _to do_ |
| Scheduled job hooks `src/routes/api/public/hooks/` | Freshdesk sync, snapshot, import clean-up | Fixed, not live: Vault secret (#3), 202 + background (#25) | Runbook order; Lovable credits (SCRUM-104) | _to do_ |
| MCP endpoint `src/routes/mcp.ts` | AI clients query as the signed-in user | Fixed, not live: no raw DB errors (#29) | Finance fields follow SCRUM-58 | _to do_ |

## What blocks progress (decisions and access)

| Needed | From | Unblocks |
|---|---|---|
| Finance visibility matrix (who sees cost/revenue/margin) | Vivek | SCRUM-58, 71; MCP finance fields; RLS finding 1 |
| Excel sample + 7 import rules | Vivek | SCRUM-103 acceptance, then the real data load |
| 5 KPI definition answers | Vivek | SCRUM-69 sign-off, SCRUM-70 real run |
| User delete policy; second Super Admin; account review | Vivek | SCRUM-78, 93, 45 |
| AI Command Center on live: keep / Preview / hide | Vivek | SCRUM-76 publish |
| Alert channel for job failures | Vivek | SCRUM-72, 96 external alerts |
| Snapshot retention (deletes old rows) | Vivek | SCRUM-73 |
| Lovable credits; Lovable ↔ GitHub connection | Vivek / Sujaykumar | SCRUM-104, 81: **nothing in GitHub can reach live without these** |
| Approval for each migration apply and publish | Atlas + Vivek | everything "Fixed, not live" |
| Sandbox access for read-only checks | Vivek | SCRUM-95 types; drift checks; restore test |

## 30-day roadmap (28 Sep – 27 Oct 2026)

**Week 1 (28 Sep – 4 Oct): decide and verify, no live changes.**
- Vivek: the decisions above, starting with the finance matrix, the importer rules and the Lovable credits/connection.
- John's team: live page walk (read-only), filling in the "Live walk" column. Review PRs #26 onward as `Admin-mmlabs`.
- Read-only checks: migration drift check (`docs/migrations.md`); backup checks L1–L3 and a sandbox restore test (`docs/runbooks/backup-before-live-change.md`); MCP dashboard checks (SCRUM-59).
- Agree the release plan for connecting Lovable to GitHub (SCRUM-81): what `main` brings in, and in what order.

**Week 2 (5 – 11 Oct): release 1 to live (security and observability).**
- With approvals, apply migrations in register order on sandbox, then live:
  1. cron secret
  2. legal hold
  3. profile guard
  4. sync_runs counts
  5. stale marker
  6. unused grants
  
  Use the pre-change checklist and fingerprint for each.
- Publish `main` (SCRUM-89 order: migration → cron headers → code). Verify the jobs, Sync Status and AI Command Center confirm flow.
- Move tickets from Testing to Done after live verification.

**Week 3 (12 – 18 Oct): real data.**
- Strict importer acceptance in sandbox with Vivek's sample (SCRUM-103), then apply the importer migration, turn on the flag, and do the real load.
- Run the KPI reconciliation (SCRUM-70) on the loaded data. Vivek signs off the KPIs (SCRUM-69).
- Finance visibility enforced on the server (SCRUM-58/71), once the matrix is decided.

**Week 4 (19 – 27 Oct): hardening and handover.**
- User management: deactivate instead of delete, atomic create (SCRUM-78). Second Super Admin (SCRUM-93).
- Regenerate DB types, remove unsafe casts (SCRUM-95). Smoke tests (SCRUM-84). Tickets totals and status labels (SCRUM-94/105).
- Validate the ADR constraints after the violations report (SCRUM-66). Snapshot retention (SCRUM-73), if approved.
- Access handover to John (SCRUM-47). Branch protection and secret scanning turned on (repo owner).

Exit criteria for day 30: every "Fixed, not live" row is live and verified; the ledger holds the real
data loaded by the strict importer and reconciled; no Critical or High item is open without a named
decision owner.
