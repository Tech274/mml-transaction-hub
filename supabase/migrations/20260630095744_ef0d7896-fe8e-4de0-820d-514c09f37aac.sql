-- Bulk import: background jobs, artifact paths, retry lineage, limits config

-- 1) Extend bulk_import_runs with lineage + artifact paths
ALTER TABLE public.bulk_import_runs
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.bulk_import_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_csv_path text,
  ADD COLUMN IF NOT EXISTS error_artifact_path text;

CREATE INDEX IF NOT EXISTS bulk_import_runs_parent_run_id_idx
  ON public.bulk_import_runs(parent_run_id);

-- 2) bulk_import_jobs: server-side queue/progress
CREATE TABLE IF NOT EXISTS public.bulk_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.bulk_import_runs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  total integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  imported integer NOT NULL DEFAULT 0,
  updated_rows integer NOT NULL DEFAULT 0,
  linked integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  error_message text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT bulk_import_jobs_status_check
    CHECK (status IN ('queued','running','completed','failed','cancelled'))
);

GRANT SELECT, INSERT, UPDATE ON public.bulk_import_jobs TO authenticated;
GRANT ALL ON public.bulk_import_jobs TO service_role;

ALTER TABLE public.bulk_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Importers and ops leads read jobs"
  ON public.bulk_import_jobs FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[])
  );

CREATE POLICY "Importers insert jobs for themselves"
  ON public.bulk_import_jobs FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::app_role[])
  );

-- Updates only via service_role from server functions (no policy for authenticated)

CREATE TRIGGER set_bulk_import_jobs_updated_at
  BEFORE UPDATE ON public.bulk_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS bulk_import_jobs_run_id_idx ON public.bulk_import_jobs(run_id);
CREATE INDEX IF NOT EXISTS bulk_import_jobs_created_by_status_idx
  ON public.bulk_import_jobs(created_by, status);

-- 3) Seed import-limit config entries (idempotent)
INSERT INTO public.config_master (category, key, label, sort_order, is_active)
VALUES
  ('bulk_import_limit', 'max_concurrent_jobs', '3', 1, true),
  ('bulk_import_limit', 'max_rows_per_csv', '50000', 2, true)
ON CONFLICT DO NOTHING;
