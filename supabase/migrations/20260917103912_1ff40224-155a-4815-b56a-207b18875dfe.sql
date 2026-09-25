CREATE TABLE public.ai_cc_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key text NOT NULL CHECK (agent_key IN ('generalist','support','cost_adr')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
  job_hint text,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id),
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.ai_cc_inbox (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid REFERENCES public.ai_cc_runs(id) ON DELETE CASCADE,
  agent_key text NOT NULL CHECK (agent_key IN ('generalist','support','cost_adr')),
  item_type text NOT NULL CHECK (item_type IN ('solution_guide','email_draft','ticket_proposal','adr_field_map')),
  title text NOT NULL,
  summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  decision_note text,
  decided_by uuid REFERENCES auth.users(id),
  decided_by_email text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_cc_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid REFERENCES auth.users(id),
  actor_email text,
  agent_key text,
  action text NOT NULL CHECK (action IN ('run','propose','confirm','reject')),
  run_id uuid REFERENCES public.ai_cc_runs(id) ON DELETE SET NULL,
  inbox_id uuid REFERENCES public.ai_cc_inbox(id) ON DELETE SET NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_cc_lab_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_code text NOT NULL,
  customer_name text NOT NULL,
  lab_name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  requisition jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_cc_inbox_status ON public.ai_cc_inbox(status, created_at DESC);
CREATE INDEX idx_ai_cc_audit_created ON public.ai_cc_audit(created_at DESC);

GRANT SELECT ON public.ai_cc_runs TO authenticated;
GRANT SELECT ON public.ai_cc_inbox TO authenticated;
GRANT SELECT ON public.ai_cc_audit TO authenticated;
GRANT SELECT ON public.ai_cc_lab_requests TO authenticated;
GRANT ALL ON public.ai_cc_runs TO service_role;
GRANT ALL ON public.ai_cc_inbox TO service_role;
GRANT ALL ON public.ai_cc_audit TO service_role;
GRANT ALL ON public.ai_cc_lab_requests TO service_role;

ALTER TABLE public.ai_cc_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cc_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cc_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_cc_lab_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roled users read ai runs" ON public.ai_cc_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
CREATE POLICY "Roled users read ai inbox" ON public.ai_cc_inbox FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
CREATE POLICY "Roled users read ai audit" ON public.ai_cc_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
CREATE POLICY "Roled users read ai lab requests" ON public.ai_cc_lab_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

INSERT INTO public.ai_cc_lab_requests (request_code, customer_name, lab_name, status, confirmed_at, requisition) VALUES
('LR-2026-014','Cognizant','Kogito BPMN Automation Lab','CONFIRMED', now() - interval '2 days',
 jsonb_build_object(
   'line_of_business','Integrated',
   'lab_type','public_cloud',
   'cloud_provider','AWS',
   'total_users',45,
   'start_date','2026-10-01',
   'end_date','2026-12-31',
   'input_cost',182500,
   'selling_cost',312000,
   'currency','INR',
   'components', jsonb_build_array('Kogito runtime (OSS)','Quarkus','Keycloak SSO','Postgres'),
   'notes','Instructor-led + self-paced blend. Requires per-learner isolated namespace.'
 )),
('LR-2026-021','Infosys','Azure Data Engineering Lab','DRAFT', NULL,
 jsonb_build_object(
   'line_of_business','VILT',
   'lab_type','public_cloud',
   'cloud_provider','Azure',
   'total_users',30,
   'start_date','2026-11-01',
   'end_date','2026-11-30',
   'input_cost',96000,
   'selling_cost',150000,
   'currency','INR',
   'components', jsonb_build_array('Azure Data Factory','Synapse','Databricks trial'),
   'notes','Awaiting commercial sign-off.'
 ));
