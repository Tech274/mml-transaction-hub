-- SCRUM-78: has_role and has_any_role return false when profiles.is_active is not true.
-- Status: REPO ONLY / NOT APPLIED. This file is not in supabase/migrations/, so nothing applies it.
-- Release order: publish the app code first (server role checks already reject a disabled
-- account). Then, after Atlas's engineering go-ahead and Vivek's approval, move this file
-- into supabase/migrations/ with a fresh timestamp later than 20260928040000,
-- apply on sandbox, then live.
-- Once applied, RLS that calls these functions blocks a disabled user's still-open session
-- (the access token lasts up to about 1 hour). Active users are unchanged.
-- Safe with the current live app: old code keeps working for active users. Disabled users
-- lose row access they can still reach today until the token expires.
-- Missing profile, or is_active not true, is not allowed (fail closed).
-- Signatures, SECURITY DEFINER, STABLE and search_path match
-- supabase/migrations/20260624033221_7a5cc7f0-ffc1-4653-8470-0d0ef260b8b2.sql.
-- Grants stay as on live after 20260701223548: authenticated may execute, anon and PUBLIC may not.
--
-- Rollback: run supabase/migrations-pending/scrum78_role_check_respects_active.rollback.sql
-- (the original bodies from 20260624033221). Grants are not changed by that file.

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
