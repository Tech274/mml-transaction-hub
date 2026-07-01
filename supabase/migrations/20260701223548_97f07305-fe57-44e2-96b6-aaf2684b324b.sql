
-- 1) customers: replace permissive SELECT with role-scoped SELECT
DROP POLICY IF EXISTS "Authenticated read customers" ON public.customers;
CREATE POLICY "Role-scoped read customers"
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

-- 2) profiles: own row OR admin
DROP POLICY IF EXISTS "Authenticated read profiles" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- 3) account_managers: restrict SELECT to assigned roles
DROP POLICY IF EXISTS "Authenticated read account managers" ON public.account_managers;
CREATE POLICY "Role-scoped read account managers"
  ON public.account_managers
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

-- 4) config_master: restrict SELECT to assigned roles
DROP POLICY IF EXISTS "Authenticated read config" ON public.config_master;
CREATE POLICY "Role-scoped read config"
  ON public.config_master
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

-- 5) role_permissions: restrict SELECT to assigned roles (needed for UI menu gating)
DROP POLICY IF EXISTS "Authenticated users can view role permissions" ON public.role_permissions;
CREATE POLICY "Role-scoped read role permissions"
  ON public.role_permissions
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

-- 6) transactions: restrict SELECT to assigned roles
DROP POLICY IF EXISTS "Authenticated read transactions" ON public.transactions;
CREATE POLICY "Role-scoped read transactions"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

-- 7) transaction_activity_log: restrict SELECT to assigned roles
DROP POLICY IF EXISTS "Authenticated read activity" ON public.transaction_activity_log;
CREATE POLICY "Role-scoped read activity"
  ON public.transaction_activity_log
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

-- 8) Drop forgeable INSERT policies on audit tables. Rows are still written
--    by SECURITY DEFINER triggers (log_customer_change / log_permission_change)
--    which bypass RLS. No user-facing insert path is intended.
DROP POLICY IF EXISTS "System inserts customer audit" ON public.customer_audit_log;
DROP POLICY IF EXISTS "System inserts permission audit" ON public.permission_audit_log;

-- 9) Revoke EXECUTE from anon/authenticated on functions that should never be
--    directly callable via the Data API. Trigger functions and the onboarding
--    handler only need to run from Postgres itself.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_customer_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_permission_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_transaction_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_role_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_bulk_import_artifact_paths(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expired_bulk_import_artifacts(integer) FROM PUBLIC, anon, authenticated;

-- Also revoke anon EXECUTE on the RLS helper predicates. They must remain
-- callable by `authenticated` because RLS policies invoke them during query
-- evaluation, but anonymous users have no reason to call them.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, app_role[]) TO authenticated;
