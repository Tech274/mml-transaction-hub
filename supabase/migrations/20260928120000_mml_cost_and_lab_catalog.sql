-- ticket: MML-accommodations-demo
-- SCRUM-64: new migration under the repo rules. Vivek approved 28 Sep 2026.
-- SCRUM note: Vivek approved this demo slice on 28 Sep 2026. No numbered Jira ticket yet.
-- Status: REPO ONLY, NOT APPLIED. Do not apply to sandbox or live without Atlas and Vivek GO.
-- Release order: after 20260928040000. Migration before any app publish that reads these tables.
-- Adds the cost catalog (vm_tiers, cost_rates) and the lab catalog. Prices stay NULL here;
-- the local demo seed fills illustrative INR figures. Nothing here rewrites transactions.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.lab_catalog;
--   DROP TABLE IF EXISTS public.catalog_audit_log;
--   DROP TABLE IF EXISTS public.cost_rates;
--   DROP TABLE IF EXISTS public.vm_tiers;
--   DELETE FROM public.role_permissions WHERE key IN (
--     'feature_lab_catalog_view','feature_cost_catalog_view','feature_rates_manage',
--     'feature_hybrid_tag','feature_lab_batches_manage');

CREATE TABLE public.vm_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  vcpu int NOT NULL CHECK (vcpu > 0),
  ram_gb int NOT NULL CHECK (ram_gb > 0),
  storage_gb int CHECK (storage_gb IS NULL OR storage_gb >= 0),
  -- Selling price and internal cost, per VM per day, private cloud (approved Q8).
  -- price_per_day mirrors selling_price_per_day for the calculator's tier match.
  price_per_day numeric(12,2) CHECK (price_per_day IS NULL OR price_per_day >= 0),
  selling_price_per_day numeric(12,2) CHECK (selling_price_per_day IS NULL OR selling_price_per_day >= 0),
  internal_cost_per_day numeric(12,2) CHECK (internal_cost_per_day IS NULL OR internal_cost_per_day >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cost_rates (
  key text PRIMARY KEY CHECK (key IN (
    'vcpu_per_day','ram_gb_per_day','storage_gb_per_day','private_input_cost_pct'
  )),
  value numeric(12,4) CHECK (value IS NULL OR value >= 0),
  unit text NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_rates_pct_range CHECK (
    key <> 'private_input_cost_pct' OR value IS NULL OR value <= 100
  )
);

CREATE TABLE public.catalog_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_key text NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lab_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  summary text CHECK (summary IS NULL OR length(summary) <= 500),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  lab_type text NOT NULL CHECK (lab_type IN ('public_cloud','private_cloud','hybrid')),
  cloud_provider text,
  vm_tier_id uuid REFERENCES public.vm_tiers(id),
  default_duration_days int CHECK (default_duration_days IS NULL OR default_duration_days BETWEEN 1 AND 365),
  line_of_business text CHECK (line_of_business IS NULL OR line_of_business IN ('VILT','Standalone','Integrated')),
  tags text[] NOT NULL DEFAULT '{}',
  document_url text CHECK (document_url IS NULL OR document_url ~ '^https://'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  published_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX lab_catalog_title_lower_idx ON public.lab_catalog (lower(btrim(title)));

INSERT INTO public.vm_tiers (code, vcpu, ram_gb, storage_gb, sort_order)
VALUES
  ('8GB 2vCPUs', 2, 8, 50, 1),
  ('8GB 4vCPUs', 4, 8, 50, 2),
  ('12GB 4vCPUs', 4, 12, 80, 3),
  ('16GB 4vCPUs', 4, 16, 100, 4),
  ('24GB 6vCPUs', 6, 24, 150, 5),
  ('32GB 8vCPUs', 8, 32, 200, 6)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.cost_rates (key, value, unit, currency)
VALUES
  ('vcpu_per_day', NULL, 'INR per vCPU per day', 'INR'),
  ('ram_gb_per_day', NULL, 'INR per GB RAM per day', 'INR'),
  ('storage_gb_per_day', NULL, 'INR per GB storage per day', 'INR'),
  ('private_input_cost_pct', 20, 'percent of entered per-user selling price', 'INR')
ON CONFLICT (key) DO NOTHING;

-- Audit. A signed-in change to a tier or a rate needs a reason (5-300 chars).
-- Migration and demo-seed writes run with no auth.uid() and are allowed.
CREATE OR REPLACE FUNCTION public.log_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reason text := nullif(btrim(current_setting('mml.change_reason', true)), '');
  uid uuid := auth.uid();
  oldj jsonb;
  newj jsonb;
  k text;
  keys text[];
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('vm_tiers','cost_rates') THEN
    IF uid IS NOT NULL AND (reason IS NULL OR length(reason) < 5 OR length(reason) > 300) THEN
      RAISE EXCEPTION 'A reason of 5 to 300 characters is required';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'vm_tiers' THEN
    keys := ARRAY['code','vcpu','ram_gb','storage_gb','price_per_day','selling_price_per_day','internal_cost_per_day','is_active'];
  ELSIF TG_TABLE_NAME = 'cost_rates' THEN
    keys := ARRAY['value'];
  ELSE
    keys := ARRAY['title','summary','description','lab_type','cloud_provider','vm_tier_id','default_duration_days','line_of_business','document_url','status'];
  END IF;
  oldj := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  newj := to_jsonb(NEW);
  FOREACH k IN ARRAY keys LOOP
    IF TG_OP = 'INSERT' OR (oldj ->> k) IS DISTINCT FROM (newj ->> k) THEN
      INSERT INTO public.catalog_audit_log (table_name, row_key, field_name, old_value, new_value, reason, changed_by)
      VALUES (
        TG_TABLE_NAME,
        COALESCE(newj ->> 'code', newj ->> 'key', newj ->> 'id'),
        k,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE oldj ->> k END,
        newj ->> k,
        reason,
        uid
      );
    END IF;
  END LOOP;
  IF TG_TABLE_NAME <> 'cost_rates' THEN
    NEW.updated_at := now();
  END IF;
  IF uid IS NOT NULL THEN
    NEW.updated_by := uid;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vm_tiers_audit
  BEFORE UPDATE OR INSERT ON public.vm_tiers
  FOR EACH ROW EXECUTE FUNCTION public.log_catalog_change();

CREATE TRIGGER cost_rates_audit
  BEFORE UPDATE ON public.cost_rates
  FOR EACH ROW EXECUTE FUNCTION public.log_catalog_change();

CREATE TRIGGER lab_catalog_touch
  BEFORE UPDATE OR INSERT ON public.lab_catalog
  FOR EACH ROW EXECUTE FUNCTION public.log_catalog_change();

CREATE OR REPLACE FUNCTION public.save_cost_rate(p_key text, p_value numeric, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only a Super Admin can change rates' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 300 THEN
    RAISE EXCEPTION 'A reason of 5 to 300 characters is required';
  END IF;
  IF p_key = 'private_input_cost_pct' AND p_value IS NOT NULL AND (p_value < 0 OR p_value > 100) THEN
    RAISE EXCEPTION 'The input cost percent must be between 0 and 100';
  END IF;
  IF p_value IS NOT NULL AND (p_value < 0 OR p_value > 1000000) THEN
    RAISE EXCEPTION 'Rate must be blank or between 0 and 1,000,000';
  END IF;
  PERFORM set_config('mml.change_reason', btrim(p_reason), true);
  UPDATE public.cost_rates
     SET value = p_value, updated_by = auth.uid(), updated_at = now()
   WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown rate %', p_key;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_vm_tier(
  p_id uuid,
  p_price_per_day numeric,
  p_selling_price_per_day numeric,
  p_internal_cost_per_day numeric,
  p_is_active boolean,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only a Super Admin can change tier prices' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 300 THEN
    RAISE EXCEPTION 'A reason of 5 to 300 characters is required';
  END IF;
  PERFORM set_config('mml.change_reason', btrim(p_reason), true);
  UPDATE public.vm_tiers
     SET price_per_day = p_price_per_day,
         selling_price_per_day = p_selling_price_per_day,
         internal_cost_per_day = p_internal_cost_per_day,
         is_active = COALESCE(p_is_active, is_active),
         updated_by = auth.uid(),
         updated_at = now()
   WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown tier';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_vm_tier(
  p_code text,
  p_vcpu int,
  p_ram_gb int,
  p_storage_gb int,
  p_selling_price_per_day numeric,
  p_internal_cost_per_day numeric,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only a Super Admin can add a tier' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 300 THEN
    RAISE EXCEPTION 'A reason of 5 to 300 characters is required';
  END IF;
  PERFORM set_config('mml.change_reason', btrim(p_reason), true);
  INSERT INTO public.vm_tiers (
    code, vcpu, ram_gb, storage_gb, price_per_day, selling_price_per_day, internal_cost_per_day, sort_order
  ) VALUES (
    btrim(p_code), p_vcpu, p_ram_gb, p_storage_gb,
    p_selling_price_per_day, p_selling_price_per_day, p_internal_cost_per_day,
    (SELECT COALESCE(max(sort_order), 0) + 1 FROM public.vm_tiers)
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

ALTER TABLE public.vm_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_catalog ENABLE ROW LEVEL SECURITY;

-- Cost catalog is hidden from viewer (approved Q9). Writes are Super Admin only.
CREATE POLICY "Staff read vm tiers"
  ON public.vm_tiers FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user']::app_role[]));

CREATE POLICY "Admin updates vm tiers"
  ON public.vm_tiers FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin inserts vm tiers"
  ON public.vm_tiers FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff read cost rates"
  ON public.cost_rates FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user']::app_role[]));

CREATE POLICY "Admin updates cost rates"
  ON public.cost_rates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff read catalog audit"
  ON public.catalog_audit_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead']::app_role[]));

-- Published rows are visible to every signed-in role. Drafts and archived rows are not (approved Q10).
CREATE POLICY "Read lab catalog"
  ON public.lab_catalog FOR SELECT TO authenticated
  USING (
    status = 'published'
    OR public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[])
  );

CREATE POLICY "Editors insert lab catalog"
  ON public.lab_catalog FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

CREATE POLICY "Editors update lab catalog"
  ON public.lab_catalog FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

REVOKE ALL ON public.vm_tiers, public.cost_rates, public.catalog_audit_log, public.lab_catalog FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.vm_tiers TO authenticated;
GRANT SELECT, UPDATE ON public.cost_rates TO authenticated;
GRANT SELECT ON public.catalog_audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lab_catalog TO authenticated;
GRANT ALL ON public.vm_tiers, public.cost_rates, public.catalog_audit_log, public.lab_catalog TO service_role;

REVOKE ALL ON FUNCTION public.log_catalog_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_cost_rate(text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_vm_tier(uuid, numeric, numeric, numeric, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_vm_tier(text, int, int, int, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_cost_rate(text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_vm_tier(uuid, numeric, numeric, numeric, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_vm_tier(text, int, int, int, numeric, numeric, text) TO authenticated, service_role;

INSERT INTO public.role_permissions (role, key, kind, enabled)
SELECT r.role, k.key, 'feature', k.enabled
FROM (VALUES
  ('admin'::app_role), ('leadership'::app_role), ('finance'::app_role),
  ('ops_lead'::app_role), ('ops_user'::app_role), ('viewer'::app_role)
) AS r(role)
CROSS JOIN (VALUES
  ('feature_lab_catalog_view', true),
  ('feature_cost_catalog_view', true),
  ('feature_rates_manage', false),
  ('feature_hybrid_tag', false),
  ('feature_lab_batches_manage', true)
) AS k(key, enabled)
ON CONFLICT (role, key) DO NOTHING;

-- Viewer does not see the cost catalog. Rate edits and the hybrid tag stay Super Admin only.
UPDATE public.role_permissions SET enabled = false
 WHERE role = 'viewer' AND key = 'feature_cost_catalog_view';
UPDATE public.role_permissions SET enabled = true
 WHERE role = 'admin' AND key IN ('feature_rates_manage','feature_hybrid_tag','feature_cost_catalog_view');
