-- SCRUM-64: ai_cc_* reads require an active account, and viewers cannot read Inbox money.
-- Status: REPO ONLY / NOT APPLIED. Apply after 20260930010200, one transaction, then publish the app.
-- Release order: this file before the Phase 1 app publish. Old app code keeps working: the three
-- agent keys are seeded, new columns have defaults, and writes still use the service role.
-- Does not change policies on transaction_activity_log, customer_audit_log, role_audit_log or
-- permission_audit_log.
--
-- approved-destructive: SCRUM-64 phase-1-scope (widen CHECK constraints and replace read policies; no rows deleted).
-- Flag: SCRUM-64 is the migration-discipline ticket. There is no dedicated AI-agents Jira id yet.
--
-- Rollback:
--   -- First, handle rows that use new action values before restoring the old CHECK:
--   -- these values were introduced in this migration and would violate
--   -- action IN ('run','propose','confirm','reject').
--   UPDATE public.ai_cc_audit SET action = 'run'
--   WHERE action IN ('kill_switch','test_run','eval_run','budget_block');
--   UPDATE public.ai_cc_audit SET action = 'propose'
--   WHERE action IN ('config_create','config_version','activate','pause','resume','archive','rollback');
--   DELETE FROM public.ai_cc_audit
--   WHERE action NOT IN ('run','propose','confirm','reject');
--
--   -- Remove new FKs/CHECKs and restore previous checks.
--   ALTER TABLE public.ai_cc_runs DROP CONSTRAINT IF EXISTS ai_cc_runs_agent_key_fkey;
--   ALTER TABLE public.ai_cc_inbox DROP CONSTRAINT IF EXISTS ai_cc_inbox_agent_key_fkey;
--   ALTER TABLE public.ai_cc_runs DROP CONSTRAINT IF EXISTS ai_cc_runs_agent_key_check;
--   ALTER TABLE public.ai_cc_runs ADD CONSTRAINT ai_cc_runs_agent_key_check CHECK (agent_key IN ('generalist','support','cost_adr'));
--   ALTER TABLE public.ai_cc_inbox DROP CONSTRAINT IF EXISTS ai_cc_inbox_agent_key_check;
--   ALTER TABLE public.ai_cc_inbox ADD CONSTRAINT ai_cc_inbox_agent_key_check CHECK (agent_key IN ('generalist','support','cost_adr'));
--   ALTER TABLE public.ai_cc_inbox DROP CONSTRAINT IF EXISTS ai_cc_inbox_item_type_check;
--   ALTER TABLE public.ai_cc_inbox ADD CONSTRAINT ai_cc_inbox_item_type_check CHECK (item_type IN ('solution_guide','email_draft','ticket_proposal','adr_field_map'));
--   ALTER TABLE public.ai_cc_audit DROP CONSTRAINT IF EXISTS ai_cc_audit_action_check;
--   ALTER TABLE public.ai_cc_audit ADD CONSTRAINT ai_cc_audit_action_check CHECK (action IN ('run','propose','confirm','reject'));
--   DROP POLICY IF EXISTS "Active roles read ai runs" ON public.ai_cc_runs;
--   DROP POLICY IF EXISTS "Active roles read ai inbox" ON public.ai_cc_inbox;
--   DROP POLICY IF EXISTS "Active roles read ai audit" ON public.ai_cc_audit;
--   DROP POLICY IF EXISTS "Active roles read ai lab requests" ON public.ai_cc_lab_requests;
--   CREATE POLICY "Roled users read ai runs" ON public.ai_cc_runs FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
--   CREATE POLICY "Roled users read ai inbox" ON public.ai_cc_inbox FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
--   CREATE POLICY "Roled users read ai audit" ON public.ai_cc_audit FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
--   CREATE POLICY "Roled users read ai lab requests" ON public.ai_cc_lab_requests FOR SELECT TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
--   New columns may stay; they are nullable or defaulted.

ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS contains_money boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS agent_run_id uuid;
ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS agent_version_id uuid;
ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS view_roles public.app_role[];
ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS approve_roles public.app_role[];
ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE public.ai_cc_inbox ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
ALTER TABLE public.ai_cc_audit ADD COLUMN IF NOT EXISTS agent_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_cc_inbox_agent_run_id_fkey') THEN
    ALTER TABLE public.ai_cc_inbox
      ADD CONSTRAINT ai_cc_inbox_agent_run_id_fkey
      FOREIGN KEY (agent_run_id) REFERENCES public.ai_agent_runs(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_cc_inbox_agent_version_id_fkey') THEN
    ALTER TABLE public.ai_cc_inbox
      ADD CONSTRAINT ai_cc_inbox_agent_version_id_fkey
      FOREIGN KEY (agent_version_id) REFERENCES public.ai_agent_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.ai_cc_inbox
SET contains_money = true
WHERE item_type IN ('adr_field_map', 'solution_guide')
   OR payload::text ~* '(input_cost|selling_cost|margin_pct|"revenue"|"profit"|INR )';

UPDATE public.ai_cc_inbox
SET view_roles = CASE
  WHEN contains_money THEN ARRAY['admin','ops_lead','ops_user','leadership','finance']::public.app_role[]
  ELSE ARRAY['admin','ops_lead','ops_user','leadership','finance','viewer']::public.app_role[]
END
WHERE view_roles IS NULL;

-- Widen CHECKs, then point agent_key at ai_agents. The three legacy keys are already seeded.
ALTER TABLE public.ai_cc_runs DROP CONSTRAINT IF EXISTS ai_cc_runs_agent_key_check;
ALTER TABLE public.ai_cc_runs DROP CONSTRAINT IF EXISTS ai_cc_runs_agent_key_fkey;
ALTER TABLE public.ai_cc_runs
  ADD CONSTRAINT ai_cc_runs_agent_key_fkey FOREIGN KEY (agent_key) REFERENCES public.ai_agents(key);

ALTER TABLE public.ai_cc_inbox DROP CONSTRAINT IF EXISTS ai_cc_inbox_agent_key_check;
ALTER TABLE public.ai_cc_inbox DROP CONSTRAINT IF EXISTS ai_cc_inbox_agent_key_fkey;
ALTER TABLE public.ai_cc_inbox
  ADD CONSTRAINT ai_cc_inbox_agent_key_fkey FOREIGN KEY (agent_key) REFERENCES public.ai_agents(key);

ALTER TABLE public.ai_cc_inbox DROP CONSTRAINT IF EXISTS ai_cc_inbox_item_type_check;
ALTER TABLE public.ai_cc_inbox
  ADD CONSTRAINT ai_cc_inbox_item_type_check
  CHECK (item_type IN (
    'solution_guide','email_draft','ticket_proposal','adr_field_map',
    'triage_note','report','margin_alert','qa_answer'
  ));

ALTER TABLE public.ai_cc_audit DROP CONSTRAINT IF EXISTS ai_cc_audit_action_check;
ALTER TABLE public.ai_cc_audit
  ADD CONSTRAINT ai_cc_audit_action_check
  CHECK (action IN (
    'run','propose','confirm','reject',
    'config_create','config_version','activate','pause','resume','archive','rollback',
    'kill_switch','test_run','eval_run','budget_block'
  ));

-- Active account: has_any_role / has_role already require profiles.is_active (20260928090500).
DROP POLICY IF EXISTS "Roled users read ai runs" ON public.ai_cc_runs;
DROP POLICY IF EXISTS "Active roles read ai runs" ON public.ai_cc_runs;
CREATE POLICY "Active roles read ai runs" ON public.ai_cc_runs
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::public.app_role[]));

DROP POLICY IF EXISTS "Roled users read ai inbox" ON public.ai_cc_inbox;
DROP POLICY IF EXISTS "Active roles read ai inbox" ON public.ai_cc_inbox;
CREATE POLICY "Active roles read ai inbox" ON public.ai_cc_inbox
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::public.app_role[])
    AND (view_roles IS NULL OR public.has_any_role(auth.uid(), view_roles))
    AND (
      contains_money IS NOT TRUE
      OR NOT public.has_role(auth.uid(), 'viewer')
      OR public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance']::public.app_role[])
    )
  );

DROP POLICY IF EXISTS "Roled users read ai audit" ON public.ai_cc_audit;
DROP POLICY IF EXISTS "Active roles read ai audit" ON public.ai_cc_audit;
CREATE POLICY "Active roles read ai audit" ON public.ai_cc_audit
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::public.app_role[]));

DROP POLICY IF EXISTS "Roled users read ai lab requests" ON public.ai_cc_lab_requests;
DROP POLICY IF EXISTS "Active roles read ai lab requests" ON public.ai_cc_lab_requests;
CREATE POLICY "Active roles read ai lab requests" ON public.ai_cc_lab_requests
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::public.app_role[]));
