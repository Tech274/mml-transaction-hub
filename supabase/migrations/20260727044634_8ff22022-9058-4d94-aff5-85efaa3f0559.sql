CREATE TABLE public.mcp_revoked_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  revoked_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX mcp_revoked_clients_user_idx ON public.mcp_revoked_clients (user_id);

GRANT SELECT, INSERT, DELETE ON public.mcp_revoked_clients TO authenticated;
GRANT ALL ON public.mcp_revoked_clients TO service_role;

ALTER TABLE public.mcp_revoked_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mcp_revoked_select_own"
  ON public.mcp_revoked_clients FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "mcp_revoked_select_admin"
  ON public.mcp_revoked_clients FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "mcp_revoked_insert_own"
  ON public.mcp_revoked_clients FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mcp_revoked_delete_own"
  ON public.mcp_revoked_clients FOR DELETE TO authenticated
  USING (user_id = auth.uid());
