-- SCRUM-57 (G-02, G-13): RLS audit follow-up. Defence in depth, no behaviour change.
-- Status: REPO ONLY, NOT APPLIED. Apply to sandbox first, then live with Atlas go-ahead + Vivek approval.
--
-- Supabase's default privileges give `authenticated` INSERT/UPDATE/DELETE on every new table.
-- On the tables below no RLS policy allows that command, so today the database already refuses
-- those writes (0 rows affected). This removes the unused privileges, so a policy added by
-- mistake later cannot silently open them. Verified by src/lib/__tests__/rls-policies.test.ts
-- ("authenticated holds no write privilege that no policy uses").
--
-- Nothing is dropped or deleted. Service role (server code) is unaffected.
--
-- Rollback (restores the previous grants exactly):
--   GRANT INSERT, UPDATE, DELETE ON public.ai_cc_runs, public.ai_cc_inbox, public.ai_cc_audit, public.ai_cc_lab_requests TO authenticated;
--   GRANT UPDATE, DELETE ON public.bulk_import_audit_events, public.bulk_import_row_audit, public.bulk_import_jobs,
--         public.mcp_tool_audit_log, public.ticket_action_log TO authenticated;
--   GRANT DELETE ON public.bulk_import_runs, public.customers, public.transactions TO authenticated;
--   GRANT UPDATE ON public.mcp_revoked_clients TO authenticated;
--   GRANT TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.fuzzy_search_transactions(text, real, integer) TO PUBLIC, anon;

-- AI Command Center tables: users read; all writes go through the server (service role).
REVOKE INSERT, UPDATE, DELETE ON public.ai_cc_runs, public.ai_cc_inbox, public.ai_cc_audit, public.ai_cc_lab_requests FROM authenticated;

-- Append-only logs and job records: insert (own rows, per policy) and read, never edit or delete.
REVOKE UPDATE, DELETE ON public.bulk_import_audit_events, public.bulk_import_row_audit, public.bulk_import_jobs,
  public.mcp_tool_audit_log, public.ticket_action_log FROM authenticated;

-- No delete policy exists: transactions are soft-deleted (is_deleted), customers deactivated,
-- import runs are evidence.
REVOKE DELETE ON public.bulk_import_runs, public.customers, public.transactions FROM authenticated;

-- Revocations are added or removed, never edited.
REVOKE UPDATE ON public.mcp_revoked_clients FROM authenticated;

-- Nobody signed in needs to create triggers on, or foreign keys to, our tables.
REVOKE TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated, anon;

-- The fuzzy transaction search is for signed-in users only (it runs with the caller's RLS).
REVOKE EXECUTE ON FUNCTION public.fuzzy_search_transactions(text, real, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuzzy_search_transactions(text, real, integer) TO authenticated, service_role;
