-- SCRUM-102 (G-25) follow-up: helpdesk agent identities are written only by the server.
-- Status: REPO ONLY, NOT APPLIED. Sandbox first; live only with Atlas go-ahead + Vivek approval.
--
-- Why: setMyAgentIdentity checks on the server that the chosen Freshdesk agent exists and that
-- its email matches the caller (SCRUM-102), but the policy "Users manage their own agent
-- identity" (FOR ALL) also let a signed-in user write any agent name/id into their own row
-- straight through the REST API, skipping that check. Found by the SCRUM-57 RLS audit
-- (docs/rls-audit.md, finding 2).
--
-- RELEASE ORDER: publish the app code from the same PR FIRST (it writes this table through the
-- service role), then apply this migration. Applied before the code, "link my agent" fails with
-- a clear error (no data is lost) until the code is published.
--
-- Effect: users keep reading their own row (admins read all, unchanged). No row is changed.
--
-- Rollback (restores the previous behaviour exactly):
--   DROP POLICY IF EXISTS "Users read their own agent identity" ON public.agent_identities;
--   CREATE POLICY "Users manage their own agent identity" ON public.agent_identities
--     FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--   GRANT INSERT, UPDATE, DELETE ON public.agent_identities TO authenticated;

DROP POLICY IF EXISTS "Users manage their own agent identity" ON public.agent_identities;
DROP POLICY IF EXISTS "Users read their own agent identity" ON public.agent_identities;
CREATE POLICY "Users read their own agent identity" ON public.agent_identities
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.agent_identities FROM authenticated, anon;
