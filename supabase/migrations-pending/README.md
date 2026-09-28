# Migrations waiting for approval

Files here are **not** migrations yet. They sit outside `supabase/migrations/`
on purpose, so no `supabase db push`, Lovable sync or migration run can pick them up.

To use one, after the named approver has approved it:
1. Replace the `-- approval-required:` header line with
   `-- approved-destructive: <ticket> <who approved, date>`.
2. Move the file into `supabase/migrations/` with a fresh timestamp.
3. Apply to sandbox first, verify, then to live in the agreed release order.

| File | Ticket | What | Needs approval from |
|---|---|---|---|
| `scrum100_drop_duplicate_bulk_import_index.sql` | SCRUM-100 (G-23) | Drops `idx_bulk_import_runs_parent`, an exact duplicate of `bulk_import_runs_parent_run_id_idx` | Atlas + Vivek (destructive DDL, SCRUM-64 rule) |

`scrum78_role_check_respects_active.sql` was moved to
`supabase/migrations/20260928090500_scrum78_role_check_respects_active.sql` and applied to live
28 Sep 2026 ~14:34 IST. Its rollback, `scrum78_role_check_respects_active.rollback.sql`, stays here
(not a migration; nothing applies it).
