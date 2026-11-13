BEGIN;
ALTER TABLE public.work_logs ADD COLUMN IF NOT EXISTS wage_multiplier smallint NOT NULL DEFAULT 1
 CHECK (wage_multiplier IN (1,2) AND (wage_multiplier=1 OR EXTRACT(ISODOW FROM work_date) IN (6,7)));
-- NULL means the original report did not capture this information. Never backfill from live logs.
ALTER TABLE public.payroll_items
 ADD COLUMN IF NOT EXISTS recorded_days integer CHECK (recorded_days>=0),
 ADD COLUMN IF NOT EXISTS overtime_15_minutes integer CHECK (overtime_15_minutes>=0),
 ADD COLUMN IF NOT EXISTS overtime_3_minutes integer CHECK (overtime_3_minutes>=0),
 ADD COLUMN IF NOT EXISTS overtime_total_minutes integer CHECK (overtime_total_minutes>=0),
 ADD COLUMN IF NOT EXISTS overtime_total_pay numeric(14,2) CHECK (overtime_total_pay>=0);
COMMIT;
