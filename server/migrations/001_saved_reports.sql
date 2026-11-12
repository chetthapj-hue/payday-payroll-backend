BEGIN;
ALTER TABLE public.payroll_periods ADD COLUMN IF NOT EXISTS saved_at timestamptz;
ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS employee_code_snapshot text,
  ADD COLUMN IF NOT EXISTS full_name_snapshot text;
-- Existing amounts stay untouched. Names before this migration cannot be recovered.
UPDATE public.payroll_items i SET
  employee_code_snapshot = e.employee_code,
  full_name_snapshot = e.full_name
FROM public.employees e WHERE e.id = i.employee_id
  AND (i.employee_code_snapshot IS NULL OR i.full_name_snapshot IS NULL);
UPDATE public.payroll_periods p SET saved_at = CURRENT_TIMESTAMP
WHERE saved_at IS NULL AND EXISTS
  (SELECT 1 FROM public.payroll_items i WHERE i.payroll_period_id = p.id);
ALTER TABLE public.payroll_items
  ALTER COLUMN employee_code_snapshot SET NOT NULL,
  ALTER COLUMN full_name_snapshot SET NOT NULL;
COMMIT;
