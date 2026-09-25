
ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.permission_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  perm_key TEXT NOT NULL,
  perm_kind TEXT NOT NULL,
  action TEXT NOT NULL,
  old_enabled BOOLEAN,
  new_enabled BOOLEAN,
  old_sort_order INTEGER,
  new_sort_order INTEGER,
  changed_by UUID,
  changed_by_email TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.permission_audit_log TO authenticated;
GRANT ALL ON public.permission_audit_log TO service_role;

ALTER TABLE public.permission_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read permission audit" ON public.permission_audit_log;
CREATE POLICY "Admins read permission audit" ON public.permission_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "System inserts permission audit" ON public.permission_audit_log;
CREATE POLICY "System inserts permission audit" ON public.permission_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.log_permission_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  actor_email text;
BEGIN
  SELECT email INTO actor_email FROM public.profiles WHERE id = uid;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log(role, perm_key, perm_kind, action, old_enabled, new_enabled, old_sort_order, new_sort_order, changed_by, changed_by_email)
    VALUES (NEW.role, NEW.key, NEW.kind, 'create', NULL, NEW.enabled, NULL, NEW.sort_order, uid, actor_email);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.enabled IS DISTINCT FROM NEW.enabled OR OLD.sort_order IS DISTINCT FROM NEW.sort_order THEN
      INSERT INTO public.permission_audit_log(role, perm_key, perm_kind, action, old_enabled, new_enabled, old_sort_order, new_sort_order, changed_by, changed_by_email)
      VALUES (NEW.role, NEW.key, NEW.kind, 'update', OLD.enabled, NEW.enabled, OLD.sort_order, NEW.sort_order, uid, actor_email);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log(role, perm_key, perm_kind, action, old_enabled, new_enabled, old_sort_order, new_sort_order, changed_by, changed_by_email)
    VALUES (OLD.role, OLD.key, OLD.kind, 'delete', OLD.enabled, NULL, OLD.sort_order, NULL, uid, actor_email);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_permission_change ON public.role_permissions;
CREATE TRIGGER trg_log_permission_change
  AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.log_permission_change();
