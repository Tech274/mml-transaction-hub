
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tx_potential_trgm ON public.transactions USING gin (potential_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tx_customer_trgm  ON public.transactions USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tx_lab_trgm       ON public.transactions USING gin (lab_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tx_provider_trgm  ON public.transactions USING gin (cloud_provider gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tx_lob_trgm       ON public.transactions USING gin (line_of_business gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.fuzzy_search_transactions(q text, threshold real DEFAULT 0.25, max_rows int DEFAULT 500)
RETURNS TABLE (id uuid, score real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH tokens AS (
    SELECT lower(trim(t)) AS tok
    FROM regexp_split_to_table(coalesce(q, ''), '\s+') AS t
    WHERE length(trim(t)) > 0
  ),
  scored AS (
    SELECT
      tr.id,
      GREATEST(
        similarity(lower(coalesce(tr.potential_id,'')),    lower(q)),
        similarity(lower(coalesce(tr.customer_name,'')),   lower(q)),
        similarity(lower(coalesce(tr.lab_name,'')),        lower(q)),
        similarity(lower(coalesce(tr.cloud_provider,'')),  lower(q)),
        similarity(lower(coalesce(tr.line_of_business,'')),lower(q))
      ) AS sim,
      (
        SELECT bool_and(
          lower(coalesce(tr.potential_id,''))    ILIKE '%'||tok||'%' OR
          lower(coalesce(tr.customer_name,''))   ILIKE '%'||tok||'%' OR
          lower(coalesce(tr.lab_name,''))        ILIKE '%'||tok||'%' OR
          lower(coalesce(tr.cloud_provider,''))  ILIKE '%'||tok||'%' OR
          lower(coalesce(tr.line_of_business,''))ILIKE '%'||tok||'%'
        )
        FROM tokens
      ) AS substr_match
    FROM public.transactions tr
    WHERE tr.is_deleted = false
  )
  SELECT id,
         (CASE WHEN substr_match THEN 1.0 ELSE 0.0 END + sim)::real AS score
  FROM scored
  WHERE substr_match = true OR sim >= threshold
  ORDER BY score DESC, id
  LIMIT max_rows;
$$;

GRANT EXECUTE ON FUNCTION public.fuzzy_search_transactions(text, real, int) TO authenticated, service_role;
