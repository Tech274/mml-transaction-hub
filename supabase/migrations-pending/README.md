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
| `scrum103_lenient_import.sql` | SCRUM-103 | Nullable transaction fields, no input>selling check, lenient provider trigger and import RPC. Apply `20260925130000_scrum103_import_batches` first, then this, then publish | Atlas + Vivek (schema relaxation; not applied) |
