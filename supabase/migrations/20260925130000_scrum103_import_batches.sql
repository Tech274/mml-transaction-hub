-- SCRUM-103 / SCRUM-79 (G-10): strict import — batch table, batch link on transactions,
-- and one all-or-nothing database function for the commit.
-- Status: REPO ONLY, NOT APPLIED. Sandbox first; live only with Atlas go-ahead + Vivek approval.
-- Additive only: new table, two new nullable columns, a partial unique index, a NOT VALID check,
-- and a new function. Existing rows and existing importer behaviour are unchanged.
-- Business rules (headers, blank cost, OpenAI, input>selling, blank PID, customer variants,
-- re-upload) are PROPOSED DEFAULTS pending Vivek's confirmation; see src/lib/strict-import/template.ts.

-- 1) Batches: one row per committed file. The same file (SHA-256) can never be committed twice.
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('public_cloud', 'private_cloud')),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  file_sha256 text NOT NULL UNIQUE CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  template_version text NOT NULL,
  row_count integer NOT NULL CHECK (row_count > 0),
  total_selling numeric(14,2) NOT NULL,
  total_input numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;

DROP POLICY IF EXISTS "Ops and leadership read import batches" ON public.import_batches;
CREATE POLICY "Ops and leadership read import batches" ON public.import_batches
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user','leadership']::public.app_role[]));
-- No INSERT/UPDATE/DELETE policies: batches are written only by import_transactions_batch().

-- 2) Link each imported transaction to its batch and source line (one row in = one row out).
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source_line integer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_import_batch_line
  ON public.transactions (import_batch_id, source_line)
  WHERE import_batch_id IS NOT NULL;

-- 3) input_cost may never be negative. NOT VALID: enforced for new/updated rows now;
--    existing rows are checked later with VALIDATE CONSTRAINT after a read-only data check.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_input_cost_nonneg') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_input_cost_nonneg CHECK (input_cost >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_source_line_positive') THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_source_line_positive CHECK (source_line IS NULL OR source_line > 0) NOT VALID;
  END IF;
END $$;

-- 4) All-or-nothing commit. Any error aborts the whole call (nothing is written).
CREATE OR REPLACE FUNCTION public.import_transactions_batch(
  p_kind text,
  p_filename text,
  p_file_sha256 text,
  p_template_version text,
  p_rows jsonb,
  p_customer_names jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_batch uuid;
  v_n integer;
  v_inserted integer;
  v_sum_sell numeric(14,2);
  v_sum_input numeric(14,2);
  v_ins_sell numeric(14,2);
  v_ins_input numeric(14,2);
  v_customer_id uuid;
  v_name text;
  r jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['admin','ops_lead','ops_user']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not allowed to import transactions' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS DISTINCT FROM 'public_cloud' THEN
    RAISE EXCEPTION 'Only the public_cloud strict template is supported';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'No rows to import';
  END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n > 5000 THEN
    RAISE EXCEPTION 'Too many rows in one file (% > 5000)', v_n;
  END IF;

  SELECT coalesce(sum((e->>'selling_cost')::numeric(14,2)), 0),
         coalesce(sum((e->>'input_cost')::numeric(14,2)), 0)
    INTO v_sum_sell, v_sum_input
    FROM jsonb_array_elements(p_rows) AS e;

  -- A repeated file hash raises unique_violation here and aborts everything.
  INSERT INTO public.import_batches (kind, filename, file_sha256, template_version, row_count, total_selling, total_input, created_by)
  VALUES (p_kind, p_filename, p_file_sha256, p_template_version, v_n, v_sum_sell, v_sum_input, v_uid)
  RETURNING id INTO v_batch;

  -- Customers approved in the preview. Names are stored exactly as approved; an existing
  -- customer with the same normalized name is reused, never renamed.
  FOR v_name IN SELECT jsonb_array_elements_text(coalesce(p_customer_names, '[]'::jsonb)) LOOP
    INSERT INTO public.customers (customer_name, created_by)
    VALUES (v_name, v_uid)
    ON CONFLICT (normalized_name) DO NOTHING;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_customer_id := NULL;
    SELECT id INTO v_customer_id
      FROM public.customers
     WHERE normalized_name = lower(regexp_replace(trim(r->>'customer_name'), '\s+', ' ', 'g'));
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'Line %: customer "%" was not approved in the preview', r->>'source_line', r->>'customer_name';
    END IF;

    INSERT INTO public.transactions (
      potential_id, month, year, customer_id, customer_name, lab_name,
      lab_type, repository_type, cloud_provider, line_of_business,
      start_date, end_date, total_users, input_cost, selling_cost,
      created_by, updated_by, import_batch_id, source_line
    ) VALUES (
      r->>'potential_id', (r->>'month')::integer, (r->>'year')::integer, v_customer_id, r->>'customer_name', r->>'lab_name',
      'public_cloud', 'public_cloud', r->>'cloud_provider', r->>'line_of_business',
      (r->>'start_date')::date, (r->>'end_date')::date, (r->>'total_users')::integer,
      (r->>'input_cost')::numeric(14,2), (r->>'selling_cost')::numeric(14,2),
      v_uid, v_uid, v_batch, (r->>'source_line')::integer
    );
  END LOOP;

  -- Reconcile before committing: rows in = rows out, and both sums match exactly.
  SELECT count(*), coalesce(sum(selling_cost), 0), coalesce(sum(input_cost), 0)
    INTO v_inserted, v_ins_sell, v_ins_input
    FROM public.transactions
   WHERE import_batch_id = v_batch;
  IF v_inserted <> v_n OR v_ins_sell <> v_sum_sell OR v_ins_input <> v_sum_input THEN
    RAISE EXCEPTION 'Reconciliation failed: expected % rows / % / %, got % / % / %',
      v_n, v_sum_sell, v_sum_input, v_inserted, v_ins_sell, v_ins_input;
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch,
    'inserted', v_inserted,
    'total_selling', v_ins_sell,
    'total_input', v_ins_input
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_transactions_batch(text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_transactions_batch(text, text, text, text, jsonb, jsonb) TO authenticated;
