-- SCRUM-103 checks for import_transactions_batch(). SANDBOX ONLY, never live.
-- Run after BOTH 20260925130000_scrum103_import_batches.sql AND
-- supabase/migrations-pending/scrum103_lenient_import.sql (moved into migrations first).
-- Everything is inside a transaction that is rolled back. Synthetic values only.
BEGIN;

DO $$
DECLARE
  u uuid;
  res jsonb;
  before_count bigint;
  after_count bigint;
  rows_ok jsonb := '[
    {"source_line":2,"potential_id":"PID-SYN-1","month":3,"year":2026,"customer_name":"Synthetic Test Customer","lab_name":"Lab A","line_of_business":"VILT","start_date":"2026-03-01","end_date":"2026-03-31","total_users":5,"input_cost":"100.00","selling_cost":"250.00","cloud_provider":"AWS"},
    {"source_line":3,"potential_id":"PID-SYN-1","month":3,"year":2026,"customer_name":"Synthetic Test Customer","lab_name":"Lab A","line_of_business":"VILT","start_date":"2026-03-01","end_date":"2026-03-31","total_users":5,"input_cost":"100.00","selling_cost":"250.00","cloud_provider":"AWS"}
  ]';
BEGIN
  SELECT user_id INTO u FROM public.user_roles WHERE role IN ('admin','ops_lead','ops_user') LIMIT 1;
  IF u IS NULL THEN RAISE NOTICE 'SKIP: no ops user in sandbox'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO before_count FROM public.transactions;

  -- 1) Repeated Potential ID lines -> 2 transactions (no merge)
  res := public.import_transactions_batch('public_cloud', 'synthetic.xlsx', repeat('a', 64), '2.0.0-proposed', rows_ok, '["Synthetic Test Customer"]');
  IF (res->>'inserted')::int <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 inserted, got %', res; END IF;
  RAISE NOTICE 'PASS: 2 lines with the same Potential ID -> 2 transactions (%)', res;

  -- 2) Same file hash again -> rejected, nothing written
  BEGIN
    PERFORM public.import_transactions_batch('public_cloud', 'synthetic.xlsx', repeat('a', 64), '2.0.0-proposed', rows_ok, '[]');
    RAISE EXCEPTION 'FAIL: same file committed twice';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: same file hash rejected';
  END;

  -- 3) Unknown provider is stored NULL and the row is still inserted (28 Sep). Blank cost stays NULL, not 0.
  res := public.import_transactions_batch(
    'public_cloud', 'synthetic-2.xlsx', repeat('b', 64), '2.0.0-proposed',
    jsonb_build_array(
      jsonb_build_object(
        'source_line', 2,
        'potential_id', 'PID-SYN-1',
        'month', 3, 'year', 2026,
        'customer_name', 'Synthetic Test Customer',
        'lab_name', 'Lab A',
        'line_of_business', 'VILT',
        'start_date', '2026-03-01', 'end_date', '2026-03-31',
        'total_users', 5,
        'input_cost', '400.00', 'selling_cost', '100.00',
        'cloud_provider', 'OpenAI'
      ),
      jsonb_build_object(
        'source_line', 3,
        'potential_id', NULL,
        'customer_name', NULL,
        'lab_name', 'Only lab',
        'input_cost', NULL, 'selling_cost', NULL,
        'cloud_provider', NULL
      )
    ),
    '[]'
  );
  IF (res->>'inserted')::int <> 2 THEN RAISE EXCEPTION 'FAIL: lenient batch expected 2 inserted, got %', res; END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    JOIN public.import_batches b ON b.id = t.import_batch_id
    WHERE b.file_sha256 = repeat('b', 64)
      AND t.source_line = 2
      AND (t.cloud_provider IS NOT NULL OR t.input_cost <> 400 OR t.selling_cost <> 100)
  ) THEN
    RAISE EXCEPTION 'FAIL: OpenAI row was not stored with a null provider and the original costs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    JOIN public.import_batches b ON b.id = t.import_batch_id
    WHERE b.file_sha256 = repeat('b', 64)
      AND t.source_line = 3
      AND (t.input_cost IS NOT NULL OR t.selling_cost IS NOT NULL OR t.potential_id IS NOT NULL OR t.customer_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'FAIL: blank cells were not stored as NULL';
  END IF;
  RAISE NOTICE 'PASS: unknown provider and blank costs imported as NULL without blocking';

  SELECT count(*) INTO after_count FROM public.transactions;
  IF after_count <> before_count + 4 THEN RAISE EXCEPTION 'FAIL: expected exactly 4 new rows, got %', after_count - before_count; END IF;
  RAISE NOTICE 'PASS: exactly 4 rows added overall';
END $$;

ROLLBACK;
