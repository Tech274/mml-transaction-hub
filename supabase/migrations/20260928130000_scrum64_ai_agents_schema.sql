-- SCRUM-64: configurable AI agents, Phase 1 schema.
-- Status: REPO ONLY / NOT APPLIED. Do not apply to sandbox or live without Atlas go-ahead and Vivek's GO.
-- Release order: after 20260928120200, before the app publish that reads these tables.
-- One transaction. Additive. Does not alter ai_cc_* or the four audit-log tables.
-- No agent tool reads transaction_activity_log, customer_audit_log, role_audit_log or permission_audit_log.
--
-- Rollback:
--   DROP VIEW IF EXISTS public.ai_usage_monthly;
--   DROP TABLE IF EXISTS public.ai_agent_run_steps, public.ai_agent_runs, public.ai_agent_eval_runs,
--     public.ai_agent_evals, public.ai_agent_tools, public.ai_agent_versions, public.ai_agents,
--     public.ai_tool_catalog, public.ai_model_prices, public.ai_settings CASCADE;
--   DROP FUNCTION IF EXISTS public.ai_agents_for_me();
--   DROP FUNCTION IF EXISTS public.ai_reject_mutation();

CREATE TABLE IF NOT EXISTS public.ai_tool_catalog (
  tool_key text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  phase int NOT NULL CHECK (phase >= 1),
  returns_money boolean NOT NULL DEFAULT false,
  reads_untrusted boolean NOT NULL DEFAULT false,
  required_roles public.app_role[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.ai_model_prices (
  model_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai','anthropic','gemini','openai_compat')),
  input_per_mtok_usd numeric(12,4) NOT NULL CHECK (input_per_mtok_usd >= 0),
  output_per_mtok_usd numeric(12,4) NOT NULL CHECK (output_per_mtok_usd >= 0),
  valid_from date NOT NULL,
  source_url text,
  PRIMARY KEY (model_id, valid_from)
);

CREATE TABLE IF NOT EXISTS public.ai_settings (
  id int PRIMARY KEY CHECK (id = 1),
  agents_enabled boolean NOT NULL DEFAULT true,
  monthly_cap_usd numeric(12,2) NOT NULL DEFAULT 10 CHECK (monthly_cap_usd >= 0),
  per_run_cap_usd numeric(12,4) NOT NULL DEFAULT 0.10 CHECK (per_run_cap_usd >= 0),
  per_agent_month_cap_usd numeric(12,2) NOT NULL DEFAULT 5 CHECK (per_agent_month_cap_usd >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  engine text NOT NULL CHECK (engine IN ('rules','model')),
  is_system boolean NOT NULL DEFAULT false,
  current_version_id uuid,
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  version int NOT NULL CHECK (version > 0),
  purpose text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 8000),
  model_provider text NOT NULL DEFAULT 'none' CHECK (model_provider IN ('none','openai','anthropic','gemini','openai_compat')),
  model_id text,
  temperature numeric(3,2) NOT NULL DEFAULT 0.20 CHECK (temperature >= 0 AND temperature <= 1),
  max_output_tokens int NOT NULL DEFAULT 2000 CHECK (max_output_tokens BETWEEN 1 AND 8000),
  premium_approved boolean NOT NULL DEFAULT false,
  run_roles public.app_role[] NOT NULL DEFAULT ARRAY['admin','ops_lead']::public.app_role[],
  view_roles public.app_role[] NOT NULL DEFAULT ARRAY['admin','ops_lead']::public.app_role[],
  approve_roles public.app_role[] NOT NULL DEFAULT ARRAY['admin','ops_lead']::public.app_role[],
  triggers jsonb NOT NULL DEFAULT '{"manual":true}'::jsonb,
  output_types text[] NOT NULL DEFAULT ARRAY['report']::text[],
  limits jsonb NOT NULL DEFAULT '{"per_run_usd":0.10,"per_day_runs":200,"per_month_usd":5,"max_tool_calls":6,"max_turns":3}'::jsonb,
  eval_status text NOT NULL DEFAULT 'pending' CHECK (eval_status IN ('pending','passed','failed')),
  change_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agents_current_version_fkey'
  ) THEN
    ALTER TABLE public.ai_agents
      ADD CONSTRAINT ai_agents_current_version_fkey
      FOREIGN KEY (current_version_id) REFERENCES public.ai_agent_versions(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ai_agent_tools (
  version_id uuid NOT NULL REFERENCES public.ai_agent_versions(id) ON DELETE CASCADE,
  tool_key text NOT NULL REFERENCES public.ai_tool_catalog(tool_key),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (version_id, tool_key)
);

CREATE TABLE IF NOT EXISTS public.ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id),
  version_id uuid NOT NULL REFERENCES public.ai_agent_versions(id),
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('manual','schedule','event','test')),
  trigger_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  invoked_by uuid,
  run_as text NOT NULL DEFAULT 'user' CHECK (run_as IN ('user','service')),
  view_roles public.app_role[] NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','done','error','cancelled','budget_blocked')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_id text,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  cost_usd_est numeric(12,5) NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.ai_agent_runs(id) ON DELETE CASCADE,
  seq int NOT NULL CHECK (seq >= 0),
  kind text NOT NULL CHECK (kind IN ('model_call','tool_call','guard','output')),
  name text NOT NULL,
  input_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  cost_usd_est numeric(12,5) NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE TABLE IF NOT EXISTS public.ai_agent_evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  input jsonb NOT NULL,
  expectations jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_safety boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_agent_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.ai_agent_versions(id) ON DELETE CASCADE,
  results jsonb NOT NULL,
  pass_rate numeric(5,4) NOT NULL,
  safety_pass boolean NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_agent_started ON public.ai_agent_runs (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_invoked ON public.ai_agent_runs (invoked_by, started_at DESC);

CREATE OR REPLACE FUNCTION public.ai_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'This AI agents table is append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS ai_agent_versions_immutable ON public.ai_agent_versions;
CREATE TRIGGER ai_agent_versions_immutable
  BEFORE UPDATE OR DELETE ON public.ai_agent_versions
  FOR EACH ROW EXECUTE FUNCTION public.ai_reject_mutation();

DROP TRIGGER IF EXISTS ai_agent_tools_immutable ON public.ai_agent_tools;
CREATE TRIGGER ai_agent_tools_immutable
  BEFORE UPDATE OR DELETE ON public.ai_agent_tools
  FOR EACH ROW EXECUTE FUNCTION public.ai_reject_mutation();

DROP TRIGGER IF EXISTS ai_agent_run_steps_append ON public.ai_agent_run_steps;
CREATE TRIGGER ai_agent_run_steps_append
  BEFORE UPDATE OR DELETE ON public.ai_agent_run_steps
  FOR EACH ROW EXECUTE FUNCTION public.ai_reject_mutation();

DROP TRIGGER IF EXISTS ai_agent_eval_runs_append ON public.ai_agent_eval_runs;
CREATE TRIGGER ai_agent_eval_runs_append
  BEFORE UPDATE OR DELETE ON public.ai_agent_eval_runs
  FOR EACH ROW EXECUTE FUNCTION public.ai_reject_mutation();

CREATE OR REPLACE FUNCTION public.ai_agents_for_me()
RETURNS TABLE (id uuid, key text, name text, status text, purpose text, engine text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.key, a.name, a.status, coalesce(v.purpose, ''), a.engine
  FROM public.ai_agents a
  LEFT JOIN public.ai_agent_versions v ON v.id = a.current_version_id
  WHERE a.status = 'active'
    AND v.id IS NOT NULL
    AND public.has_any_role(auth.uid(), v.run_roles)
$$;

REVOKE ALL ON FUNCTION public.ai_reject_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_agents_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_agents_for_me() TO authenticated;

ALTER TABLE public.ai_tool_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_evals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_eval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read ai tool catalog" ON public.ai_tool_catalog;
CREATE POLICY "Admins read ai tool catalog" ON public.ai_tool_catalog
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read ai model prices" ON public.ai_model_prices;
CREATE POLICY "Admins read ai model prices" ON public.ai_model_prices
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Active roles read ai settings" ON public.ai_settings;
CREATE POLICY "Active roles read ai settings" ON public.ai_settings
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','leadership','finance','ops_lead','ops_user','viewer']::public.app_role[]));

DROP POLICY IF EXISTS "Admins read ai agents" ON public.ai_agents;
CREATE POLICY "Admins read ai agents" ON public.ai_agents
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read ai agent versions" ON public.ai_agent_versions;
CREATE POLICY "Admins read ai agent versions" ON public.ai_agent_versions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read ai agent tools" ON public.ai_agent_tools;
CREATE POLICY "Admins read ai agent tools" ON public.ai_agent_tools
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Readers see their ai agent runs" ON public.ai_agent_runs;
CREATE POLICY "Readers see their ai agent runs" ON public.ai_agent_runs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      trigger_kind <> 'test'
      AND public.has_any_role(auth.uid(), view_roles)
    )
  );

DROP POLICY IF EXISTS "Admins read ai agent steps" ON public.ai_agent_run_steps;
CREATE POLICY "Admins read ai agent steps" ON public.ai_agent_run_steps
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read ai agent evals" ON public.ai_agent_evals;
CREATE POLICY "Admins read ai agent evals" ON public.ai_agent_evals
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read ai agent eval runs" ON public.ai_agent_eval_runs;
CREATE POLICY "Admins read ai agent eval runs" ON public.ai_agent_eval_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Authenticated writes are revoked. Restrictive policies are FOR UPDATE / FOR DELETE only, never FOR ALL.
DROP POLICY IF EXISTS "No client update of ai agent runs" ON public.ai_agent_runs;
CREATE POLICY "No client update of ai agent runs" ON public.ai_agent_runs
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
DROP POLICY IF EXISTS "No client delete of ai agent runs" ON public.ai_agent_runs;
CREATE POLICY "No client delete of ai agent runs" ON public.ai_agent_runs
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

CREATE OR REPLACE VIEW public.ai_usage_monthly
WITH (security_invoker = true) AS
SELECT
  date_trunc('month', r.started_at)::date AS month,
  a.key AS agent_key,
  coalesce(r.model_id, '') AS model_id,
  count(*)::int AS runs,
  count(*) FILTER (WHERE r.status = 'error')::int AS errors,
  count(*) FILTER (WHERE r.status = 'budget_blocked')::int AS budget_blocked,
  coalesce(sum(r.tokens_in), 0)::bigint AS tokens_in,
  coalesce(sum(r.tokens_out), 0)::bigint AS tokens_out,
  coalesce(sum(r.cost_usd_est), 0)::numeric(12,5) AS cost_usd_est
FROM public.ai_agent_runs r
JOIN public.ai_agents a ON a.id = r.agent_id
GROUP BY 1, 2, 3;

REVOKE ALL ON public.ai_tool_catalog, public.ai_model_prices, public.ai_settings, public.ai_agents,
  public.ai_agent_versions, public.ai_agent_tools, public.ai_agent_runs, public.ai_agent_run_steps,
  public.ai_agent_evals, public.ai_agent_eval_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_tool_catalog, public.ai_model_prices, public.ai_settings, public.ai_agents,
  public.ai_agent_versions, public.ai_agent_tools, public.ai_agent_runs, public.ai_agent_run_steps,
  public.ai_agent_evals, public.ai_agent_eval_runs
  TO authenticated;
GRANT ALL ON public.ai_tool_catalog, public.ai_model_prices, public.ai_settings, public.ai_agents,
  public.ai_agent_versions, public.ai_agent_tools, public.ai_agent_runs, public.ai_agent_run_steps,
  public.ai_agent_evals, public.ai_agent_eval_runs
  TO service_role;

REVOKE ALL ON public.ai_usage_monthly FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_usage_monthly TO service_role;

INSERT INTO public.ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ai_tool_catalog (tool_key, title, description, phase, returns_money, reads_untrusted, required_roles, enabled)
VALUES
  ('tickets.search', 'Search tickets', 'Helpdesk ticket metadata. Subject lines are untrusted.', 1, false, true,
    ARRAY['admin','ops_lead','ops_user']::public.app_role[], true),
  ('tickets.get', 'Get ticket', 'One ticket''s metadata. The subject is untrusted.', 1, false, true,
    ARRAY['admin','ops_lead','ops_user']::public.app_role[], true),
  ('tickets.conversation', 'Ticket conversation', 'Live Freshdesk conversation, trimmed and redacted. Untrusted text.', 1, false, true,
    ARRAY['admin','ops_lead','ops_user']::public.app_role[], true),
  ('customers.get', 'Get customer', 'Customer name, account manager, industry and active flag. No contact details.', 1, false, false,
    ARRAY['admin','leadership','finance','ops_lead','ops_user']::public.app_role[], true),
  ('reports.summary', 'Reports summary', 'Dashboard aggregates. Money fields are masked unless the role may see them.', 1, true, false,
    ARRAY['admin','leadership','finance','ops_lead','ops_user']::public.app_role[], true),
  ('transactions.query', 'Query transactions', 'Transaction lines, at most 200 rows. Money fields are masked by role.', 1, true, true,
    ARRAY['admin','leadership','finance','ops_lead','ops_user']::public.app_role[], true),
  ('sync.health', 'Sync health', 'Latest sync run status. No ticket text.', 1, false, false,
    ARRAY['admin','leadership','finance','ops_lead','ops_user']::public.app_role[], true)
ON CONFLICT (tool_key) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  phase = EXCLUDED.phase,
  returns_money = EXCLUDED.returns_money,
  reads_untrusted = EXCLUDED.reads_untrusted,
  required_roles = EXCLUDED.required_roles,
  enabled = EXCLUDED.enabled;

INSERT INTO public.ai_model_prices (model_id, provider, input_per_mtok_usd, output_per_mtok_usd, valid_from, source_url)
VALUES
  ('gemini-3.8-flash', 'gemini', 0.75, 3.75, '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing'),
  ('gemini-3.1-flash-lite', 'gemini', 0.25, 1.50, '2026-01-01', 'https://ai.google.dev/gemini-api/docs/pricing'),
  ('gpt-6-luna', 'openai', 0.10, 0.50, '2026-01-01', 'https://developers.openai.com/api/docs/pricing'),
  ('gpt-6-sol', 'openai', 2.00, 10.00, '2026-01-01', 'https://developers.openai.com/api/docs/pricing'),
  ('claude-haiku-4-5', 'anthropic', 1.00, 5.00, '2026-01-01', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('claude-sonnet-5', 'anthropic', 2.00, 10.00, '2026-01-01', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('compat-default', 'openai_compat', 0.15, 0.60, '2026-01-01', NULL)
ON CONFLICT (model_id, valid_from) DO NOTHING;
