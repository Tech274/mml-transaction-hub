
-- Presets
CREATE TABLE public.bulk_import_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('public_cloud','private_cloud')),
  column_mapping JSONB NOT NULL,
  duplicate_strategy TEXT NOT NULL CHECK (duplicate_strategy IN ('skip','update','link')),
  update_fields JSONB,
  is_shared BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_import_presets TO authenticated;
GRANT ALL ON public.bulk_import_presets TO service_role;

ALTER TABLE public.bulk_import_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view shared presets"
  ON public.bulk_import_presets FOR SELECT
  TO authenticated
  USING (is_shared = true OR created_by = auth.uid());

CREATE POLICY "Ops/Lead/Admin can create presets"
  ON public.bulk_import_presets FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::app_role[])
    AND created_by = auth.uid()
  );

CREATE POLICY "Creator or admin can update preset"
  ON public.bulk_import_presets FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Creator or admin can delete preset"
  ON public.bulk_import_presets FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_bulk_import_presets_updated_at
  BEFORE UPDATE ON public.bulk_import_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Retry tracking on runs
ALTER TABLE public.bulk_import_runs
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES public.bulk_import_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_bulk_import_runs_parent ON public.bulk_import_runs(parent_run_id);
