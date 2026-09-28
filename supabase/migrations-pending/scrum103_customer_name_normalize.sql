-- SCRUM-103: align customer-name normalisation and stop 'customer not approved'.
-- approval-required: SCRUM-103. NOT APPROVED. Do not move into supabase/migrations/ until approved.
-- Status: REPO ONLY, NOT APPLIED. Waiting in supabase/migrations-pending/.
--
-- The app key is trim, collapse internal whitespace, lowercase, and treat NBSP
-- (and the other unicode spaces JavaScript counts as whitespace) as a normal space.
-- import_transactions_batch creates any missing customer itself. It does not raise
-- when the name was not passed in p_customer_names.
--
-- Safe to apply after 20260925130000_scrum103_import_batches.sql. If
-- scrum103_lenient_import.sql is also applied, either order is fine: both install
-- these same functions. This file does not change columns.
--
-- Rollback:
--   CREATE OR REPLACE FUNCTION public.set_normalized_customer()
--   RETURNS TRIGGER LANGUAGE plpgsql AS $$
--   BEGIN
--     NEW.normalized_name := lower(regexp_replace(trim(NEW.customer_name), '\s+', ' ', 'g'));
--     NEW.updated_at := now();
--     RETURN NEW;
--   END;
--   $$;
--   Re-apply import_transactions_batch from
--   supabase/migrations/20260925130000_scrum103_import_batches.sql
--   (or from scrum103_lenient_import.sql if that file was applied and this one was not).
--   DROP FUNCTION IF EXISTS public.normalize_customer_name(text);
--   DROP FUNCTION IF EXISTS public.clean_customer_name(text);

CREATE OR REPLACE FUNCTION public.clean_customer_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        translate(
          coalesce(p_name, ''),
          chr(160) || chr(5760)
            || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
            || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
            || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279),
          repeat(' ', 19)
        ),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_customer_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT lower(public.clean_customer_name(p_name));
$$;

CREATE OR REPLACE FUNCTION public.set_normalized_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.normalized_name := public.normalize_customer_name(NEW.customer_name);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 5) All-or-nothing batch, now null-safe. A bad cell becomes NULL; the row is still inserted.
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
  v_sum_sell numeric(14,2) := 0;
  v_sum_input numeric(14,2) := 0;
  v_ins_sell numeric(14,2);
  v_ins_input numeric(14,2);
  v_customer_id uuid;
  v_name text;
  v_potential text;
  v_month integer;
  v_year integer;
  v_lab text;
  v_lob text;
  v_start date;
  v_end date;
  v_users integer;
  v_input numeric(14,2);
  v_sell numeric(14,2);
  v_provider text;
  v_text text;
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

  INSERT INTO public.import_batches (kind, filename, file_sha256, template_version, row_count, total_selling, total_input, created_by)
  VALUES (p_kind, p_filename, p_file_sha256, p_template_version, v_n, 0, 0, v_uid)
  RETURNING id INTO v_batch;

  -- p_customer_names is optional. A name that is not listed is created from the row.
  FOR v_name IN SELECT jsonb_array_elements_text(coalesce(p_customer_names, '[]'::jsonb)) LOOP
    v_text := public.clean_customer_name(v_name);
    IF v_text IS NULL THEN
      CONTINUE;
    END IF;
    INSERT INTO public.customers (customer_name, created_by)
    VALUES (v_text, v_uid)
    ON CONFLICT (normalized_name) DO NOTHING;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_potential := NULLIF(btrim(r->>'potential_id'), '');
    v_lab := NULLIF(btrim(r->>'lab_name'), '');
    v_name := public.clean_customer_name(r->>'customer_name');
    v_customer_id := NULL;
    IF v_name IS NOT NULL THEN
      SELECT id, customer_name INTO v_customer_id, v_text
        FROM public.customers
       WHERE normalized_name = public.normalize_customer_name(v_name);
      IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (customer_name, created_by)
        VALUES (v_name, v_uid)
        ON CONFLICT (normalized_name) DO NOTHING;
        SELECT id, customer_name INTO v_customer_id, v_text
          FROM public.customers
         WHERE normalized_name = public.normalize_customer_name(v_name);
      END IF;
      v_name := coalesce(v_text, v_name);
    END IF;

    BEGIN
      v_text := NULLIF(btrim(r->>'month'), '');
      v_month := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::integer END;
    EXCEPTION WHEN others THEN v_month := NULL;
    END;
    IF v_month IS NOT NULL AND (v_month < 1 OR v_month > 12) THEN v_month := NULL; END IF;

    BEGIN
      v_text := NULLIF(btrim(r->>'year'), '');
      v_year := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::integer END;
    EXCEPTION WHEN others THEN v_year := NULL;
    END;
    IF v_year IS NOT NULL AND (v_year < 2000 OR v_year > 2100) THEN v_year := NULL; END IF;

    BEGIN
      v_text := NULLIF(btrim(r->>'total_users'), '');
      v_users := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::integer END;
    EXCEPTION WHEN others THEN v_users := NULL;
    END;
    IF v_users IS NOT NULL AND v_users < 1 THEN v_users := NULL; END IF;

    v_lob := NULLIF(btrim(r->>'line_of_business'), '');
    IF v_lob IS NOT NULL AND v_lob NOT IN ('VILT', 'Standalone', 'Integrated') THEN v_lob := NULL; END IF;

    BEGIN
      v_text := NULLIF(btrim(r->>'start_date'), '');
      v_start := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::date END;
      IF v_start IS NOT NULL AND to_char(v_start, 'YYYY-MM-DD') IS DISTINCT FROM v_text THEN v_start := NULL; END IF;
    EXCEPTION WHEN others THEN v_start := NULL;
    END;
    BEGIN
      v_text := NULLIF(btrim(r->>'end_date'), '');
      v_end := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::date END;
      IF v_end IS NOT NULL AND to_char(v_end, 'YYYY-MM-DD') IS DISTINCT FROM v_text THEN v_end := NULL; END IF;
    EXCEPTION WHEN others THEN v_end := NULL;
    END;

    BEGIN
      v_text := NULLIF(replace(btrim(coalesce(r->>'input_cost', '')), ',', ''), '');
      v_input := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::numeric(14,2) END;
    EXCEPTION WHEN others THEN v_input := NULL;
    END;
    IF v_input IS NOT NULL AND v_input < 0 THEN v_input := NULL; END IF;

    BEGIN
      v_text := NULLIF(replace(btrim(coalesce(r->>'selling_cost', '')), ',', ''), '');
      v_sell := CASE WHEN v_text IS NULL THEN NULL ELSE v_text::numeric(14,2) END;
    EXCEPTION WHEN others THEN v_sell := NULL;
    END;
    IF v_sell IS NOT NULL AND v_sell < 0 THEN v_sell := NULL; END IF;

    v_provider := NULLIF(btrim(r->>'cloud_provider'), '');
    IF v_provider IS NOT NULL AND v_provider NOT IN ('AWS', 'Azure', 'GCP') THEN
      v_provider := NULL;
    END IF;

    v_sum_sell := v_sum_sell + coalesce(v_sell, 0);
    v_sum_input := v_sum_input + coalesce(v_input, 0);

    INSERT INTO public.transactions (
      potential_id, month, year, customer_id, customer_name, lab_name,
      lab_type, repository_type, cloud_provider, line_of_business,
      start_date, end_date, total_users, input_cost, selling_cost,
      created_by, updated_by, import_batch_id, source_line
    ) VALUES (
      v_potential, v_month, v_year, v_customer_id, v_name, v_lab,
      'public_cloud', 'public_cloud', v_provider, v_lob,
      v_start, v_end, v_users, v_input, v_sell,
      v_uid, v_uid, v_batch, (r->>'source_line')::integer
    );
  END LOOP;

  UPDATE public.import_batches
     SET total_selling = v_sum_sell, total_input = v_sum_input
   WHERE id = v_batch;

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
