
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS normalized_email text,
  ADD COLUMN IF NOT EXISTS normalized_phone text;

CREATE INDEX IF NOT EXISTS customers_norm_email_idx ON public.customers(normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_norm_phone_idx ON public.customers(normalized_phone) WHERE normalized_phone IS NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_customer_contact()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  e text;
  p text;
BEGIN
  -- email: trim + lowercase
  e := nullif(lower(trim(coalesce(NEW.contact_email, ''))), '');
  NEW.normalized_email := e;

  -- phone: strip everything except digits; keep leading + as-is removed; require at least 7 digits
  p := regexp_replace(coalesce(NEW.contact_phone, ''), '\D', '', 'g');
  IF p IS NULL OR length(p) < 7 THEN
    NEW.normalized_phone := NULL;
  ELSE
    -- strip leading zeros for fairer matching; keep last 10-15 digits
    p := regexp_replace(p, '^0+', '');
    NEW.normalized_phone := p;
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_customers_normalize_contact ON public.customers;
CREATE TRIGGER trg_customers_normalize_contact
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.normalize_customer_contact();

-- Backfill
UPDATE public.customers
  SET contact_email = contact_email
  WHERE normalized_email IS NULL OR normalized_phone IS NULL;
