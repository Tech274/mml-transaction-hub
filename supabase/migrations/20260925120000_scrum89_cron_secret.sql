-- SCRUM-89 (G-03): dedicated shared secret for pg_cron -> /api/public/hooks/*.
-- Status: REPO ONLY, NOT APPLIED. Apply only with Atlas go-ahead and Vivek's approval,
-- in the order given in docs/runbooks/scrum-89-cron-secret.md (migration -> cron headers -> code).
-- Additive: creates one Vault secret (generated inside the database, never typed,
-- logged or committed) and one verifier function callable only by service_role.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret for pg_cron -> /api/public/hooks/* (SCRUM-89)'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.verify_cron_secret(_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT _token IS NOT NULL
     AND length(_token) >= 32
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'cron_secret' AND decrypted_secret = _token
     );
$$;

REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;
