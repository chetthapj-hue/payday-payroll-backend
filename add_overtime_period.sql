BEGIN;

ALTER TABLE public.payroll_periods
    ADD COLUMN IF NOT EXISTS overtime_start_date date,
    ADD COLUMN IF NOT EXISTS overtime_end_date date,
    ADD COLUMN IF NOT EXISTS payment_date date;

UPDATE public.payroll_periods
SET
    period_name = 'งวดจ่าย 25 พฤศจิกายน 2569',
    start_date = DATE '2026-10-17',
    end_date = DATE '2026-11-16',
    overtime_start_date = DATE '2026-10-01',
    overtime_end_date = DATE '2026-10-31',
    payment_date = DATE '2026-11-25'
WHERE id = 1
RETURNING
    id,
    period_name,
    start_date,
    end_date,
    overtime_start_date,
    overtime_end_date,
    payment_date;

COMMIT;