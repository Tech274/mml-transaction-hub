
-- 1. Explicit restrictive write blocks on audit tables (triggers use SECURITY DEFINER and bypass RLS)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_audit_log','role_audit_log','permission_audit_log','transaction_activity_log']
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon', t);
    EXECUTE format('DROP POLICY IF EXISTS "Block direct client writes" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Block direct client writes" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;

-- 2. Revoke EXECUTE on SECURITY DEFINER functions that clients should never call directly.
-- Keep has_role / has_any_role executable because RLS policies invoke them as the querying user.
REVOKE EXECUTE ON FUNCTION public.clear_bulk_import_artifact_paths(uuid[]) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.expired_bulk_import_artifacts(integer) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.log_customer_change() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.log_transaction_activity() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.log_role_change() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.log_permission_change() FROM PUBLIC, authenticated, anon;
