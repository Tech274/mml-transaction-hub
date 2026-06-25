
-- 1. Account Managers master list
CREATE TABLE public.account_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_managers TO authenticated;
GRANT ALL ON public.account_managers TO service_role;
ALTER TABLE public.account_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read account managers" ON public.account_managers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins/ops manage account managers" ON public.account_managers
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

CREATE OR REPLACE FUNCTION public.set_am_normalized()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.normalized_name := lower(regexp_replace(trim(NEW.name), '\s+', ' ', 'g'));
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_am_normalize BEFORE INSERT OR UPDATE ON public.account_managers
  FOR EACH ROW EXECUTE FUNCTION public.set_am_normalized();

-- Seed from existing customers
INSERT INTO public.account_managers (name, normalized_name)
SELECT DISTINCT trim(account_manager_name),
       lower(regexp_replace(trim(account_manager_name), '\s+', ' ', 'g'))
FROM public.customers
WHERE account_manager_name IS NOT NULL AND trim(account_manager_name) <> ''
ON CONFLICT (normalized_name) DO NOTHING;

-- 2. Customer audit log
CREATE TABLE public.customer_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  customer_name text,
  action text NOT NULL, -- 'create' | 'update' | 'activate' | 'deactivate'
  changes jsonb,
  changed_by uuid,
  changed_by_email text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.customer_audit_log TO authenticated;
GRANT ALL ON public.customer_audit_log TO service_role;
ALTER TABLE public.customer_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read customer audit" ON public.customer_audit_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));
CREATE POLICY "System inserts customer audit" ON public.customer_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.log_customer_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  actor_email text;
  diff jsonb := '{}'::jsonb;
  act text;
BEGIN
  SELECT email INTO actor_email FROM public.profiles WHERE id = uid;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.customer_audit_log(customer_id, customer_name, action, changes, changed_by, changed_by_email)
    VALUES (NEW.id, NEW.customer_name, 'create',
            jsonb_build_object('customer_name', NEW.customer_name,
                               'account_manager_name', NEW.account_manager_name,
                               'industry', NEW.industry,
                               'contact_email', NEW.contact_email,
                               'contact_phone', NEW.contact_phone),
            uid, actor_email);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.customer_name IS DISTINCT FROM NEW.customer_name THEN
      diff := diff || jsonb_build_object('customer_name', jsonb_build_array(OLD.customer_name, NEW.customer_name)); END IF;
    IF OLD.account_manager_name IS DISTINCT FROM NEW.account_manager_name THEN
      diff := diff || jsonb_build_object('account_manager_name', jsonb_build_array(OLD.account_manager_name, NEW.account_manager_name)); END IF;
    IF OLD.contact_email IS DISTINCT FROM NEW.contact_email THEN
      diff := diff || jsonb_build_object('contact_email', jsonb_build_array(OLD.contact_email, NEW.contact_email)); END IF;
    IF OLD.contact_phone IS DISTINCT FROM NEW.contact_phone THEN
      diff := diff || jsonb_build_object('contact_phone', jsonb_build_array(OLD.contact_phone, NEW.contact_phone)); END IF;
    IF OLD.industry IS DISTINCT FROM NEW.industry THEN
      diff := diff || jsonb_build_object('industry', jsonb_build_array(OLD.industry, NEW.industry)); END IF;
    IF OLD.notes IS DISTINCT FROM NEW.notes THEN
      diff := diff || jsonb_build_object('notes', jsonb_build_array(OLD.notes, NEW.notes)); END IF;
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      act := CASE WHEN NEW.is_active THEN 'activate' ELSE 'deactivate' END;
      INSERT INTO public.customer_audit_log(customer_id, customer_name, action, changes, changed_by, changed_by_email)
      VALUES (NEW.id, NEW.customer_name, act,
              jsonb_build_object('is_active', jsonb_build_array(OLD.is_active, NEW.is_active)),
              uid, actor_email);
    END IF;
    IF diff <> '{}'::jsonb THEN
      INSERT INTO public.customer_audit_log(customer_id, customer_name, action, changes, changed_by, changed_by_email)
      VALUES (NEW.id, NEW.customer_name, 'update', diff, uid, actor_email);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_customer_audit
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.log_customer_change();
