-- ticket: MML-accommodations-demo
-- SCRUM-64: new migration under the repo rules. Vivek approved 28 Sep 2026.
-- Status: REPO ONLY, NOT APPLIED. Do not apply to sandbox or live without Atlas and Vivek GO.
-- Release order: after 20260928120100. Adds lab batches, invoices, the margin routine and a nightly pg_cron job.
-- The routine writes input_cost_auto only. A real input_cost always wins. Reports stay in INR.
--
-- Rollback:
--   select cron.unschedule('mml-lab-batch-recompute');
--   DROP TRIGGER IF EXISTS transactions_mark_batch_dirty ON public.transactions;
--   DROP TRIGGER IF EXISTS transactions_guard_closed_batch ON public.transactions;
--   DROP FUNCTION IF EXISTS public.recompute_dirty_lab_batches();
--   DROP FUNCTION IF EXISTS public.request_lab_batch_recompute(uuid);
--   DROP FUNCTION IF EXISTS public.reopen_lab_batch(uuid);
--   DROP FUNCTION IF EXISTS public.supersede_lab_batch_invoice(uuid, text, text, date, text, numeric, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.record_lab_batch_invoice(uuid, text, text, date, text, numeric, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.close_lab_batch(uuid);
--   DROP FUNCTION IF EXISTS public.recompute_lab_batch_costs(uuid, text);
--   DROP FUNCTION IF EXISTS public.mark_lab_batch_dirty();
--   DROP FUNCTION IF EXISTS public.guard_closed_batch();
--   DROP VIEW IF EXISTS public.v_transaction_costs;
--   ALTER TABLE public.transactions
--     DROP COLUMN IF EXISTS input_cost_actual_alloc,
--     DROP COLUMN IF EXISTS input_cost_auto_run_id,
--     DROP COLUMN IF EXISTS input_cost_auto,
--     DROP COLUMN IF EXISTS lab_batch_id;
--   DROP TABLE IF EXISTS public.lab_batch_cost_runs;
--   DROP TABLE IF EXISTS public.lab_batch_invoices;
--   DROP TABLE IF EXISTS public.lab_batches;
--   DROP SEQUENCE IF EXISTS public.lab_batch_code_seq;

CREATE SEQUENCE public.lab_batch_code_seq;

CREATE TABLE public.lab_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text NOT NULL UNIQUE,
  name text CHECK (name IS NULL OR length(name) <= 200),
  potential_id text,
  lab_type text CHECK (lab_type IS NULL OR lab_type IN ('public_cloud','private_cloud')),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency IN ('INR','USD')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed_estimated','closed_actual')),
  revenue_total numeric(14,2),
  estimated_cost_total numeric(14,2),
  actual_cost_total numeric(14,2),
  known_line_count int,
  auto_line_count int,
  flags text[] NOT NULL DEFAULT '{}',
  needs_recompute boolean NOT NULL DEFAULT true,
  last_run_id uuid,
  closed_at timestamptz,
  closed_by uuid,
  reopened_at timestamptz,
  reopened_by uuid,
  vm_hours_consumed numeric(12,2),
  license_seats_used int,
  api_units_consumed numeric(16,2),
  api_unit_label text CHECK (api_unit_label IS NULL OR api_unit_label IN ('calls','tokens','credits')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lab_batch_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_batch_id uuid NOT NULL REFERENCES public.lab_batches(id),
  vendor text NOT NULL,
  invoice_ref text,
  invoice_date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('INR','USD')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  fx_rate_to_inr numeric(12,6) CHECK (fx_rate_to_inr IS NULL OR fx_rate_to_inr > 0),
  amount_inr numeric(14,2) NOT NULL CHECK (amount_inr >= 0),
  is_final boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'vendor_invoice' CHECK (source IN ('vendor_invoice','manual_overall_cost')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  superseded_by uuid REFERENCES public.lab_batch_invoices(id),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_batch_invoices_fx_required CHECK (currency = 'INR' OR fx_rate_to_inr IS NOT NULL)
);

CREATE TABLE public.lab_batch_cost_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_batch_id uuid NOT NULL REFERENCES public.lab_batches(id),
  trigger text NOT NULL CHECK (trigger IN ('close','invoice','row_change','nightly','manual','reopen')),
  inputs_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied','unchanged','no_known_costs','error')),
  known_count int,
  missing_count int,
  avg_used numeric(14,2),
  method text NOT NULL DEFAULT 'mean',
  estimated_total numeric(14,2),
  actual_total numeric(14,2),
  details jsonb,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS lab_batch_id uuid REFERENCES public.lab_batches(id),
  ADD COLUMN IF NOT EXISTS input_cost_auto numeric(14,2),
  ADD COLUMN IF NOT EXISTS input_cost_auto_run_id uuid,
  ADD COLUMN IF NOT EXISTS input_cost_actual_alloc numeric(14,2);

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_input_cost_auto_nonneg,
  ADD CONSTRAINT transactions_input_cost_auto_nonneg CHECK (input_cost_auto IS NULL OR input_cost_auto >= 0),
  DROP CONSTRAINT IF EXISTS transactions_input_cost_actual_alloc_nonneg,
  ADD CONSTRAINT transactions_input_cost_actual_alloc_nonneg CHECK (input_cost_actual_alloc IS NULL OR input_cost_actual_alloc >= 0);

CREATE INDEX IF NOT EXISTS transactions_lab_batch_id_idx
  ON public.transactions (lab_batch_id) WHERE NOT is_deleted;

-- A table-level UPDATE grant ignores a column REVOKE, so a trigger rejects
-- signed-in writes of the system columns. The margin routine sets
-- mml.batch_recompute and is allowed through. Seed/migration writes have no auth.uid().
REVOKE UPDATE (input_cost_auto, input_cost_auto_run_id, input_cost_actual_alloc)
  ON public.transactions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_system_cost_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('mml.batch_recompute', true) = '1' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.input_cost_auto IS NOT NULL OR NEW.input_cost_auto_run_id IS NOT NULL OR NEW.input_cost_actual_alloc IS NOT NULL THEN
      RAISE EXCEPTION 'System cost columns are maintained by the margin routine' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.input_cost_auto IS DISTINCT FROM OLD.input_cost_auto
     OR NEW.input_cost_auto_run_id IS DISTINCT FROM OLD.input_cost_auto_run_id
     OR NEW.input_cost_actual_alloc IS DISTINCT FROM OLD.input_cost_actual_alloc THEN
    RAISE EXCEPTION 'System cost columns are maintained by the margin routine' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_guard_system_cost_columns ON public.transactions;
CREATE TRIGGER transactions_guard_system_cost_columns
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_system_cost_columns();

REVOKE ALL ON FUNCTION public.guard_system_cost_columns() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_system_cost_columns() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assign_lab_batch_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.batch_code IS NULL OR btrim(NEW.batch_code) = '' THEN
    NEW.batch_code := 'LB-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.lab_batch_code_seq')::text, 4, '0');
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER lab_batches_assign_code
  BEFORE INSERT ON public.lab_batches
  FOR EACH ROW EXECUTE FUNCTION public.assign_lab_batch_code();

CREATE OR REPLACE FUNCTION public.guard_closed_batch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  st text;
BEGIN
  IF current_setting('mml.batch_recompute', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.lab_batch_id IS NOT NULL THEN
    SELECT status INTO st FROM public.lab_batches WHERE id = NEW.lab_batch_id;
    IF st IS NOT NULL AND st <> 'open' THEN
      RAISE EXCEPTION 'This batch is closed. Reopen it before adding a line.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.lab_batch_id IS DISTINCT FROM OLD.lab_batch_id THEN
      IF NEW.lab_batch_id IS NOT NULL THEN
        SELECT status INTO st FROM public.lab_batches WHERE id = NEW.lab_batch_id;
        IF st IS DISTINCT FROM 'open' THEN
          RAISE EXCEPTION 'This batch is closed. Reopen it before adding a line.';
        END IF;
      END IF;
      IF OLD.lab_batch_id IS NOT NULL THEN
        SELECT status INTO st FROM public.lab_batches WHERE id = OLD.lab_batch_id;
        IF st IS DISTINCT FROM 'open' THEN
          RAISE EXCEPTION 'This batch is closed. Reopen it before removing a line.';
        END IF;
      END IF;
    ELSIF OLD.lab_batch_id IS NOT NULL AND (
      NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
      OR NEW.input_cost IS DISTINCT FROM OLD.input_cost
      OR NEW.selling_cost IS DISTINCT FROM OLD.selling_cost
      OR NEW.total_users IS DISTINCT FROM OLD.total_users
    ) THEN
      SELECT status INTO st FROM public.lab_batches WHERE id = OLD.lab_batch_id;
      IF st IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'This batch is closed. Reopen it before changing its lines.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_guard_closed_batch
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_batch();

CREATE OR REPLACE FUNCTION public.mark_lab_batch_dirty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('mml.batch_recompute', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.lab_batch_id IS NOT NULL THEN
    UPDATE public.lab_batches SET needs_recompute = true, updated_at = now() WHERE id = NEW.lab_batch_id;
  ELSIF TG_OP = 'UPDATE' AND (
    NEW.lab_batch_id IS DISTINCT FROM OLD.lab_batch_id
    OR NEW.input_cost IS DISTINCT FROM OLD.input_cost
    OR NEW.selling_cost IS DISTINCT FROM OLD.selling_cost
    OR NEW.total_users IS DISTINCT FROM OLD.total_users
    OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
  ) THEN
    IF OLD.lab_batch_id IS NOT NULL THEN
      UPDATE public.lab_batches SET needs_recompute = true, updated_at = now() WHERE id = OLD.lab_batch_id;
    END IF;
    IF NEW.lab_batch_id IS NOT NULL AND NEW.lab_batch_id IS DISTINCT FROM OLD.lab_batch_id THEN
      UPDATE public.lab_batches SET needs_recompute = true, updated_at = now() WHERE id = NEW.lab_batch_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_mark_batch_dirty
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.mark_lab_batch_dirty();

-- Log the batch link too. Auto columns stay out of this trigger; the routine names those actions.
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
    'input_cost_pct','vm_hours_consumed','license_seats_used','api_units_consumed','api_unit_label',
    'lab_batch_id'
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

CREATE OR REPLACE FUNCTION public.recompute_lab_batch_costs(p_batch_id uuid, p_trigger text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.lab_batches%ROWTYPE;
  v_hash text;
  v_last text;
  v_run uuid;
  v_known int := 0;
  v_missing int := 0;
  v_avg numeric;
  v_method text := 'mean';
  v_est numeric := 0;
  v_act numeric;
  v_revenue numeric := 0;
  v_flags text[] := '{}';
  v_has_invoice boolean := false;
  v_sum_est numeric := 0;
  v_sum_users numeric := 0;
  v_sum_w numeric := 0;
  v_raw_sum numeric := 0;
  v_largest uuid;
  v_largest_w numeric := -1;
  v_weight numeric;
  v_raw numeric;
  v_rem numeric;
  rec record;
  v_fallback numeric;
  v_filled boolean := false;
  v_still_blank boolean := false;
  v_status text;
  v_details jsonb := '[]'::jsonb;
  v_med numeric;
BEGIN
  IF p_trigger NOT IN ('close','invoice','row_change','nightly','manual','reopen') THEN
    RAISE EXCEPTION 'Unknown recompute trigger %', p_trigger;
  END IF;

  SELECT * INTO b FROM public.lab_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'batch not found');
  END IF;

  PERFORM set_config('mml.batch_recompute', '1', true);

  SELECT md5(concat_ws('|',
    -- Hash the status this run will store. A close that gains an invoice
    -- moves to closed_actual, and that move must not force another run.
    CASE
      WHEN b.status IN ('closed_estimated', 'closed_actual') AND EXISTS (
        SELECT 1 FROM public.lab_batch_invoices
         WHERE lab_batch_id = p_batch_id AND status = 'active' AND is_final
      ) THEN 'closed_actual'
      ELSE b.status
    END,
    coalesce(b.closed_at::text, ''),
    coalesce((
      SELECT string_agg(concat_ws(':', id::text, coalesce(input_cost::text,'∅'), coalesce(selling_cost::text,'∅'),
                                   coalesce(total_users::text,'∅'), is_deleted::text, lab_type,
                                   coalesce(lab_name,''), coalesce(cloud_provider,'')), ',' ORDER BY id)
      FROM public.transactions WHERE lab_batch_id = p_batch_id
    ), ''),
    coalesce((
      SELECT string_agg(concat_ws(':', id::text, status, coalesce(amount_inr::text,'∅'), is_final::text), ',' ORDER BY id)
      FROM public.lab_batch_invoices WHERE lab_batch_id = p_batch_id
    ), '')
  )) INTO v_hash;

  SELECT inputs_hash INTO v_last
    FROM public.lab_batch_cost_runs
   WHERE lab_batch_id = p_batch_id AND status IN ('applied', 'no_known_costs')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_last IS NOT NULL AND v_last = v_hash THEN
    INSERT INTO public.lab_batch_cost_runs (lab_batch_id, trigger, inputs_hash, status, method, created_by)
    VALUES (p_batch_id, p_trigger, v_hash, 'unchanged', 'mean', auth.uid())
    RETURNING id INTO v_run;
    UPDATE public.lab_batches SET needs_recompute = false, last_run_id = v_run, updated_at = now() WHERE id = p_batch_id;
    PERFORM set_config('mml.batch_recompute', '', true);
    RETURN jsonb_build_object('status', 'unchanged', 'run_id', v_run);
  END IF;

  v_run := gen_random_uuid();

  IF p_trigger = 'reopen' OR b.status = 'open' THEN
    UPDATE public.transactions
       SET input_cost_actual_alloc = NULL
     WHERE lab_batch_id = p_batch_id AND input_cost_actual_alloc IS NOT NULL;
  END IF;

  SELECT coalesce(sum(coalesce(selling_cost, 0)), 0)
    INTO v_revenue
    FROM public.transactions
   WHERE lab_batch_id = p_batch_id AND NOT is_deleted;

  SELECT count(*) FILTER (WHERE input_cost IS NOT NULL),
         count(*) FILTER (WHERE input_cost IS NULL)
    INTO v_known, v_missing
    FROM public.transactions
   WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND lab_type = 'public_cloud';

  IF v_known >= 1 THEN
    SELECT round(avg(input_cost), 2),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY input_cost)
      INTO v_avg, v_med
      FROM public.transactions
     WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND lab_type = 'public_cloud' AND input_cost IS NOT NULL;
    IF v_med IS NOT NULL AND v_med > 0 AND EXISTS (
      SELECT 1 FROM public.transactions
       WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND lab_type = 'public_cloud' AND input_cost IS NOT NULL
         AND (input_cost > v_med * 3 OR input_cost < v_med / 3)
    ) THEN
      v_flags := v_flags || ARRAY['possible_outlier'];
    END IF;
  END IF;

  -- A typed cost wins. Clear any previous auto-fill on that line.
  INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
  SELECT id, 'auto_clear', 'input_cost_auto', input_cost_auto::text, NULL, NULL
    FROM public.transactions
   WHERE lab_batch_id = p_batch_id AND input_cost IS NOT NULL AND input_cost_auto IS NOT NULL;

  UPDATE public.transactions
     SET input_cost_auto = NULL, input_cost_auto_run_id = NULL
   WHERE lab_batch_id = p_batch_id AND input_cost IS NOT NULL AND input_cost_auto IS NOT NULL;

  IF v_known >= 1 THEN
    INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
    SELECT id, 'auto_fill', 'input_cost_auto', input_cost_auto::text, v_avg::text, NULL
      FROM public.transactions
     WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND lab_type = 'public_cloud'
       AND input_cost IS NULL AND input_cost_auto IS DISTINCT FROM v_avg;
    UPDATE public.transactions
       SET input_cost_auto = v_avg, input_cost_auto_run_id = v_run
     WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND lab_type = 'public_cloud' AND input_cost IS NULL;
  ELSIF v_missing > 0 THEN
    v_method := 'mean_90d_fallback';
    FOR rec IN
      SELECT id, lab_name, cloud_provider, input_cost_auto
        FROM public.transactions
       WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND lab_type = 'public_cloud' AND input_cost IS NULL
    LOOP
      SELECT round(avg(input_cost), 2) INTO v_fallback
        FROM public.transactions
       WHERE NOT is_deleted AND input_cost IS NOT NULL AND lab_type = 'public_cloud'
         AND lab_name IS NOT DISTINCT FROM rec.lab_name
         AND cloud_provider IS NOT DISTINCT FROM rec.cloud_provider
         AND coalesce(start_date, created_at::date) >= (current_date - 90)
         AND id <> rec.id
         AND (lab_batch_id IS DISTINCT FROM p_batch_id);
      IF v_fallback IS NULL THEN
        v_still_blank := true;
        IF rec.input_cost_auto IS NOT NULL THEN
          INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
          VALUES (rec.id, 'auto_clear', 'input_cost_auto', rec.input_cost_auto::text, NULL, NULL);
          UPDATE public.transactions SET input_cost_auto = NULL, input_cost_auto_run_id = NULL WHERE id = rec.id;
        END IF;
      ELSE
        v_filled := true;
        IF rec.input_cost_auto IS DISTINCT FROM v_fallback THEN
          INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
          VALUES (rec.id, 'auto_fill', 'input_cost_auto', rec.input_cost_auto::text, v_fallback::text, NULL);
        END IF;
        UPDATE public.transactions
           SET input_cost_auto = v_fallback, input_cost_auto_run_id = v_run
         WHERE id = rec.id;
      END IF;
    END LOOP;
    IF v_still_blank THEN
      v_flags := v_flags || ARRAY['no_known_costs'];
    END IF;
    IF NOT v_filled THEN
      v_method := 'none';
      v_avg := NULL;
    END IF;
  END IF;

  SELECT coalesce(sum(coalesce(input_cost, input_cost_auto, 0)), 0),
         coalesce(sum(coalesce(input_cost, input_cost_auto, 0)), 0),
         coalesce(sum(coalesce(total_users, 0)), 0)
    INTO v_est, v_sum_est, v_sum_users
    FROM public.transactions
   WHERE lab_batch_id = p_batch_id AND NOT is_deleted;

  SELECT coalesce(sum(amount_inr), 0), count(*) > 0
    INTO v_act, v_has_invoice
    FROM public.lab_batch_invoices
   WHERE lab_batch_id = p_batch_id AND status = 'active' AND is_final;

  v_status := b.status;
  IF v_has_invoice AND b.status IN ('closed_estimated','closed_actual') THEN
    v_status := 'closed_actual';
    -- Pro-rata to the estimate, else to users, else equally. Remainder goes to the largest line.
    FOR rec IN
      SELECT id, coalesce(input_cost, input_cost_auto, 0) AS est, coalesce(total_users, 0) AS users
        FROM public.transactions
       WHERE lab_batch_id = p_batch_id AND NOT is_deleted
       ORDER BY id
    LOOP
      IF v_sum_est > 0 THEN
        v_weight := rec.est;
      ELSIF v_sum_users > 0 THEN
        v_weight := rec.users;
      ELSE
        v_weight := 1;
      END IF;
      v_sum_w := v_sum_w + v_weight;
      IF v_weight > v_largest_w OR (v_weight = v_largest_w AND (v_largest IS NULL OR rec.id < v_largest)) THEN
        v_largest_w := v_weight;
        v_largest := rec.id;
      END IF;
    END LOOP;

    IF v_sum_w = 0 THEN
      v_sum_w := 1;
    END IF;

    FOR rec IN
      SELECT id, coalesce(input_cost, input_cost_auto, 0) AS est, coalesce(total_users, 0) AS users, input_cost_actual_alloc AS prev
        FROM public.transactions
       WHERE lab_batch_id = p_batch_id AND NOT is_deleted
       ORDER BY id
    LOOP
      IF v_sum_est > 0 THEN
        v_weight := rec.est;
      ELSIF v_sum_users > 0 THEN
        v_weight := rec.users;
      ELSE
        v_weight := 1;
      END IF;
      v_raw := round(v_act * v_weight / v_sum_w, 2);
      v_raw_sum := v_raw_sum + v_raw;
      IF rec.prev IS DISTINCT FROM v_raw THEN
        INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
        VALUES (rec.id, 'actual_alloc', 'input_cost_actual_alloc', rec.prev::text, v_raw::text, NULL);
      END IF;
      UPDATE public.transactions SET input_cost_actual_alloc = v_raw WHERE id = rec.id;
      v_details := v_details || jsonb_build_array(jsonb_build_object('id', rec.id, 'alloc', v_raw, 'estimate', rec.est));
    END LOOP;

    v_rem := round(v_act - v_raw_sum, 2);
    IF v_rem <> 0 AND v_largest IS NOT NULL THEN
      UPDATE public.transactions
         SET input_cost_actual_alloc = input_cost_actual_alloc + v_rem
       WHERE id = v_largest;
      INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
      SELECT id, 'actual_alloc', 'input_cost_actual_alloc',
             (input_cost_actual_alloc - v_rem)::text, input_cost_actual_alloc::text, NULL
        FROM public.transactions WHERE id = v_largest;
    END IF;
  ELSE
    INSERT INTO public.transaction_activity_log (transaction_id, action, field_name, old_value, new_value, changed_by)
    SELECT id, 'actual_alloc', 'input_cost_actual_alloc', input_cost_actual_alloc::text, NULL, NULL
      FROM public.transactions
     WHERE lab_batch_id = p_batch_id AND input_cost_actual_alloc IS NOT NULL;
    UPDATE public.transactions
       SET input_cost_actual_alloc = NULL
     WHERE lab_batch_id = p_batch_id AND input_cost_actual_alloc IS NOT NULL;
    v_act := NULL;
  END IF;

  IF b.status = 'closed_estimated' AND NOT v_has_invoice
     AND b.closed_at IS NOT NULL AND b.closed_at < now() - interval '30 days' THEN
    v_flags := v_flags || ARRAY['overdue_invoice'];
  END IF;

  v_status := CASE
    WHEN v_has_invoice AND b.status IN ('closed_estimated','closed_actual') THEN 'closed_actual'
    ELSE b.status
  END;

  INSERT INTO public.lab_batch_cost_runs (
    id, lab_batch_id, trigger, inputs_hash, status, known_count, missing_count, avg_used, method,
    estimated_total, actual_total, details, created_by
  ) VALUES (
    v_run, p_batch_id, p_trigger, v_hash,
    CASE WHEN v_still_blank AND NOT v_filled AND v_known = 0 THEN 'no_known_costs' ELSE 'applied' END,
    v_known, v_missing, v_avg, v_method, v_est, v_act, v_details, auth.uid()
  );

  UPDATE public.lab_batches SET
    revenue_total = v_revenue,
    estimated_cost_total = v_est,
    actual_cost_total = v_act,
    known_line_count = v_known,
    auto_line_count = (
      SELECT count(*) FROM public.transactions
       WHERE lab_batch_id = p_batch_id AND NOT is_deleted AND input_cost IS NULL AND input_cost_auto IS NOT NULL
    ),
    flags = v_flags,
    status = v_status,
    needs_recompute = false,
    last_run_id = v_run,
    updated_at = now()
  WHERE id = p_batch_id;

  PERFORM set_config('mml.batch_recompute', '', true);
  RETURN jsonb_build_object(
    'status', CASE WHEN v_still_blank AND NOT v_filled AND v_known = 0 THEN 'no_known_costs' ELSE 'applied' END,
    'run_id', v_run,
    'estimated_total', v_est,
    'actual_total', v_act,
    'revenue', v_revenue,
    'avg', v_avg,
    'method', v_method,
    'flags', v_flags
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_dirty_lab_batches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n int := 0;
  overdue int := 0;
BEGIN
  FOR r IN SELECT id FROM public.lab_batches WHERE needs_recompute ORDER BY created_at LOOP
    PERFORM public.recompute_lab_batch_costs(r.id, 'nightly');
    n := n + 1;
  END LOOP;
  UPDATE public.lab_batches b
     SET flags = CASE WHEN 'overdue_invoice' = ANY (b.flags) THEN b.flags ELSE b.flags || 'overdue_invoice' END,
         updated_at = now()
   WHERE b.status = 'closed_estimated'
     AND b.closed_at IS NOT NULL
     AND b.closed_at < now() - interval '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.lab_batch_invoices i
        WHERE i.lab_batch_id = b.id AND i.status = 'active'
     )
     AND NOT ('overdue_invoice' = ANY (b.flags));
  GET DIAGNOSTICS overdue = ROW_COUNT;
  RETURN jsonb_build_object('recomputed', n, 'newly_overdue', overdue);
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_batch_closer()
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]) THEN
    RAISE EXCEPTION 'Only an admin or an ops lead can close a batch or record an invoice' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_lab_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_batch_closer();
  UPDATE public.lab_batches
     SET status = CASE WHEN status = 'closed_actual' THEN status ELSE 'closed_estimated' END,
         closed_at = COALESCE(closed_at, now()),
         closed_by = COALESCE(closed_by, auth.uid()),
         updated_at = now()
   WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  RETURN public.recompute_lab_batch_costs(p_batch_id, 'close');
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_lab_batch(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_batch_closer();
  UPDATE public.lab_batches
     SET status = 'open', reopened_at = now(), reopened_by = auth.uid(), updated_at = now()
   WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  RETURN public.recompute_lab_batch_costs(p_batch_id, 'reopen');
END;
$$;

CREATE OR REPLACE FUNCTION public.record_lab_batch_invoice(
  p_batch_id uuid,
  p_vendor text,
  p_invoice_ref text,
  p_invoice_date date,
  p_currency text,
  p_amount numeric,
  p_fx numeric,
  p_source text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inr numeric;
  v_fx numeric;
  v_source text;
BEGIN
  PERFORM public._assert_batch_closer();
  IF p_currency NOT IN ('INR','USD') THEN
    RAISE EXCEPTION 'Currency must be INR or USD';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invoice amount must be zero or more';
  END IF;
  IF p_currency = 'USD' AND (p_fx IS NULL OR p_fx <= 0) THEN
    RAISE EXCEPTION 'A USD invoice needs an FX rate to INR';
  END IF;
  v_source := COALESCE(NULLIF(p_source, ''), 'vendor_invoice');
  IF v_source NOT IN ('vendor_invoice','manual_overall_cost') THEN
    RAISE EXCEPTION 'Unknown invoice source';
  END IF;
  IF p_currency = 'INR' THEN
    v_inr := round(p_amount, 2);
    v_fx := NULL;
  ELSE
    v_fx := p_fx;
    v_inr := round(p_amount * p_fx, 2);
  END IF;
  INSERT INTO public.lab_batch_invoices (
    lab_batch_id, vendor, invoice_ref, invoice_date, currency, amount, fx_rate_to_inr, amount_inr,
    is_final, source, status, note, created_by
  ) VALUES (
    p_batch_id, COALESCE(NULLIF(btrim(p_vendor), ''), 'Vendor'), NULLIF(btrim(p_invoice_ref), ''),
    COALESCE(p_invoice_date, current_date), p_currency, p_amount, v_fx, v_inr,
    true, v_source, 'active', NULLIF(btrim(p_note), ''), auth.uid()
  );
  UPDATE public.lab_batches
     SET status = 'closed_actual',
         closed_at = COALESCE(closed_at, now()),
         closed_by = COALESCE(closed_by, auth.uid()),
         updated_at = now()
   WHERE id = p_batch_id;
  RETURN public.recompute_lab_batch_costs(p_batch_id, 'invoice');
END;
$$;

CREATE OR REPLACE FUNCTION public.supersede_lab_batch_invoice(
  p_invoice_id uuid,
  p_vendor text,
  p_invoice_ref text,
  p_invoice_date date,
  p_currency text,
  p_amount numeric,
  p_fx numeric,
  p_source text,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch uuid;
  v_new uuid;
  v_result jsonb;
BEGIN
  PERFORM public._assert_batch_closer();
  SELECT lab_batch_id INTO v_batch FROM public.lab_batch_invoices WHERE id = p_invoice_id AND status = 'active';
  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'Active invoice not found';
  END IF;
  -- Retire the old invoice before the new one is summed, so the recompute sees one active total.
  UPDATE public.lab_batch_invoices SET status = 'superseded' WHERE id = p_invoice_id;
  v_result := public.record_lab_batch_invoice(v_batch, p_vendor, p_invoice_ref, p_invoice_date, p_currency, p_amount, p_fx, p_source, p_note);
  SELECT id INTO v_new
    FROM public.lab_batch_invoices
   WHERE lab_batch_id = v_batch AND status = 'active'
   ORDER BY created_at DESC
   LIMIT 1;
  UPDATE public.lab_batch_invoices SET superseded_by = v_new WHERE id = p_invoice_id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_lab_batch_recompute(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::app_role[]) THEN
    RAISE EXCEPTION 'You cannot recompute this batch' USING ERRCODE = '42501';
  END IF;
  RETURN public.recompute_lab_batch_costs(p_batch_id, 'manual');
END;
$$;

CREATE VIEW public.v_transaction_costs WITH (security_invoker = true) AS
SELECT t.id,
       COALESCE(t.input_cost_actual_alloc, t.input_cost, t.input_cost_auto) AS cost_effective,
       CASE
         WHEN t.input_cost_actual_alloc IS NOT NULL THEN 'actual'
         WHEN t.input_cost IS NOT NULL THEN 'entered'
         WHEN t.input_cost_auto IS NOT NULL THEN 'auto_avg'
         ELSE 'none'
       END AS cost_source
  FROM public.transactions t;

ALTER TABLE public.lab_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_batch_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_batch_cost_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roles read lab batches"
  ON public.lab_batches FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

CREATE POLICY "Ops insert lab batches"
  ON public.lab_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::app_role[]));

CREATE POLICY "Ops update lab batches"
  ON public.lab_batches FOR UPDATE TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[])
    OR (public.has_role(auth.uid(), 'ops_user') AND created_by = auth.uid())
  )
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[])
    OR (public.has_role(auth.uid(), 'ops_user') AND created_by = auth.uid())
  );

-- Every signed-in role can read invoices. Only admin and ops_lead can write (approved Q5).
CREATE POLICY "Roles read invoices"
  ON public.lab_batch_invoices FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

CREATE POLICY "Closers insert invoices"
  ON public.lab_batch_invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

CREATE POLICY "Closers update invoices"
  ON public.lab_batch_invoices FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[]));

CREATE POLICY "Roles read cost runs"
  ON public.lab_batch_cost_runs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::app_role[]));

REVOKE ALL ON public.lab_batches, public.lab_batch_invoices, public.lab_batch_cost_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lab_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lab_batch_invoices TO authenticated;
GRANT SELECT ON public.lab_batch_cost_runs TO authenticated;
GRANT ALL ON public.lab_batches, public.lab_batch_invoices, public.lab_batch_cost_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lab_batch_code_seq TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.lab_batch_code_seq FROM PUBLIC, anon;

REVOKE ALL ON public.v_transaction_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_transaction_costs TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assign_lab_batch_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_closed_batch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_lab_batch_dirty() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_lab_batch_costs(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_dirty_lab_batches() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._assert_batch_closer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_lab_batch_costs(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_dirty_lab_batches() TO service_role;

REVOKE ALL ON FUNCTION public.close_lab_batch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_lab_batch(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_lab_batch_invoice(uuid, text, text, date, text, numeric, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supersede_lab_batch_invoice(uuid, text, text, date, text, numeric, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_lab_batch_recompute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_lab_batch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_lab_batch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_lab_batch_invoice(uuid, text, text, date, text, numeric, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.supersede_lab_batch_invoice(uuid, text, text, date, text, numeric, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_lab_batch_recompute(uuid) TO authenticated, service_role;

SELECT cron.unschedule('mml-lab-batch-recompute') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mml-lab-batch-recompute'
);

SELECT cron.schedule(
  'mml-lab-batch-recompute',
  '40 21 * * *',
  $$select public.recompute_dirty_lab_batches();$$
);
