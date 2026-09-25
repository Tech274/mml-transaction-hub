ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_potential_id_key;
DROP INDEX IF EXISTS public.transactions_potential_id_key;
CREATE INDEX IF NOT EXISTS idx_tx_potential_id ON public.transactions (potential_id) WHERE NOT is_deleted;
