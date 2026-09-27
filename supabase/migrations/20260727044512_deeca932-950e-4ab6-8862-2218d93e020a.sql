CREATE TABLE public.mcp_tool_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  client_id text,
  tool_name text NOT NULL,
  arguments jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL,
  error_code text,
  error_message text,
  duration_ms integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX mcp_tool_audit_log_user_created_idx ON public.mcp_tool_audit_log (user_id, created_at DESC);
CREATE INDEX mcp_tool_audit_log_tool_created_idx ON public.mcp_tool_audit_log (tool_name, created_at DESC);
CREATE INDEX mcp_tool_audit_log_client_created_idx ON public.mcp_tool_audit_log (client_id, created_at DESC);

GRANT SELECT, INSERT ON public.mcp_tool_audit_log TO authenticated;
GRANT ALL ON public.mcp_tool_audit_log TO service_role;

ALTER TABLE public.mcp_tool_audit_log ENABLE ROW LEVEL SECURITY;

-- Users can see their own MCP invocations
CREATE POLICY "mcp_audit_select_own"
  ON public.mcp_tool_audit_log
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can see all MCP invocations
CREATE POLICY "mcp_audit_select_admin"
  ON public.mcp_tool_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Only the signed-in user can insert their own rows
CREATE POLICY "mcp_audit_insert_own"
  ON public.mcp_tool_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Block updates/deletes at the policy layer
CREATE POLICY "mcp_audit_no_update"
  ON public.mcp_tool_audit_log
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "mcp_audit_no_delete"
  ON public.mcp_tool_audit_log
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);
