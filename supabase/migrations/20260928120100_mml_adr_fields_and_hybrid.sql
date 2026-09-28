-- ticket: MML-accommodations-demo
-- SCRUM-64: new migration under the repo rules. Vivek approved 28 Sep 2026.
-- Status: REPO ONLY, NOT APPLIED. Do not apply to sandbox or live without Atlas and Vivek GO.
-- Release order: after 20260928120000. Additive nullable columns only. Old app code ignores them.
-- Private-cloud commercials and the admin-only hybrid tag. The 20% rule is
-- private_input_cost_pct of the entered per-user selling price (Vivek, 28 Sep 2026).
-- The 250/100 split in the draft spec was an example, not a fixed price.
-- The not_secret checks match looksLikeSecret() in src/lib/cost-calculator.ts (names only, never key values).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS transaction_tags_audit ON public.transaction_tags;
--   DROP FUNCTION IF EXISTS public.log_transaction_tag();
--   DROP TABLE IF EXISTS public.transaction_tags;
--   ALTER TABLE public.transactions
--     DROP COLUMN IF EXISTS license_name,
--     DROP COLUMN IF EXISTS api_key_service,
--     DROP COLUMN IF EXISTS selling_price_per_user,
--     DROP COLUMN IF EXISTS vm_price_per_user,
--     DROP COLUMN IF EXISTS license_price_per_user,
--     DROP COLUMN IF EXISTS api_key_price_per_user,
--     DROP COLUMN IF EXISTS input_cost_per_user,
--     DROP COLUMN IF EXISTS input_cost_pct,
--     DROP COLUMN IF EXISTS vm_hours_consumed,
--     DROP COLUMN IF EXISTS license_seats_used,
--     DROP COLUMN IF EXISTS api_units_consumed,
--     DROP COLUMN IF EXISTS api_unit_label,
--     DROP COLUMN IF EXISTS addon_revenue_total;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS license_name text,
  ADD COLUMN IF NOT EXISTS api_key_service text,
  ADD COLUMN IF NOT EXISTS selling_price_per_user numeric(14,2),
  ADD COLUMN IF NOT EXISTS vm_price_per_user numeric(14,2),
  ADD COLUMN IF NOT EXISTS license_price_per_user numeric(14,2),
  ADD COLUMN IF NOT EXISTS api_key_price_per_user numeric(14,2),
  ADD COLUMN IF NOT EXISTS input_cost_per_user numeric(14,2),
  ADD COLUMN IF NOT EXISTS input_cost_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS vm_hours_consumed numeric(12,2),
  ADD COLUMN IF NOT EXISTS license_seats_used int,
  ADD COLUMN IF NOT EXISTS api_units_consumed numeric(16,2),
  ADD COLUMN IF NOT EXISTS api_unit_label text;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_license_name_len,
  ADD CONSTRAINT transactions_license_name_len CHECK (license_name IS NULL OR length(license_name) <= 200),
  DROP CONSTRAINT IF EXISTS transactions_api_key_service_len,
  ADD CONSTRAINT transactions_api_key_service_len CHECK (api_key_service IS NULL OR length(api_key_service) <= 200),
  DROP CONSTRAINT IF EXISTS transactions_license_name_not_secret,
  ADD CONSTRAINT transactions_license_name_not_secret CHECK (
    license_name IS NULL
    OR (
      btrim(license_name) !~* '^sk-[A-Za-z0-9]'
      AND btrim(license_name) !~ '^(sk_live_|sk_test_|AKIA[0-9A-Z]{16}|ghp_|github_pat_|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}\.)'
      AND btrim(license_name) !~ '^[A-Za-z0-9_+/=-]{32,}$'
    )
  ),
  DROP CONSTRAINT IF EXISTS transactions_api_key_service_not_secret,
  ADD CONSTRAINT transactions_api_key_service_not_secret CHECK (
    api_key_service IS NULL
    OR (
      btrim(api_key_service) !~* '^sk-[A-Za-z0-9]'
      AND btrim(api_key_service) !~ '^(sk_live_|sk_test_|AKIA[0-9A-Z]{16}|ghp_|github_pat_|xox[baprs]-|eyJ[A-Za-z0-9_-]{10,}\.)'
      AND btrim(api_key_service) !~ '^[A-Za-z0-9_+/=-]{32,}$'
    )
  ),
  DROP CONSTRAINT IF EXISTS transactions_selling_price_per_user_nonneg,
  ADD CONSTRAINT transactions_selling_price_per_user_nonneg CHECK (selling_price_per_user IS NULL OR selling_price_per_user >= 0),
  DROP CONSTRAINT IF EXISTS transactions_vm_price_per_user_nonneg,
  ADD CONSTRAINT transactions_vm_price_per_user_nonneg CHECK (vm_price_per_user IS NULL OR vm_price_per_user >= 0),
  DROP CONSTRAINT IF EXISTS transactions_license_price_per_user_nonneg,
  ADD CONSTRAINT transactions_license_price_per_user_nonneg CHECK (license_price_per_user IS NULL OR license_price_per_user >= 0),
  DROP CONSTRAINT IF EXISTS transactions_api_key_price_per_user_nonneg,
  ADD CONSTRAINT transactions_api_key_price_per_user_nonneg CHECK (api_key_price_per_user IS NULL OR api_key_price_per_user >= 0),
  DROP CONSTRAINT IF EXISTS transactions_input_cost_per_user_nonneg,
  ADD CONSTRAINT transactions_input_cost_per_user_nonneg CHECK (input_cost_per_user IS NULL OR input_cost_per_user >= 0),
  DROP CONSTRAINT IF EXISTS transactions_input_cost_pct_range,
  ADD CONSTRAINT transactions_input_cost_pct_range CHECK (input_cost_pct IS NULL OR input_cost_pct BETWEEN 0 AND 100),
  DROP CONSTRAINT IF EXISTS transactions_vm_hours_nonneg,
  ADD CONSTRAINT transactions_vm_hours_nonneg CHECK (vm_hours_consumed IS NULL OR vm_hours_consumed >= 0),
  DROP CONSTRAINT IF EXISTS transactions_license_seats_nonneg,
  ADD CONSTRAINT transactions_license_seats_nonneg CHECK (license_seats_used IS NULL OR license_seats_used >= 0),
  DROP CONSTRAINT IF EXISTS transactions_api_units_nonneg,
  ADD CONSTRAINT transactions_api_units_nonneg CHECK (api_units_consumed IS NULL OR api_units_consumed >= 0),
  DROP CONSTRAINT IF EXISTS transactions_api_unit_label_check,
  ADD CONSTRAINT transactions_api_unit_label_check CHECK (api_unit_label IS NULL OR api_unit_label IN ('calls','tokens','credits'));

-- Add-on total opens only when a component price is set. Blank stays NULL, never 0.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS addon_revenue_total numeric(14,2)
  GENERATED ALWAYS AS (
    CASE
      WHEN license_price_per_user IS NULL AND api_key_price_per_user IS NULL THEN NULL
      ELSE (COALESCE(license_price_per_user, 0) + COALESCE(api_key_price_per_user, 0)) * total_users
    END
  ) STORED;

-- Extend the activity log so input cost, system config and the new columns are traceable.
-- Auto-fill columns are written by the margin routine with their own action names.
CREATE OR REPLACE FUNCTION public.log_transaction_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  fields text[] := ARRAY[
    'potential_id','customer_name','lab_name','lab_type','cloud_provider','line_of_business',
    'start_date','end_date','total_users','selling_cost','month','year',
    'input_cost','system_config','license_name','api_key_service','selling_price_per_user',
    'vm_price_per_user','license_price_per_user','api_key_price_per_user','input_cost_per_user',
    'input_cost_pct','vm_hours_consumed','license_seats_used','api_units_consumed','api_unit_label'
  ];
  f text;
  ov text;
  nv text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.transaction_activity_log (transaction_id, action, changed_by)
    VALUES (NEW.id, 'create', uid);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.is_deleted IS DISTINCT FROM NEW.is_deleted THEN
      INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
      VALUES (NEW.id, CASE WHEN NEW.is_deleted THEN 'soft_delete' ELSE 'restore' END,
              'is_deleted', OLD.is_deleted::text, NEW.is_deleted::text, uid);
    END IF;
    FOREACH f IN ARRAY fields LOOP
      EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', f, f) INTO ov, nv USING OLD, NEW;
      IF ov IS DISTINCT FROM nv THEN
        INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
        VALUES (NEW.id, 'update', f, ov, nv, uid);
      END IF;
    END LOOP;
    NEW.updated_by := uid;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

-- Hybrid tag lives off the transaction row so non-admins cannot read it (approved Q11).
-- One solution = one distinct potential id. The tag never enters a KPI.
CREATE TABLE public.transaction_tags (
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (tag IN ('hybrid')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transaction_id, tag)
);

ALTER TABLE public.transaction_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin reads hybrid tags"
  ON public.transaction_tags FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin inserts hybrid tags"
  ON public.transaction_tags FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin updates hybrid tags"
  ON public.transaction_tags FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin deletes hybrid tags"
  ON public.transaction_tags FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

REVOKE ALL ON public.transaction_tags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_tags TO authenticated;
GRANT ALL ON public.transaction_tags TO service_role;

CREATE OR REPLACE FUNCTION public.log_transaction_tag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, new_value, changed_by)
    VALUES (NEW.transaction_id, 'tag_added', 'hybrid', NEW.tag, auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, changed_by)
    VALUES (OLD.transaction_id, 'tag_removed', 'hybrid', OLD.tag, auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER transaction_tags_audit
  AFTER INSERT OR DELETE ON public.transaction_tags
  FOR EACH ROW EXECUTE FUNCTION public.log_transaction_tag();

REVOKE ALL ON FUNCTION public.log_transaction_tag() FROM PUBLIC, anon, authenticated;
