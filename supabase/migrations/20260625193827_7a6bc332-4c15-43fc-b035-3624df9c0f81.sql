
-- 1. Add input_cost to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS input_cost numeric(14,2) NOT NULL DEFAULT 0;

-- 2. Reset Line of Business config to Standalone / VILT / Integrated
DELETE FROM public.config_master WHERE category = 'line_of_business';
INSERT INTO public.config_master (category, key, label, sort_order, is_active)
VALUES
  ('line_of_business', 'Standalone',  'Standalone',  1, true),
  ('line_of_business', 'VILT',        'VILT',        2, true),
  ('line_of_business', 'Integrated',  'Integrated',  3, true);

-- 3. Role audit log
CREATE TABLE IF NOT EXISTS public.role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  target_email text,
  role public.app_role NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  changed_by uuid,
  changed_by_email text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.role_audit_log TO authenticated;
GRANT ALL ON public.role_audit_log TO service_role;

ALTER TABLE public.role_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view role audit log"
  ON public.role_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_role_audit_target ON public.role_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_role_audit_changed_at ON public.role_audit_log(changed_at DESC);

-- 4. Trigger to populate audit log on role grants/revokes
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  actor_email text;
  t_email text;
BEGIN
  SELECT email INTO actor_email FROM public.profiles WHERE id = uid;
  IF TG_OP = 'INSERT' THEN
    SELECT email INTO t_email FROM public.profiles WHERE id = NEW.user_id;
    INSERT INTO public.role_audit_log(target_user_id, target_email, role, action, changed_by, changed_by_email)
    VALUES (NEW.user_id, t_email, NEW.role, 'grant', uid, actor_email);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT email INTO t_email FROM public.profiles WHERE id = OLD.user_id;
    INSERT INTO public.role_audit_log(target_user_id, target_email, role, action, changed_by, changed_by_email)
    VALUES (OLD.user_id, t_email, OLD.role, 'revoke', uid, actor_email);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_audit ON public.user_roles;
CREATE TRIGGER trg_role_audit
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.log_role_change();

-- 5. Unique case-insensitive emails on profiles
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_unique
  ON public.profiles (lower(email));
