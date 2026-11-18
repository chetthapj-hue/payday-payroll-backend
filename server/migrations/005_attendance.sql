BEGIN;
-- Existing work rows retain their meaning and amounts. Policy starts disabled.
ALTER TABLE public.employees
 ADD COLUMN IF NOT EXISTS employment_start_date date,
 ADD COLUMN IF NOT EXISTS employment_end_date date,
 ADD COLUMN IF NOT EXISTS auto_shift_type text CHECK (auto_shift_type IN ('day','night'));
ALTER TABLE public.work_logs
 ADD COLUMN IF NOT EXISTS attendance_status text NOT NULL DEFAULT 'work' CHECK (attendance_status IN ('work','sick','personal')),
 ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','leave')),
 ADD COLUMN IF NOT EXISTS leave_paid boolean,
 ADD COLUMN IF NOT EXISTS leave_wage_fraction numeric CHECK (leave_wage_fraction BETWEEN 0 AND 1),
 ADD COLUMN IF NOT EXISTS leave_monthly_deduction_fraction numeric CHECK (leave_monthly_deduction_fraction BETWEEN 0 AND 1),
 ADD COLUMN IF NOT EXISTS leave_restore jsonb;
ALTER TABLE public.payroll_items
 ADD COLUMN IF NOT EXISTS sick_days integer CHECK (sick_days>=0),
 ADD COLUMN IF NOT EXISTS personal_days integer CHECK (personal_days>=0);
CREATE TABLE IF NOT EXISTS public.attendance_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 auto_enabled boolean NOT NULL DEFAULT false,
 start_date date,
 leave_policy jsonb,
 employee_can_choose_paid_leave boolean NOT NULL DEFAULT true,
 holiday_mode text CHECK (holiday_mode IN ('skip','work')),
 holiday_reviewed_through date
);
-- Confirmed policy: paid/unpaid selectable by employees; no meal on either leave type.
INSERT INTO public.attendance_settings(id,leave_policy) VALUES(true,
 '{"sick":{"daily_wage_fraction":0,"monthly_deduction_divisor":30,"meal_allowance":0},"personal":{"daily_wage_fraction":0,"monthly_deduction_divisor":30,"meal_allowance":0}}'::jsonb)
 ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.attendance_holidays (
 holiday_date date PRIMARY KEY, label text NOT NULL
);
-- No FK to mutable/deletable rows: preserve the audit after leave cancellation.
CREATE TABLE IF NOT EXISTS public.attendance_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 work_log_id integer, employee_id integer NOT NULL,
 actor_account_id integer, actor_role text NOT NULL CHECK(actor_role IN ('admin','employee','job')),
 action text NOT NULL, changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 before_value jsonb, after_value jsonb
);
CREATE INDEX IF NOT EXISTS attendance_audit_employee_idx ON public.attendance_audit(employee_id,changed_at);
CREATE TABLE IF NOT EXISTS public.attendance_job_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 ran_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 through_date date NOT NULL, outcome text NOT NULL, inserted integer NOT NULL DEFAULT 0,
 missing_employee_setup integer NOT NULL DEFAULT 0
);
COMMIT;
