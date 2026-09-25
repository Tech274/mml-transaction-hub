-- SCRUM-92 (G-08): mark Freshdesk tickets the nightly full pass no longer sees.
-- Tickets moved out of the synced group, deleted in Freshdesk, or now older than
-- FRESHDESK_TICKETS_FROM used to stay in freshdesk_tickets forever with their old
-- status. The full pass now stamps them with stale_since instead.
--
-- Additive only: one nullable column and one partial index. Nothing is deleted or
-- rewritten; existing rows get NULL (= not stale).
--
-- Release order: apply this migration first, then set FRESHDESK_STALE_SWEEP_ENABLED=true.
-- With the flag unset the app never reads or writes this column, so deploying the
-- code before the migration is safe.
--
-- Not applied by Atlas. Needs the normal sandbox -> live approval.

ALTER TABLE public.freshdesk_tickets
  ADD COLUMN IF NOT EXISTS stale_since timestamptz;

COMMENT ON COLUMN public.freshdesk_tickets.stale_since IS
  'SCRUM-92: set when a complete full Freshdesk pass no longer returned this ticket (moved out of the group, deleted, or out of the date range). NULL = seen in the latest full pass. Cleared automatically if the ticket comes back.';

CREATE INDEX IF NOT EXISTS idx_freshdesk_tickets_stale
  ON public.freshdesk_tickets (stale_since)
  WHERE stale_since IS NOT NULL;
