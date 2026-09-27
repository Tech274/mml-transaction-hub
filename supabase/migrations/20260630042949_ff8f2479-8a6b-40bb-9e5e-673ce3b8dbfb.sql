ALTER TABLE public.bulk_import_runs
  ADD COLUMN IF NOT EXISTS column_mapping jsonb,
  ADD COLUMN IF NOT EXISTS update_fields jsonb;
