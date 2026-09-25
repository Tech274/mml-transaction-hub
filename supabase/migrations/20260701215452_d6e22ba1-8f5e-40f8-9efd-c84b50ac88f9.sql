
CREATE TABLE public.bulk_import_audit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID REFERENCES public.bulk_import_runs(id) ON DELETE CASCADE,
  parent_run_id UUID REFERENCES public.bulk_import_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id UUID,
  actor_email TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.bulk_import_audit_events TO authenticated;
GRANT ALL ON public.bulk_import_audit_events TO service_role;
ALTER TABLE public.bulk_import_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own bulk import audit events"
ON public.bulk_import_audit_events FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

CREATE POLICY "Users read own bulk import audit events; admins/ops read all"
ON public.bulk_import_audit_events FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[])
);

CREATE INDEX bulk_import_audit_events_run_idx ON public.bulk_import_audit_events(run_id);
CREATE INDEX bulk_import_audit_events_actor_idx ON public.bulk_import_audit_events(actor_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.expired_bulk_import_artifacts(_days INTEGER)
RETURNS TABLE (run_id UUID, original_csv_path TEXT, error_artifact_path TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, original_csv_path, error_artifact_path
  FROM public.bulk_import_runs
  WHERE created_at < (now() - make_interval(days => _days))
    AND (original_csv_path IS NOT NULL OR error_artifact_path IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.clear_bulk_import_artifact_paths(_run_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE public.bulk_import_runs
     SET original_csv_path = NULL, error_artifact_path = NULL
   WHERE id = ANY(_run_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
