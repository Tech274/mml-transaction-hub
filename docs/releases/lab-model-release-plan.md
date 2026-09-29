# SCRUM-44 Lab model combined-release plan (GitHub-only)

All PRs below must remain open and unmerged until the full set is complete.

## Deadline scope split

### Demo essentials (Tue 29 Sep 2026 IST)

- Lab transaction model with quote-vs-transaction separation.
- Locked transaction costs (`selling_cost`, `input_cost`) with admin-only audited correction path.
- Public cloud margin breakdown (service margin + unused credit from actual consumption).
- Lab batch totals hard invariant: batch totals always equal the sum of transactions.
- AI Command Center backend auto-assignment with strict admin approval gate for live-impacting work (`publish`, `deploy`, `live_write`).
- Chief-approved UI implementation (29 Sep) for Public Cloud + Private Cloud screens and Azure design-system sweep, guarded behind `VITE_SCRUM44_UI_REVIEW_ENABLED` and kept HOLD.

### Post-demo / production hardening (by Mon 5 Oct 2026)

- Optional follow-up hardening and review-driven refinements.
- Final hosting/deployment target selection and environment-specific release wiring (owner decision required).

## Planned PR set and merge order

1. **PR-A: combined HOLD foundations + approved UI review slice** (`#46`, HOLD)
   - https://github.com/Tech274/mml-transaction-hub/pull/46
   - Proposed migrations (not applied), DB invariants, locked-cost correction path, AI work-item auto-assignment backend, approved UI implementation behind feature flags, and tests.
2. **PR-B (optional hardening/follow-up if needed)**
   - Any additional review fixes required after PR-A is green.

## Single combined deploy step (after all PRs merge)

1. Confirm CI green for all merged PRs and final `main`.
2. Keep all new feature flags OFF (`AI_CC_AUTO_ASSIGN_ENABLED=false`, `VITE_SCRUM44_UI_REVIEW_ENABLED=false`).
3. Apply approved migrations one-by-one to sandbox first; run verification tests/check queries.
4. After explicit GO, apply same migrations one-by-one to live.
5. Deploy application code from GitHub main.
6. Turn feature flags ON in controlled order (backend first, then UI), verify, and monitor.

## Single combined rollback step

1. Immediately turn new feature flags OFF.
2. Roll back app code to previous known-good GitHub release tag/commit.
3. For schema rollback, run only the explicitly approved rollback SQL from each migration header in reverse migration order.
4. Re-run reconciliation checks (transactions, batch totals, profit fields, AI work-item state).

## Demo run path (local only, example data)

1. Run `bash scripts/demo-local.sh` from repo root.
2. This starts local Supabase in `scripts/demo-local/`, applies repo migrations to local Postgres, loads `supabase/seed-demo.sql` example data, and starts the app at `http://127.0.0.1:8080`.
3. Demo accounts are listed in `DEMO.md` (local-only credentials and roles).
4. Do **not** run `supabase link` or `supabase db push` against hosted projects for this demo flow.

## Owner open questions (blocking final combined release)

1. **Hosting/deployment target remains undecided** (GitHub-only workflow in progress).  
   We must not choose/configure Azure, AWS, Vercel, or any other target until owner decision.
