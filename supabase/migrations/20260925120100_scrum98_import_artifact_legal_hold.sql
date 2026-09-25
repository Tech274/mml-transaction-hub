-- SCRUM-98 (G-19): legal hold on bulk-import artifacts (17 Sep import evidence, see SCRUM-90).
-- Status: REPO ONLY, NOT APPLIED. Apply only with Atlas go-ahead and Vivek's approval.
-- Effect: expired_bulk_import_artifacts() returns no rows, so neither the scheduled cleanup
-- (cron job already paused on live) nor the admin "Run cleanup" action can delete any stored
-- CSV / error file. No data is changed. Signature, owner and grants are unchanged.
-- Lift the hold (only when Vivek confirms the evidence is archived) by restoring the original body:
--   SELECT id, original_csv_path, error_artifact_path FROM public.bulk_import_runs
--    WHERE created_at < (now() - make_interval(days => _days))
--      AND (original_csv_path IS NOT NULL OR error_artifact_path IS NOT NULL)

CREATE OR REPLACE FUNCTION public.expired_bulk_import_artifacts(_days integer)
RETURNS TABLE(run_id uuid, original_csv_path text, error_artifact_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- LEGAL HOLD 25 Sep 2026 (SCRUM-98): nothing is eligible for deletion.
  SELECT NULL::uuid, NULL::text, NULL::text WHERE false
$function$;

COMMENT ON FUNCTION public.expired_bulk_import_artifacts(integer)
  IS 'LEGAL HOLD (SCRUM-98, 25 Sep 2026): returns no rows until lifted with Vivek''s approval.';
