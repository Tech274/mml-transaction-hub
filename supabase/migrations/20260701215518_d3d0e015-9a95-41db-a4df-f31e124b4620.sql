
REVOKE ALL ON FUNCTION public.expired_bulk_import_artifacts(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_bulk_import_artifact_paths(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expired_bulk_import_artifacts(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_bulk_import_artifact_paths(UUID[]) TO service_role;
