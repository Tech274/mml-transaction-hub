
CREATE TABLE public.bulk_import_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('public_cloud','private_cloud')),
  filename TEXT NOT NULL,
  duplicate_strategy TEXT NOT NULL DEFAULT 'skip' CHECK (duplicate_strategy IN ('skip','update','link')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  updated_rows INTEGER NOT NULL DEFAULT 0,
  linked_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE ON public.bulk_import_runs TO authenticated;
GRANT ALL ON public.bulk_import_runs TO service_role;

ALTER TABLE public.bulk_import_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own import runs"
  ON public.bulk_import_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','leadership','ops_lead']::app_role[]));

CREATE POLICY "Users insert own import runs"
  ON public.bulk_import_runs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own import runs"
  ON public.bulk_import_runs FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_bulk_import_runs_user ON public.bulk_import_runs(user_id, created_at DESC);

CREATE TABLE public.bulk_import_row_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.bulk_import_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  line_number INTEGER NOT NULL,
  potential_id TEXT,
  transaction_id UUID,
  status TEXT NOT NULL CHECK (status IN ('imported','updated','linked','skipped','error')),
  error_message TEXT,
  row_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.bulk_import_row_audit TO authenticated;
GRANT ALL ON public.bulk_import_row_audit TO service_role;

ALTER TABLE public.bulk_import_row_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own row audit"
  ON public.bulk_import_row_audit FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','leadership','ops_lead']::app_role[]));

CREATE POLICY "Users insert own row audit"
  ON public.bulk_import_row_audit FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_bulk_import_row_audit_run ON public.bulk_import_row_audit(run_id);
