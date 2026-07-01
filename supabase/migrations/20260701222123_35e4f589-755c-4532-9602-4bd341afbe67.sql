-- Enforce that line_of_business is one of VILT, Standalone, Integrated at the
-- database layer so ANY insert path (bulk import, API, admin script) is rejected
-- when the value falls outside the allowed set.

-- 1) Normalize any existing rows so the constraint can be added without a rewrite.
--    Common historical variants are folded into the closest allowed value; anything
--    unrecognized is left as-is (the constraint below will surface it as invalid).
UPDATE public.transactions
   SET line_of_business = CASE lower(trim(line_of_business))
     WHEN 'vilt'        THEN 'VILT'
     WHEN 'standalone'  THEN 'Standalone'
     WHEN 'integrated'  THEN 'Integrated'
     ELSE line_of_business
   END
 WHERE line_of_business IS NOT NULL
   AND line_of_business <> CASE lower(trim(line_of_business))
     WHEN 'vilt'        THEN 'VILT'
     WHEN 'standalone'  THEN 'Standalone'
     WHEN 'integrated'  THEN 'Integrated'
     ELSE line_of_business
   END;

-- 2) Drop any previous check with the same name (idempotent) and add the enforcement.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_line_of_business_check;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_line_of_business_check
  CHECK (line_of_business IN ('VILT', 'Standalone', 'Integrated'));
