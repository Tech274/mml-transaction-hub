ALTER TABLE public.bulk_import_runs DROP CONSTRAINT IF EXISTS bulk_import_runs_status_check;
ALTER TABLE public.bulk_import_runs ADD CONSTRAINT bulk_import_runs_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
