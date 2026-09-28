-- SCRUM-103: lenient import — blanks allowed, no strict rules.
-- approved-destructive: SCRUM-103 Vivek C (owner), GO 28 Sep 2026 06:35 IST; Atlas engineering go-ahead 28 Sep 2026 after re-review of PR #39 (d9d84f0).
-- Status: APPLIED TO LIVE 28 Sep 2026 by Atlas for Vivek, right after 20260925130000_scrum103_import_batches.
-- Moved from supabase/migrations-pending/ per its README; recorded as version 20260928031000.
--
-- Apply order (live):
--   1. 20260925130000_scrum103_import_batches.sql (held; creates import_batches and
--      import_transactions_batch). This file refuses to run if that table is missing.
--   2. This file.
--   3. Publish the app. New code sends NULL for blank cells and the All Transactions
--      filter reads is_complete, so this file must already be applied. Old app code
--      still writes complete rows and keeps working on this schema (old code + new
--      schema). New code + old schema rejects blanks and the completeness filter errors.
--
-- What changes:
--   * User-facing transaction columns accept NULL. Blank stays blank (no DEFAULT 0).
--   * CHECK (cost >= 0) remains, and only applies when a value is present.
--   * Any CHECK that compares input_cost to selling_cost is dropped (none on live today).
--   * CHECK (end_date >= start_date) is dropped so a reversed pair does not abort the row.
--   * classify_transaction no longer raises on an unknown cloud provider.
--     A private-cloud row with a blank cloud_provider is stored as
--     'MakeMyLabs Private Cloud'. A non-blank provider is kept.
--   * import_batches.file_sha256 is no longer unique. A non-unique index remains
--     so a repeated file can be found. The app warns and asks for Import anyway.
--   * import_transactions_batch stores NULL for a cell it cannot cast, and still inserts
--     one transaction per input row (repeated Potential IDs included).
--   * is_complete is a stored generated column: true only when every business field
--     has a value (0 counts; NULL and blank text do not). Public rows require
--     cloud_provider; private rows require system_config. Adding it rewrites
--     public.transactions once.
--
-- Rollback:
--   Restore the previous function bodies (quoted below), then set NOT NULL only on
--   columns that have no nulls. Do not backfill 0. If any imported row is still blank,
--   SET NOT NULL will fail until those cells are filled by editing.
--
--   CREATE OR REPLACE FUNCTION public.classify_transaction()
--   RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
--   BEGIN
--     IF NEW.lab_type = 'private_cloud' THEN
--       NEW.repository_type := 'private_cloud';
--       NEW.cloud_provider := 'MakeMyLabs Private Cloud';
--     ELSIF NEW.lab_type = 'public_cloud' THEN
--       NEW.repository_type := 'public_cloud';
--       IF NEW.cloud_provider NOT IN ('AWS','Azure','GCP') THEN
--         RAISE EXCEPTION 'Public Cloud transactions require cloud_provider in (AWS, Azure, GCP)';
--       END IF;
--     ELSE
--       RAISE EXCEPTION 'Invalid lab_type: %', NEW.lab_type;
--     END IF;
--     NEW.updated_at := now();
--     RETURN NEW;
--   END;
--   $$;
--
--   Re-apply the import_transactions_batch body from
--   supabase/migrations/20260925130000_scrum103_import_batches.sql.
--
--   ALTER TABLE public.transactions
--     ADD CONSTRAINT transactions_end_date_after_start CHECK (end_date >= start_date);
--   -- Then, only when the column has no nulls (do not write 0):
--   -- ALTER TABLE public.transactions ALTER COLUMN input_cost SET DEFAULT 0;
--   -- ALTER TABLE public.transactions ALTER COLUMN input_cost SET NOT NULL;
--   -- and the same SET NOT NULL for potential_id, month, year, customer_id,
--   -- customer_name, lab_name, cloud_provider, line_of_business, start_date,
--   -- end_date, total_users, selling_cost.
--
--   DROP INDEX IF EXISTS public.transactions_is_complete_live_idx;
--   ALTER TABLE public.transactions DROP COLUMN IF EXISTS is_complete;
--
--   DROP INDEX IF EXISTS public.import_batches_file_sha256_idx;
--   ALTER TABLE public.import_batches
--     ADD CONSTRAINT import_batches_file_sha256_key UNIQUE (file_sha256);
--   -- The ADD fails if the same hash was imported more than once. Remove the
--   -- extra batches first, or leave the non-unique index in place.

-- Held SCRUM-103 migration must already be applied (import_batches exists).
DO $$
BEGIN
  IF to_regclass('public.import_batches') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260925130000_scrum103_import_batches before scrum103_lenient_import';
  END IF;
END $$;

-- 1) Blank cells are NULL. Drop defaults that would turn a missing cost into 0.
ALTER TABLE public.transactions ALTER COLUMN input_cost DROP DEFAULT;

ALTER TABLE public.transactions
  ALTER COLUMN potential_id DROP NOT NULL,
  ALTER COLUMN month DROP NOT NULL,
  ALTER COLUMN year DROP NOT NULL,
  ALTER COLUMN customer_id DROP NOT NULL,
  ALTER COLUMN customer_name DROP NOT NULL,
  ALTER COLUMN lab_name DROP NOT NULL,
  ALTER COLUMN cloud_provider DROP NOT NULL,
  ALTER COLUMN line_of_business DROP NOT NULL,
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN end_date DROP NOT NULL,
  ALTER COLUMN total_users DROP NOT NULL,
  ALTER COLUMN selling_cost DROP NOT NULL,
  ALTER COLUMN input_cost DROP NOT NULL;

-- 2) Non-negative only when a value is present. CHECK is satisfied by NULL.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_selling_cost_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_selling_cost_check CHECK (selling_cost IS NULL OR selling_cost >= 0);

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_input_cost_nonneg;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_input_cost_nonneg CHECK (input_cost IS NULL OR input_cost >= 0) NOT VALID;

-- Drop a margin comparison if one was added by hand. None is in the repo migrations.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass AND contype = 'c'
  LOOP
    IF r.def ILIKE '%input_cost%' AND r.def ILIKE '%selling_cost%'
       AND r.conname NOT IN ('transactions_selling_cost_check', 'transactions_input_cost_nonneg') THEN
      EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', r.conname);
    END IF;
    -- Table-level end_date >= start_date (unnamed constraint from the original CREATE TABLE).
    IF r.def ILIKE '%end_date%' AND r.def ILIKE '%start_date%' AND r.def NOT ILIKE '%input_cost%' THEN
      EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', r.conname);
    END IF;
  END LOOP;
END $$;

-- 3) Unknown or blank providers must not abort the insert.
CREATE OR REPLACE FUNCTION public.classify_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.lab_type = 'private_cloud' THEN
    NEW.repository_type := 'private_cloud';
    -- Reports and the provider filter expect this name when the cell was blank.
    -- A non-blank provider is kept. is_complete for private rows still uses system_config.
    IF NEW.cloud_provider IS NULL OR btrim(NEW.cloud_provider) = '' THEN
      NEW.cloud_provider := 'MakeMyLabs Private Cloud';
    END IF;
  ELSIF NEW.lab_type = 'public_cloud' THEN
    NEW.repository_type := 'public_cloud';
  ELSE
    RAISE EXCEPTION 'Invalid lab_type: %', NEW.lab_type;
  END IF;
  -- A public provider outside AWS/Azure/GCP is kept as given when a caller sends
  -- it; the importer itself stores NULL and warns instead.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 4) All-or-nothing batch, now null-safe. A bad cell becomes NULL; the row is still inserted.
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

  FOR v_name IN SELECT jsonb_array_elements_text(coalesce(p_customer_names, '[]'::jsonb)) LOOP
    IF v_name IS NULL OR btrim(v_name) = '' THEN
      CONTINUE;
    END IF;
    INSERT INTO public.customers (customer_name, created_by)
    VALUES (v_name, v_uid)
    ON CONFLICT (normalized_name) DO NOTHING;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_potential := NULLIF(btrim(r->>'potential_id'), '');
    v_lab := NULLIF(btrim(r->>'lab_name'), '');
    v_name := NULLIF(btrim(r->>'customer_name'), '');
    v_customer_id := NULL;
    IF v_name IS NOT NULL THEN
      SELECT id INTO v_customer_id
        FROM public.customers
       WHERE normalized_name = lower(regexp_replace(v_name, '\s+', ' ', 'g'));
      IF v_customer_id IS NULL THEN
        RAISE EXCEPTION 'Line %: customer "%" was not approved in the preview', r->>'source_line', v_name;
      END IF;
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

-- 5) Completeness for the All Transactions filter. Same field list as
--    TRANSACTION_COMPLETENESS_FIELDS / TRANSACTION_KIND_COMPLETENESS_FIELD
--    in src/lib/transaction-completeness.ts. A 0 cost is a value. NULL and
--    blank or whitespace text are empty. System columns are not included.
ALTER TABLE public.transactions
  ADD COLUMN is_complete boolean
  GENERATED ALWAYS AS (
    nullif(btrim(potential_id), '') IS NOT NULL
    AND month IS NOT NULL
    AND year IS NOT NULL
    AND nullif(btrim(customer_name), '') IS NOT NULL
    AND nullif(btrim(lab_name), '') IS NOT NULL
    AND nullif(btrim(line_of_business), '') IS NOT NULL
    AND start_date IS NOT NULL
    AND end_date IS NOT NULL
    AND total_users IS NOT NULL
    AND input_cost IS NOT NULL
    AND selling_cost IS NOT NULL
    AND CASE
      WHEN lab_type = 'private_cloud' THEN nullif(btrim(system_config), '') IS NOT NULL
      ELSE nullif(btrim(cloud_provider), '') IS NOT NULL
    END
  ) STORED;

CREATE INDEX transactions_is_complete_live_idx
  ON public.transactions (is_complete, created_at DESC)
  WHERE is_deleted = false;

-- 6) The same file may be imported again after the user confirms Import anyway.
--    Drop the unique constraint created by 20260925130000 (column UNIQUE) and
--    keep a non-unique index for the "already imported" lookup.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.import_batches'::regclass
      AND c.contype = 'u'
      AND a.attname = 'file_sha256'
  LOOP
    EXECUTE format('ALTER TABLE public.import_batches DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS import_batches_file_sha256_idx
  ON public.import_batches (file_sha256);
