# SCRUM-44 Lab model combined-release plan (GitHub-only)

All PRs below must remain open and unmerged until the full set is complete.

## Planned PR set and merge order

1. **PR-A: non-UI foundations** (`#46`, HOLD)
   - https://github.com/Tech274/mml-transaction-hub/pull/46
   - Proposed migrations (not applied), DB invariants, locked-cost correction path, AI work-item auto-assignment backend, and tests.
2. **PR-B (pending owner design approval): UI implementation**
   - Screen implementation for lab transaction, lab batch, and KPI profit/margin views behind feature flags.
3. **PR-C (optional hardening/follow-up if needed)**
   - Any review fixes required after PR-A and PR-B are both green.

## Single combined deploy step (after all PRs merge)

1. Confirm CI green for all merged PRs and final `main`.
2. Keep all new feature flags OFF (`AI_CC_AUTO_ASSIGN_ENABLED=false`, UI flags OFF).
3. Apply approved migrations one-by-one to sandbox first; run verification tests/check queries.
4. After explicit GO, apply same migrations one-by-one to live.
5. Deploy application code from GitHub main.
6. Turn feature flags ON in controlled order (backend first, then UI), verify, and monitor.

## Single combined rollback step

1. Immediately turn new feature flags OFF.
2. Roll back app code to previous known-good GitHub release tag/commit.
3. For schema rollback, run only the explicitly approved rollback SQL from each migration header in reverse migration order.
4. Re-run reconciliation checks (transactions, batch totals, profit fields, AI work-item state).
