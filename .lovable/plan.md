## Bulk Import — Next Phase Plan

Building on the existing Bulk Import for Public/Private Cloud (template, history, presets, retry, suggestions). This phase focuses on hardening, observability, and finishing the workflows already in flight.

### 1. Server-side validation & atomicity
- Move row validation + insert/update/link logic into a `createServerFn` (`bulkImportRows`) guarded by `requireSupabaseAuth` + `has_role` (ops_user/ops_lead/admin).
- Process rows in chunks of 200 inside a single transaction per chunk; return per-row outcome (`imported | updated | linked | skipped | failed` + messages).
- Enforce duplicate strategy and `update_fields` on the server so the client cannot bypass rules.
- Stamp every audit log entry with run_id, filename, user, and outcome.

### 2. Background job + progress
- Replace the in-browser loop with a `bulk_import_jobs` queue row written on submit; status `queued → running → completed/failed` with `processed`, `succeeded`, `failed`, `total` counters.
- Poll job via `useQuery` (2s interval) and drive the existing progress UI from server counters instead of local state.
- Allow cancel (sets `cancel_requested`); server checks flag between chunks.

### 3. Storage of artifacts
- Upload the original CSV and the generated error CSV/JSON to a private `bulk-imports` storage bucket, keyed by `run_id`.
- History panel: "Download original" + "Download error report" pull signed URLs instead of regenerating client-side.

### 4. Preset & retry polish
- Add a "Default preset per role" toggle (admin only) so new imports auto-load a shared preset.
- On retry, snapshot the resolved mapping + duplicate strategy + `update_fields` onto the new run so history is self-describing even if the preset later changes.
- Surface retry lineage in history (`parent_run_id`, chain view in details sheet).

### 5. Notifications & summary
- After a run finishes, write a `notifications` row for the importer; toast on next login if they missed it.
- Add an email summary (via existing transactional email infra) with counts and a link to the run.

### 6. Observability & limits
- Per-user rate limit: max 3 concurrent running jobs, max 50k rows per CSV (configurable in `config_master`).
- Structured logs on the server fn (run_id, chunk, duration, failure reasons aggregated).
- Admin page: list recent jobs across all users with filters (status/user/date) and a "force-fail stuck job" action.

### 7. Tests
- Vitest: validation + suggestion helpers (enum casing, date parsing, numeric cleanup).
- Playwright e2e: upload happy path, duplicate=update with `update_fields`, retry with suggestions, role gating (viewer blocked).

### Technical notes
- New tables: `bulk_import_jobs` (queue), extend `bulk_import_runs` with `parent_run_id`, `original_csv_path`, `error_artifact_path`.
- New bucket: `bulk-imports` (private, RLS: importer + admin/ops_lead read).
- Server fn lives in `src/lib/bulk-import.functions.ts`; admin/maintenance bits in `src/lib/bulk-import.server.ts`.
- All GRANTs + RLS policies included in the migration; jobs table scoped by `created_by` with admin/ops_lead override via `has_role`.

### Out of scope (call out before approving)
- Scheduled/recurring imports from S3/SFTP.
- Diff preview against existing transactions for `update` strategy beyond field list (full before/after table).
- Multi-file (zip) uploads.

Want me to drop any section, or push further on a specific one (e.g. cancel + email summary now, defer notifications)?
