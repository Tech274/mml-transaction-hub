-- SCRUM-77: MCP audit rows are written by the server only.
-- Status: REPO ONLY, NOT APPLIED. Sandbox first; live only with Atlas go-ahead + Vivek approval.
--
-- Why: every MCP tool call is logged to mcp_tool_audit_log. The rows used to be inserted with the
-- caller's own token (policy "mcp_audit_insert_own"), so a signed-in user could also add made-up
-- audit rows about themselves straight through the REST API. The app now writes the row with the
-- service role (user_id taken from the verified token), so users no longer need INSERT.
--
-- RELEASE ORDER: publish the app code from the same PR FIRST, then apply this migration.
-- Applied before the code, tool calls still work but their audit rows fail to save (logged on
-- the server with a ref) until the code is published.
--
-- Effect: users keep reading their own rows, admins read all; updates and deletes stay blocked.
-- No row is changed.
--
-- Rollback (restores the previous behaviour exactly):
--   CREATE POLICY "mcp_audit_insert_own" ON public.mcp_tool_audit_log
--     FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
--   GRANT INSERT ON public.mcp_tool_audit_log TO authenticated;

DROP POLICY IF EXISTS "mcp_audit_insert_own" ON public.mcp_tool_audit_log;
REVOKE INSERT ON public.mcp_tool_audit_log FROM authenticated, anon;
