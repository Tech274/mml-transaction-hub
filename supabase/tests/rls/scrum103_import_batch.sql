-- SCRUM-103 checks for import_transactions_batch(). SANDBOX ONLY, never live.
-- Run in the sandbox SQL editor after applying 20260925130000_scrum103_import_batches.sql.
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

  -- 3) Injected failure on the second row (bad provider) -> whole batch rolled back
  BEGIN
    PERFORM public.import_transactions_batch('public_cloud', 'synthetic-2.xlsx', repeat('b', 64), '2.0.0-proposed',
      jsonb_set(rows_ok, '{1,cloud_provider}', '"OpenAI"'), '[]');
    RAISE EXCEPTION 'FAIL: bad row accepted';
  EXCEPTION WHEN raise_exception THEN
    IF EXISTS (SELECT 1 FROM public.import_batches WHERE file_sha256 = repeat('b', 64)) THEN
      RAISE EXCEPTION 'FAIL: partial batch left behind';
    END IF;
    RAISE NOTICE 'PASS: failure on row 2 rolled back the whole batch';
  END;

  SELECT count(*) INTO after_count FROM public.transactions;
  IF after_count <> before_count + 2 THEN RAISE EXCEPTION 'FAIL: expected exactly 2 new rows, got %', after_count - before_count; END IF;
  RAISE NOTICE 'PASS: exactly 2 rows added overall';
END $$;

ROLLBACK;
