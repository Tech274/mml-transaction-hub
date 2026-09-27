CREATE TABLE public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'snapshot',
  trigger_source text NOT NULL DEFAULT 'cron',
  status text NOT NULL DEFAULT 'running',
  customers_count integer NOT NULL DEFAULT 0,
  transactions_count integer NOT NULL DEFAULT 0,
  report_rows integer NOT NULL DEFAULT 0,
  error_message text,
  triggered_by uuid,
  triggered_by_email text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.report_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.sync_runs(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT (now()::date),
  year integer NOT NULL,
  month integer NOT NULL,
  customer_name text NOT NULL,
  lab_name text NOT NULL,
  cloud_provider text NOT NULL,
  line_of_business text NOT NULL,
  transactions_count integer NOT NULL DEFAULT 0,
  total_users integer NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0,
  profit numeric NOT NULL DEFAULT 0,
  margin_pct numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_runs_started ON public.sync_runs (started_at DESC);
CREATE INDEX idx_report_snapshots_run ON public.report_snapshots (run_id);
CREATE INDEX idx_report_snapshots_period ON public.report_snapshots (year, month);

GRANT SELECT ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;
GRANT SELECT ON public.report_snapshots TO authenticated;
GRANT ALL ON public.report_snapshots TO service_role;

ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roled users can view sync runs" ON public.sync_runs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE POLICY "Roled users can view report snapshots" ON public.report_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()));

CREATE POLICY "No direct writes to sync runs" ON public.sync_runs
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (true) WITH CHECK (false);

CREATE POLICY "No direct writes to report snapshots" ON public.report_snapshots
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (true) WITH CHECK (false);

CREATE TRIGGER trg_sync_runs_updated_at BEFORE UPDATE ON public.sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
