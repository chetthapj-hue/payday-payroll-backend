BEGIN;
-- Replace only the multiplier CHECK, never tables, rows or historical money.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint
 WHERE conrelid='public.work_logs'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%wage_multiplier%'
 LOOP EXECUTE format('ALTER TABLE public.work_logs DROP CONSTRAINT %I',c.conname); END LOOP;
 ALTER TABLE public.work_logs ADD CONSTRAINT work_logs_wage_multiplier_check CHECK(wage_multiplier IN (1,2,3));
END $$;
ALTER TABLE public.work_logs
 ADD COLUMN IF NOT EXISTS overtime_1x_minutes integer NOT NULL DEFAULT 0 CHECK(overtime_1x_minutes>=0),
 ADD COLUMN IF NOT EXISTS overtime_2x_minutes integer NOT NULL DEFAULT 0 CHECK(overtime_2x_minutes>=0);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.work_logs'::regclass AND conname='work_logs_ot_components_check') THEN
  ALTER TABLE public.work_logs ADD CONSTRAINT work_logs_ot_components_check
   CHECK(overtime_1x_minutes+overtime_2x_minutes+overtime_3x_minutes<=overtime_minutes);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.check_work_log_premium_day() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.wage_multiplier>1 AND EXTRACT(ISODOW FROM NEW.work_date) NOT IN (6,7)
 AND NOT EXISTS(SELECT 1 FROM public.attendance_holidays WHERE holiday_date=NEW.work_date) THEN
  RAISE EXCEPTION 'Premium wage requires a weekend or company holiday' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.work_logs'::regclass AND tgname='work_logs_premium_day') THEN
  CREATE TRIGGER work_logs_premium_day BEFORE INSERT OR UPDATE OF wage_multiplier,work_date ON public.work_logs
   FOR EACH ROW EXECUTE FUNCTION public.check_work_log_premium_day();
 END IF;
END $$;
-- NULL remains unknown for old reports. New saves capture all components explicitly.
ALTER TABLE public.payroll_items
 ADD COLUMN IF NOT EXISTS overtime_1_minutes integer CHECK(overtime_1_minutes>=0),
 ADD COLUMN IF NOT EXISTS overtime_2_minutes integer CHECK(overtime_2_minutes>=0),
 ADD COLUMN IF NOT EXISTS overtime_1_pay numeric(14,2) CHECK(overtime_1_pay>=0),
 ADD COLUMN IF NOT EXISTS overtime_2_pay numeric(14,2) CHECK(overtime_2_pay>=0);
COMMIT;
