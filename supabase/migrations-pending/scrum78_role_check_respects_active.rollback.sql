-- SCRUM-78 rollback. Not a migration. Nothing applies this file on its own.
-- Restores the original has_role / has_any_role bodies from
-- supabase/migrations/20260624033221_7a5cc7f0-ffc1-4653-8470-0d0ef260b8b2.sql.
-- CREATE OR REPLACE keeps the grants already on the functions (authenticated yes, anon no).
-- After this, a disabled user who still holds a role is treated as having that role again.

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;
