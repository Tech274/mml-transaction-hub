-- SCRUM-78: has_role and has_any_role return false when profiles.is_active is not true.
-- Status: APPLIED TO LIVE 28 Sep 2026 ~14:34 IST (09:04 UTC) in one transaction via the Lovable
-- database tool, with Vivek's GO (28 Sep 14:12 IST). Sandbox skipped (Vivek approved direct to
-- live). Recorded in supabase_migrations.schema_migrations as 20260928090500.
-- Release order (done): app code with PR #42 published first (Lovable deploy 0248f354, 14:31 IST),
-- then this file. Before applying, every role holder was checked read-only: all active users
-- have is_active = true; the only is_active = false role holders are already-disabled, banned accounts.
-- Once applied, RLS that calls these functions blocks a disabled user's still-open session
-- (the access token lasts up to about 1 hour). Active users are unchanged.
-- Missing profile, or is_active not true, is not allowed (fail closed).
-- Signatures, SECURITY DEFINER, STABLE and search_path match
-- supabase/migrations/20260624033221_7a5cc7f0-ffc1-4653-8470-0d0ef260b8b2.sql.
-- Grants stay as on live after 20260701223548: authenticated may execute, anon and PUBLIC may not.
--
-- Rollback: run supabase/migrations-pending/scrum78_role_check_respects_active.rollback.sql
-- (the original bodies from 20260624033221). Grants are not changed by that file. Same SQL:
--   CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
--   RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
--     SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
--   CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
--   RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
--     SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles)) $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.is_active IS TRUE
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id AND ur.role = _role
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.is_active IS TRUE
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _user_id AND ur.role = ANY(_roles)
      )
  )
$$;

-- CREATE OR REPLACE keeps existing grants. Restate the live grants so a replace cannot
-- hand execute back to anon.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;
