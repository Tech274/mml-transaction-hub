DROP POLICY IF EXISTS "No client writes to tickets" ON public.freshdesk_tickets;

CREATE POLICY "No client ticket inserts" ON public.freshdesk_tickets AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "No client ticket updates" ON public.freshdesk_tickets AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY "No client ticket deletes" ON public.freshdesk_tickets AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.freshdesk_tickets FROM authenticated, anon;
GRANT SELECT ON public.freshdesk_tickets TO authenticated;
GRANT ALL ON public.freshdesk_tickets TO service_role;
