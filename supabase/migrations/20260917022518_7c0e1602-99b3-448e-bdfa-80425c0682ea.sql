CREATE TABLE public.agent_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  agent_id bigint,
  auto_matched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_identities TO authenticated;
GRANT ALL ON public.agent_identities TO service_role;
ALTER TABLE public.agent_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own agent identity"
  ON public.agent_identities FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all agent identities"
  ON public.agent_identities FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_agent_identities_updated_at
  BEFORE UPDATE ON public.agent_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ticket_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id bigint NOT NULL,
  action text NOT NULL,
  field_name text,
  old_value text,
  new_value text,
  resolution_note text,
  actor_id uuid,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_action_log_ticket ON public.ticket_action_log (ticket_id, created_at DESC);

GRANT SELECT, INSERT ON public.ticket_action_log TO authenticated;
GRANT ALL ON public.ticket_action_log TO service_role;
ALTER TABLE public.ticket_action_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roled users can read ticket actions"
  ON public.ticket_action_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE POLICY "Users log their own ticket actions"
  ON public.ticket_action_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_id);

CREATE POLICY "No updates to ticket action log"
  ON public.ticket_action_log AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false);

CREATE POLICY "No deletes from ticket action log"
  ON public.ticket_action_log AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);
