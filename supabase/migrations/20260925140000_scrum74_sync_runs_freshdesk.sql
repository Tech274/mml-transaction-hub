-- SCRUM-74 (G-07) / SCRUM-72: record every Freshdesk sync run in public.sync_runs.
-- Status: REPO ONLY, NOT APPLIED. Sandbox first; live only with Atlas go-ahead + Vivek approval.
-- Additive only: two nullable columns and one index. No data is changed.
-- The app code works before this is applied: it writes the base columns and logs
-- (does not hide) the missing-column error for the counts.
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS fetched_count integer;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS upserted_count integer;
CREATE INDEX IF NOT EXISTS idx_sync_runs_kind_started ON public.sync_runs (kind, started_at DESC);
COMMENT ON COLUMN public.sync_runs.fetched_count IS 'Freshdesk runs: tickets fetched from Freshdesk (Cloud Labs group, after the cut-off).';
COMMENT ON COLUMN public.sync_runs.upserted_count IS 'Freshdesk runs: rows written to freshdesk_tickets.';
