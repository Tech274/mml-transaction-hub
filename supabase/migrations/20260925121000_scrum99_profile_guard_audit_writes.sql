-- SCRUM-99 (G-20): users may edit only their own full_name; audit tables are written by
-- database triggers only. Plus SCRUM-57 follow-up: future tables get no anon privileges.
-- Status: REPO ONLY, NOT APPLIED. Apply only with Atlas go-ahead and Vivek's approval.
-- Safe while live: no data changes. Admin flows use the service-role client (not affected).
-- The audit triggers (log_customer_change, log_permission_change, log_role_change,
-- log_transaction_activity) are SECURITY DEFINER, so they keep writing after the revokes.

-- 1) profiles: a non-admin signed-in user can change only full_name (and updated_at) on their own row.
CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No end-user JWT (service role, SQL editor, other triggers): trusted backend path.
  IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'You can only change your own display name'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_self_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_self_update ON public.profiles;
CREATE TRIGGER profiles_guard_self_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_self_update();

-- 2) Audit tables: no direct client writes. Remove the permissive "System inserts" policies
--    (they allowed any signed-in user to insert arbitrary audit rows) and revoke write grants.
DROP POLICY IF EXISTS "System inserts customer audit" ON public.customer_audit_log;
DROP POLICY IF EXISTS "System inserts permission audit" ON public.permission_audit_log;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.customer_audit_log      FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.permission_audit_log    FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.role_audit_log          FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.transaction_activity_log FROM authenticated, anon;
-- Not changed here (still written from the browser / user JWT today, moved server-side later):
--   bulk_import_row_audit, bulk_import_audit_events -> strict importer (SCRUM-103 / SCRUM-79)
--   mcp_tool_audit_log -> SCRUM-77

-- 3) SCRUM-57 follow-up: tables/sequences created by later migrations must not be granted to anon
--    by default (Supabase's default privileges grant them). Re-assert the 25 Sep revoke too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
