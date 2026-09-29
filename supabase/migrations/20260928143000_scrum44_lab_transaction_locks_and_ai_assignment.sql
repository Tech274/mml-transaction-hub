-- SCRUM-44: lab transaction cost locks, public-cloud margin fields, derived batch totals,
-- and AI Command Center auto-assignment primitives.
-- Status: REPO ONLY, NOT APPLIED. Do not apply to sandbox or live without Atlas and Vivek GO.
-- Release order: after 20260928120200_mml_lab_batches_and_margin.sql.
-- Notes:
-- - Additive changes only. No hosted migration apply in this PR.
-- - Existing Lovable-specific deployment flow is intentionally untouched (migration debt).
--
-- Rollback:
--   DROP TRIGGER IF EXISTS ai_cc_work_items_touch ON public.ai_cc_work_items;
--   DROP TRIGGER IF EXISTS ai_cc_work_items_release_worker_load ON public.ai_cc_work_items;
--   DROP FUNCTION IF EXISTS public.touch_ai_cc_work_items();
--   DROP FUNCTION IF EXISTS public.release_ai_cc_worker_on_terminal_status();
--   DROP FUNCTION IF EXISTS public.release_ai_cc_worker_slot(uuid);
--   DROP FUNCTION IF EXISTS public.claim_ai_cc_worker_slot(uuid);
--   DROP TABLE IF EXISTS public.ai_cc_work_items;
--   DROP TABLE IF EXISTS public.ai_cc_agent_workers;
--   DROP VIEW IF EXISTS public.v_lab_transaction_profit_breakdown;
--   DROP VIEW IF EXISTS public.v_lab_batch_transaction_totals;
--   DROP TRIGGER IF EXISTS transactions_sync_lab_batch_totals ON public.transactions;
--   DROP FUNCTION IF EXISTS public.sync_lab_batch_totals_from_transactions();
--   DROP TRIGGER IF EXISTS transactions_mark_batch_dirty ON public.transactions;
--   DROP FUNCTION IF EXISTS public.mark_lab_batch_dirty();
--   DROP FUNCTION IF EXISTS public.admin_correct_lab_transaction_costs(uuid, numeric, numeric, numeric, numeric, text);
--   DROP TRIGGER IF EXISTS transactions_guard_locked_costs ON public.transactions;
--   DROP FUNCTION IF EXISTS public.guard_transaction_locked_costs();
--   DROP TABLE IF EXISTS public.lab_transaction_cost_corrections;
--   ALTER TABLE public.transactions
--     DROP COLUMN IF EXISTS public_total_margin_actual,
--     DROP COLUMN IF EXISTS public_service_margin,
--     DROP COLUMN IF EXISTS public_unused_credit,
--     DROP COLUMN IF EXISTS public_actual_consumption,
--     DROP COLUMN IF EXISTS public_credit_allocated;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS public_credit_allocated numeric(14,2),
  ADD COLUMN IF NOT EXISTS public_actual_consumption numeric(14,2),
  ADD COLUMN IF NOT EXISTS public_unused_credit numeric(14,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN public_credit_allocated IS NULL OR public_actual_consumption IS NULL THEN NULL
        ELSE GREATEST(public_credit_allocated - public_actual_consumption, 0)
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS public_service_margin numeric(14,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN selling_cost IS NULL OR public_credit_allocated IS NULL THEN NULL
        ELSE selling_cost - public_credit_allocated
      END
    ) STORED,
  ADD COLUMN IF NOT EXISTS public_total_margin_actual numeric(14,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN selling_cost IS NULL OR public_actual_consumption IS NULL THEN NULL
        ELSE selling_cost - public_actual_consumption
      END
    ) STORED;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_public_credit_allocated_nonneg,
  ADD CONSTRAINT transactions_public_credit_allocated_nonneg CHECK (
    public_credit_allocated IS NULL OR public_credit_allocated >= 0
  ),
  DROP CONSTRAINT IF EXISTS transactions_public_actual_consumption_nonneg,
  ADD CONSTRAINT transactions_public_actual_consumption_nonneg CHECK (
    public_actual_consumption IS NULL OR public_actual_consumption >= 0
  );

CREATE TABLE IF NOT EXISTS public.lab_transaction_cost_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  old_selling_cost numeric(14,2),
  new_selling_cost numeric(14,2),
  old_input_cost numeric(14,2),
  new_input_cost numeric(14,2),
  old_credit_allocated numeric(14,2),
  new_credit_allocated numeric(14,2),
  old_actual_consumption numeric(14,2),
  new_actual_consumption numeric(14,2),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  corrected_by uuid,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lab_transaction_cost_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Finance leadership admin read transaction cost corrections"
  ON public.lab_transaction_cost_corrections FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance']::app_role[]));

REVOKE ALL ON public.lab_transaction_cost_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lab_transaction_cost_corrections TO authenticated;
GRANT ALL ON public.lab_transaction_cost_corrections TO service_role;

CREATE OR REPLACE FUNCTION public.guard_transaction_locked_costs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF current_setting('mml.admin_cost_override', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.selling_cost IS DISTINCT FROM OLD.selling_cost OR NEW.input_cost IS DISTINCT FROM OLD.input_cost THEN
    RAISE EXCEPTION
      'selling_cost and input_cost are locked after transaction creation. Use the admin correction path.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_guard_locked_costs ON public.transactions;
CREATE TRIGGER transactions_guard_locked_costs
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_locked_costs();

REVOKE ALL ON FUNCTION public.guard_transaction_locked_costs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_transaction_locked_costs() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_correct_lab_transaction_costs(
  p_transaction_id uuid,
  p_selling_cost numeric,
  p_input_cost numeric,
  p_public_credit_allocated numeric DEFAULT NULL,
  p_public_actual_consumption numeric DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.transactions%ROWTYPE;
  v_new_credit numeric(14,2);
  v_new_actual numeric(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admin can correct locked transaction costs' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 500 THEN
    RAISE EXCEPTION 'A correction reason of 10 to 500 characters is required';
  END IF;
  SELECT * INTO v_old FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  v_new_credit := COALESCE(p_public_credit_allocated, v_old.public_credit_allocated);
  v_new_actual := COALESCE(p_public_actual_consumption, v_old.public_actual_consumption);

  PERFORM set_config('mml.admin_cost_override', '1', true);
  UPDATE public.transactions
     SET selling_cost = p_selling_cost,
         input_cost = p_input_cost,
         public_credit_allocated = v_new_credit,
         public_actual_consumption = v_new_actual,
         updated_by = auth.uid(),
         updated_at = now()
   WHERE id = p_transaction_id;

  INSERT INTO public.lab_transaction_cost_corrections (
    transaction_id,
    old_selling_cost,
    new_selling_cost,
    old_input_cost,
    new_input_cost,
    old_credit_allocated,
    new_credit_allocated,
    old_actual_consumption,
    new_actual_consumption,
    reason,
    corrected_by
  ) VALUES (
    p_transaction_id,
    v_old.selling_cost,
    p_selling_cost,
    v_old.input_cost,
    p_input_cost,
    v_old.public_credit_allocated,
    v_new_credit,
    v_old.public_actual_consumption,
    v_new_actual,
    btrim(p_reason),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_lab_transaction_costs(uuid, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_lab_transaction_costs(uuid, numeric, numeric, numeric, numeric, text) TO authenticated, service_role;

-- Keep activity history aligned with the latest editable fields.
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
    'lab_batch_id','public_credit_allocated','public_actual_consumption'
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

CREATE OR REPLACE VIEW public.v_lab_transaction_profit_breakdown WITH (security_invoker = true) AS
SELECT
  t.id AS transaction_id,
  t.lab_batch_id,
  t.lab_type,
  t.selling_cost,
  t.input_cost AS input_cost_locked,
  t.public_credit_allocated,
  t.public_actual_consumption,
  t.public_unused_credit AS unused_credit,
  t.public_service_margin AS service_margin,
  t.public_total_margin_actual AS total_profit_actual,
  COALESCE(t.input_cost_actual_alloc, t.input_cost, t.input_cost_auto) AS effective_cost
FROM public.transactions t
WHERE NOT t.is_deleted;

REVOKE ALL ON public.v_lab_transaction_profit_breakdown FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_lab_transaction_profit_breakdown TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lab_batch_transaction_totals WITH (security_invoker = true) AS
SELECT
  b.id AS lab_batch_id,
  COALESCE(sum(COALESCE(t.selling_cost, 0)), 0)::numeric(14,2) AS revenue_total_derived,
  COALESCE(sum(COALESCE(t.input_cost, t.input_cost_auto, 0)), 0)::numeric(14,2) AS estimated_cost_total_derived,
  CASE
    WHEN count(*) FILTER (WHERE t.input_cost_actual_alloc IS NOT NULL) = 0 THEN NULL
    ELSE COALESCE(sum(COALESCE(t.input_cost_actual_alloc, 0)), 0)::numeric(14,2)
  END AS actual_cost_total_derived,
  COALESCE(count(*) FILTER (WHERE t.lab_type = 'public_cloud' AND t.input_cost IS NOT NULL), 0)::int AS known_line_count_derived,
  COALESCE(count(*) FILTER (WHERE t.input_cost IS NULL AND t.input_cost_auto IS NOT NULL), 0)::int AS auto_line_count_derived,
  COALESCE(count(t.id), 0)::int AS line_count_derived
FROM public.lab_batches b
LEFT JOIN public.transactions t
  ON t.lab_batch_id = b.id AND NOT t.is_deleted
GROUP BY b.id;

REVOKE ALL ON public.v_lab_batch_transaction_totals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_lab_batch_transaction_totals TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_lab_batch_totals_from_transactions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_ids uuid[] := '{}'::uuid[];
  v_batch_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_batch_ids := array_remove(array[NEW.lab_batch_id], NULL);
  ELSIF TG_OP = 'DELETE' THEN
    v_batch_ids := array_remove(array[OLD.lab_batch_id], NULL);
  ELSE
    v_batch_ids := array_remove(array[OLD.lab_batch_id, NEW.lab_batch_id], NULL);
  END IF;
  IF current_setting('mml.batch_recompute', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  FOREACH v_batch_id IN ARRAY v_batch_ids LOOP
    PERFORM set_config('mml.batch_totals_sync', '1', true);
    UPDATE public.lab_batches b
       SET revenue_total = s.revenue_total_derived,
           estimated_cost_total = s.estimated_cost_total_derived,
           actual_cost_total = s.actual_cost_total_derived,
           known_line_count = s.known_line_count_derived,
           auto_line_count = s.auto_line_count_derived,
           updated_at = now()
      FROM public.v_lab_batch_transaction_totals s
     WHERE b.id = v_batch_id
       AND s.lab_batch_id = v_batch_id;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_sync_lab_batch_totals ON public.transactions;
CREATE TRIGGER transactions_sync_lab_batch_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_lab_batch_totals_from_transactions();

REVOKE ALL ON FUNCTION public.sync_lab_batch_totals_from_transactions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_lab_batch_totals_from_transactions() TO authenticated, service_role;

-- DELETE paths are rare (soft-delete is standard), but we still mark the batch dirty
-- so recompute and totals remain correct even after hard deletes.
CREATE OR REPLACE FUNCTION public.mark_lab_batch_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
    OR NEW.public_actual_consumption IS DISTINCT FROM OLD.public_actual_consumption
    OR NEW.public_credit_allocated IS DISTINCT FROM OLD.public_credit_allocated
  ) THEN
    IF OLD.lab_batch_id IS NOT NULL THEN
      UPDATE public.lab_batches SET needs_recompute = true, updated_at = now() WHERE id = OLD.lab_batch_id;
    END IF;
    IF NEW.lab_batch_id IS NOT NULL AND NEW.lab_batch_id IS DISTINCT FROM OLD.lab_batch_id THEN
      UPDATE public.lab_batches SET needs_recompute = true, updated_at = now() WHERE id = NEW.lab_batch_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.lab_batch_id IS NOT NULL THEN
    UPDATE public.lab_batches SET needs_recompute = true, updated_at = now() WHERE id = OLD.lab_batch_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS transactions_mark_batch_dirty ON public.transactions;
CREATE TRIGGER transactions_mark_batch_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.mark_lab_batch_dirty();

CREATE TABLE IF NOT EXISTS public.ai_cc_agent_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name text NOT NULL CHECK (length(btrim(worker_name)) BETWEEN 3 AND 120),
  agent_key text NOT NULL CHECK (agent_key IN ('generalist','support','cost_adr')),
  is_active boolean NOT NULL DEFAULT true,
  current_load int NOT NULL DEFAULT 0 CHECK (current_load >= 0),
  last_assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_key, worker_name)
);

CREATE TABLE IF NOT EXISTS public.ai_cc_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 200),
  work_type text NOT NULL CHECK (
    work_type IN ('publish','deploy','live_write','task_create','task_update','analysis','other')
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued','assigned','prepared','needs_approval','approved','rejected','done','failed')
  ),
  requested_agent_key text CHECK (
    requested_agent_key IS NULL OR requested_agent_key IN ('generalist','support','cost_adr')
  ),
  assigned_agent_key text CHECK (
    assigned_agent_key IS NULL OR assigned_agent_key IN ('generalist','support','cost_adr')
  ),
  assigned_worker_id uuid REFERENCES public.ai_cc_agent_workers(id),
  requires_approval boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_by_email text,
  approved_by uuid,
  approved_at timestamptz,
  approval_note text CHECK (approval_note IS NULL OR length(approval_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_cc_work_items_status_idx
  ON public.ai_cc_work_items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_cc_work_items_agent_idx
  ON public.ai_cc_work_items (assigned_agent_key, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_cc_agent_workers_active_idx
  ON public.ai_cc_agent_workers (is_active, agent_key, current_load, last_assigned_at);

CREATE OR REPLACE FUNCTION public.claim_ai_cc_worker_slot(p_worker_id uuid)
RETURNS TABLE (
  id uuid,
  agent_key text,
  current_load int,
  last_assigned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_cc_agent_workers
     SET current_load = ai_cc_agent_workers.current_load + 1,
         last_assigned_at = now()
   WHERE ai_cc_agent_workers.id = p_worker_id
     AND ai_cc_agent_workers.is_active = true
  RETURNING
    ai_cc_agent_workers.id,
    ai_cc_agent_workers.agent_key,
    ai_cc_agent_workers.current_load,
    ai_cc_agent_workers.last_assigned_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_cc_worker_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_cc_worker_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_ai_cc_worker_slot(p_worker_id uuid)
RETURNS TABLE (
  id uuid,
  current_load int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_cc_agent_workers
     SET current_load = GREATEST(ai_cc_agent_workers.current_load - 1, 0)
   WHERE ai_cc_agent_workers.id = p_worker_id
  RETURNING ai_cc_agent_workers.id, ai_cc_agent_workers.current_load;
END;
$$;

REVOKE ALL ON FUNCTION public.release_ai_cc_worker_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_cc_worker_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.touch_ai_cc_work_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_cc_work_items_touch ON public.ai_cc_work_items;
CREATE TRIGGER ai_cc_work_items_touch
  BEFORE UPDATE ON public.ai_cc_work_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_cc_work_items();

CREATE OR REPLACE FUNCTION public.release_ai_cc_worker_on_terminal_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_terminal boolean;
  v_new_terminal boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  v_old_terminal := OLD.status IN ('done', 'rejected', 'failed');
  v_new_terminal := NEW.status IN ('done', 'rejected', 'failed');

  IF OLD.assigned_worker_id IS NOT NULL AND NOT v_old_terminal AND v_new_terminal THEN
    PERFORM public.release_ai_cc_worker_slot(OLD.assigned_worker_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_cc_work_items_release_worker_load ON public.ai_cc_work_items;
CREATE TRIGGER ai_cc_work_items_release_worker_load
  AFTER UPDATE OF status ON public.ai_cc_work_items
  FOR EACH ROW EXECUTE FUNCTION public.release_ai_cc_worker_on_terminal_status();

ALTER TABLE public.ai_cc_agent_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cc_work_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roled users read ai worker pool"
  ON public.ai_cc_agent_workers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE POLICY "Roled users read ai work items"
  ON public.ai_cc_work_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

REVOKE ALL ON public.ai_cc_agent_workers, public.ai_cc_work_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_cc_agent_workers, public.ai_cc_work_items TO authenticated;
GRANT ALL ON public.ai_cc_agent_workers, public.ai_cc_work_items TO service_role;

REVOKE ALL ON FUNCTION public.touch_ai_cc_work_items() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ai_cc_worker_on_terminal_status() FROM PUBLIC, anon, authenticated;

INSERT INTO public.ai_cc_agent_workers (worker_name, agent_key, is_active, current_load)
VALUES
  ('generalist-1', 'generalist', true, 0),
  ('support-1', 'support', true, 0),
  ('cost-adr-1', 'cost_adr', true, 0)
ON CONFLICT (agent_key, worker_name) DO NOTHING;
