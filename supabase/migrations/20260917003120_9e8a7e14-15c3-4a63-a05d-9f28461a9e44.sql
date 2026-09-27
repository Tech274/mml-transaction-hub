CREATE TABLE public.freshdesk_tickets (
  id bigint PRIMARY KEY,
  subject text,
  description_text text,
  status_id integer,
  status text,
  priority_id integer,
  priority text,
  type text,
  source text,
  requester_name text,
  requester_email text,
  company_name text,
  agent_name text,
  group_name text,
  tags text[] NOT NULL DEFAULT '{}',
  due_by timestamptz,
  fr_due_by timestamptz,
  is_escalated boolean NOT NULL DEFAULT false,
  satisfaction_rating text,
  ticket_created_at timestamptz,
  ticket_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_freshdesk_tickets_created ON public.freshdesk_tickets (ticket_created_at DESC);
CREATE INDEX idx_freshdesk_tickets_status ON public.freshdesk_tickets (status);

GRANT SELECT ON public.freshdesk_tickets TO authenticated;
GRANT ALL ON public.freshdesk_tickets TO service_role;

ALTER TABLE public.freshdesk_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roled users can view tickets"
ON public.freshdesk_tickets FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE POLICY "No client writes to tickets"
ON public.freshdesk_tickets
AS RESTRICTIVE FOR ALL TO authenticated, anon
USING (false) WITH CHECK (false);
