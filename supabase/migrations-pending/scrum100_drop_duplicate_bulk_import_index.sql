-- SCRUM-100 (G-23): drop the duplicate index on bulk_import_runs(parent_run_id).
-- approval-required: SCRUM-100. NOT APPROVED. Do not move into supabase/migrations/ until approved.
--
-- Two identical indexes exist:
--   idx_bulk_import_runs_parent          (migration 20260630064839_…)
--   bulk_import_runs_parent_run_id_idx   (migration 20260630095744_…)
-- Both are btree on public.bulk_import_runs(parent_run_id). This keeps the second one
-- (standard Postgres naming) and drops the first. Nothing references an index by name.
--
-- Safety: the DO block refuses to drop anything unless the index being kept exists,
-- is valid, and has exactly the same definition apart from its name.
-- bulk_import_runs is small; DROP INDEX takes a brief ACCESS EXCLUSIVE lock on it.

do $$
declare
  keep_def text;
  drop_def text;
begin
  select pg_get_indexdef(i.indexrelid) into keep_def
  from pg_index i join pg_class c on c.oid = i.indexrelid
  where c.relname = 'bulk_import_runs_parent_run_id_idx' and i.indisvalid;

  select pg_get_indexdef(i.indexrelid) into drop_def
  from pg_index i join pg_class c on c.oid = i.indexrelid
  where c.relname = 'idx_bulk_import_runs_parent';

  if drop_def is null then
    raise notice 'idx_bulk_import_runs_parent does not exist; nothing to do';
    return;
  end if;
  if keep_def is null then
    raise exception 'refusing to drop: bulk_import_runs_parent_run_id_idx is missing or invalid';
  end if;
  if replace(keep_def, 'bulk_import_runs_parent_run_id_idx', 'X') <> replace(drop_def, 'idx_bulk_import_runs_parent', 'X') then
    raise exception 'refusing to drop: definitions differ (% vs %)', keep_def, drop_def;
  end if;

  execute 'drop index if exists public.idx_bulk_import_runs_parent';
end $$;
