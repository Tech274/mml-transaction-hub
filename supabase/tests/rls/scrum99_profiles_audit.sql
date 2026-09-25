-- SCRUM-99 / SCRUM-57 access-rule checks. SANDBOX ONLY, never live.
-- Run in the sandbox SQL editor AFTER applying 20260925121000_scrum99_profile_guard_audit_writes.sql.
-- Everything runs inside a transaction that is rolled back. Uses synthetic ids only.
-- Expected: every check prints PASS; any FAIL raises an exception.
BEGIN;

-- Pick any non-admin user in the sandbox (synthetic seed data).
DO $$
DECLARE
  u uuid;
BEGIN
  SELECT p.id INTO u FROM public.profiles p
   WHERE NOT public.has_role(p.id, 'admin'::app_role) LIMIT 1;
  IF u IS NULL THEN RAISE NOTICE 'SKIP: no non-admin profile in sandbox'; RETURN; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- full_name change allowed
  UPDATE public.profiles SET full_name = 'Synthetic Name' WHERE id = u;
  RAISE NOTICE 'PASS: user can change own full_name';

  -- is_active change blocked
  BEGIN
    UPDATE public.profiles SET is_active = NOT is_active WHERE id = u;
    RAISE EXCEPTION 'FAIL: user changed own is_active';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: is_active change blocked';
  END;

  -- email change blocked
  BEGIN
    UPDATE public.profiles SET email = 'someone.else@example.test' WHERE id = u;
    RAISE EXCEPTION 'FAIL: user changed own email';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: email change blocked';
  END;

  -- direct audit insert blocked
  BEGIN
    INSERT INTO public.customer_audit_log DEFAULT VALUES;
    RAISE EXCEPTION 'FAIL: user inserted a customer audit row';
  EXCEPTION WHEN insufficient_privilege OR not_null_violation THEN
    RAISE NOTICE 'PASS: direct customer audit insert blocked (%)', SQLSTATE;
  END;

  RESET ROLE;
END $$;

-- anon has no table privileges at all
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r'
     AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
       OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'));
  IF n > 0 THEN RAISE EXCEPTION 'FAIL: anon still has privileges on % tables', n; END IF;
  RAISE NOTICE 'PASS: anon has no table privileges';
END $$;

ROLLBACK;
