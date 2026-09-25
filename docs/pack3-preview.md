# "Pack 3" preview: what it does today (SCRUM-80)

`roadmap.md` lists these items under **"Pack 3 (preview only)"**:

- **3A:** Super Admin user management, and the RBAC "Admin" permission group.
- **3B:** bulk import apply loop, audit events, cancelling stale runs, and the invalid-row download.

This page documents the **code on GitHub `main`** (reviewed 25 Sep 2026). It was not
checked in a running app: that needs sandbox access, and the screenshots the ticket
asks for are still to do. Whether these items are published on live could not be
confirmed without Lovable access.

Characterisation tests: `src/lib/__tests__/pack3-behaviour.test.ts` and
`admin-guards.test.ts`.

## 3A: Super Admin user management (`/admin`, `src/lib/admin.functions.ts`)

| Action | Server function | Who can do it (server) | Protections |
|---|---|---|---|
| Create user (with roles, optionally disabled) | `adminCreateUser` | admin only (`requireRole`) | a failed disable step now fails loudly (SCRUM-96) |
| Edit name, email, roles, active | `adminUpdateUserProfile` | admin only | email clash check; last Super Admin can't lose admin; can't disable yourself |
| Enable / disable | `adminSetUserActive` | admin only | can't disable yourself; can't disable the last Super Admin; ban/unban in Auth |
| Delete user | `adminDeleteUser` | admin only | can't delete yourself; can't delete the last Super Admin. **Hard delete in Auth** |
| Reset / set temporary password | `adminResetPassword` | admin only | sets `must_change_password`; password shown once in the UI, never emailed or logged |

- **Visibility.** The Admin menu item and `/admin` route are admin-only (route guard, SCRUM-61).
  Every function above checks admin **on the server before** using the service-role
  client; the tests enforce this.
- **Removed as dead code in SCRUM-100:** `adminSetUserRoles` and the `adminUpdateUser` alias.

### RBAC: permission matrix (`src/lib/permissions.ts`, table `role_permissions`)

- The KPI, chart and feature switches control what the UI shows per role.
- The 5 "Admin" keys (`feature_user_manage`, `feature_user_delete`,
  `feature_user_reset_password`, `feature_roles_manage`, `feature_permissions_manage`)
  appear as an always-on, read-only Super Admin column. **They only change the UI.**
  The server still requires the admin role, so switching one on for another role
  does not grant anything.
- Only admins can change the matrix (RLS "Admins manage role permissions"). Every
  change is logged by trigger `trg_log_permission_change`.
- **Preview as role.** An admin can view the app as another role. This is stored in the
  browser only (`localStorage`) and changes UI gating, not server permissions.

## 3B: legacy bulk import (`src/components/bulk-import.tsx`)

- **Apply loop.** Runs **in the browser**, one row at a time, writing straight to
  `transactions` under the user's RLS. It matches existing ADRs on
  **potential_id + month + year + lab_name** (live rows only):
  - *skip*: leave the existing row;
  - *update*: overwrite only the chosen fields of that one row, by id;
  - *link*: associate, change nothing.
  Rows without a match are inserted.
- **Audit events:** `import_started`, `retry_started`, `apply_suggestions`, `import_completed`, `import_failed` and `run_cancelled` go to
  `bulk_import_audit_events`, and there are per-row records in `bulk_import_row_audit`.
- **Stale pending runs.** A pending run blocks retries. The user can mark their own pending
  runs "cancelled"; no data is changed.
- **Invalid rows.** Downloaded as `<kind>-invalid-rows-<date>.csv/json`, with the stored
  artifact in the `bulk-imports` bucket as a fallback.
- **Who.** The Bulk Import tab is for ops_user, ops_lead and admin; import history is for admin, ops_lead and leadership.
  When `strict_import_enabled` is on, the legacy tab is admin-only (SCRUM-103).

## Known issues

| # | Area | Issue | Status |
|---|---|---|---|
| 1 | 3B | If the duplicate-match lookup failed, the error was ignored, the row was treated as "no match" and **inserted again** (possible duplicate ADR) | fixed in SCRUM-96 slice 2 (PR #22) |
| 2 | 3B | Audit inserts and run-status updates in the browser ignored failures; "Cancelled N imports" was shown even if the update failed | fixed in SCRUM-96 slice 2, PR #22 (checked + logged) |
| 3 | 3B | Row-by-row browser writes: a closed tab or lost connection leaves a partial import; there is no all-or-nothing | by design of the legacy importer; the strict importer (SCRUM-103) replaces it with an all-or-nothing server function |
| 4 | 3B | "Cancel pending" can mark a run cancelled that is still importing in another tab | open; goes away with the strict importer |
| 5 | 3B | Matching on `lab_name` is exact (case and spaces matter), so "Lab A" and "lab a " create two ADRs | open; strict importer rule D6 pending Vivek |
| 6 | 3A | Delete is a hard delete in Auth; profile/audit handling after delete depends on FKs | policy decision **SCRUM-78 (Vivek)**; not changed |
| 7 | 3A | The "last Super Admin" guard ignored lookup errors, so a failed read let the change through | fixed in SCRUM-100 |
| 8 | 3B | On a retry, if the "which lines already succeeded" lookup failed, every line was re-imported (duplicates) | fixed in SCRUM-96 slice 2 (PR #22): the retry stops and is marked failed |

## Recommendation

- **3A: keep, admin-only.** The server enforces admin on every action, and it's covered by tests.
  The delete policy (SCRUM-78) stays with Vivek.
- **3B: keep for now, then replace.** It's still the working import path while the strict importer's
  flag is off. After the SCRUM-103 go-live, restrict it to admins (already wired to the
  flag) and later remove it.
- The **"preview" label** in `roadmap.md` should be dropped or confirmed once someone with
  Lovable access confirms what is published on live.
