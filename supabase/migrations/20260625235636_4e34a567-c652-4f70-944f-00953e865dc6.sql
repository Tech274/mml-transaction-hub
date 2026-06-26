
-- Add deactivation reason to customers and include it in audit log
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS deactivation_reason text;

-- Update audit trigger to capture deactivation_reason on status changes and updates
CREATE OR REPLACE FUNCTION public.log_customer_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  actor_email text;
  diff jsonb := '{}'::jsonb;
  act text;
  status_changes jsonb;
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
      status_changes := jsonb_build_object('is_active', jsonb_build_array(OLD.is_active, NEW.is_active));
      IF NOT NEW.is_active AND NEW.deactivation_reason IS NOT NULL THEN
        status_changes := status_changes || jsonb_build_object('deactivation_reason', NEW.deactivation_reason);
      END IF;
      INSERT INTO public.customer_audit_log(customer_id, customer_name, action, changes, changed_by, changed_by_email)
      VALUES (NEW.id, NEW.customer_name, act, status_changes, uid, actor_email);
    END IF;
    IF diff <> '{}'::jsonb THEN
      INSERT INTO public.customer_audit_log(customer_id, customer_name, action, changes, changed_by, changed_by_email)
      VALUES (NEW.id, NEW.customer_name, 'update', diff, uid, actor_email);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END; $function$;
