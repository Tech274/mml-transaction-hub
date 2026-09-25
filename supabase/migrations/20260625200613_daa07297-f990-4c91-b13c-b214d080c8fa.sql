
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('kpi','feature')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role, key)
);

GRANT SELECT ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view role permissions"
  ON public.role_permissions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage role permissions"
  ON public.role_permissions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_role_permissions_updated
  BEFORE UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.role_permissions (role, key, kind, enabled)
SELECT 'admin'::public.app_role, k.key, k.kind, true
FROM (VALUES
  ('kpi_total_transactions','kpi'),('kpi_public_cloud','kpi'),('kpi_private_cloud','kpi'),
  ('kpi_total_users','kpi'),('kpi_total_revenue','kpi'),('kpi_total_input_cost','kpi'),
  ('kpi_total_profit','kpi'),('kpi_margin','kpi'),('kpi_avg_cost','kpi'),
  ('kpi_current_month_revenue','kpi'),('kpi_current_month_profit','kpi'),('kpi_current_month_users','kpi'),
  ('chart_tx_by_month','kpi'),('chart_revenue_by_month','kpi'),('chart_pub_priv','kpi'),
  ('chart_provider','kpi'),('chart_top_revenue','kpi'),('chart_top_users','kpi'),
  ('chart_top_profit','kpi'),('chart_lob','kpi'),
  ('feature_excel_export','feature'),('feature_customer_edit','feature'),
  ('feature_master_adr_entry','feature'),('feature_reports_access','feature')
) AS k(key, kind)
ON CONFLICT (role, key) DO NOTHING;
