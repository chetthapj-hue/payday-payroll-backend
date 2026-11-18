import { attendanceTransaction, audit, leavePolicy, validDate } from './attendance.js';
import { bangkokToday } from './work-logs.js';

export async function runAttendanceJob(pool,{now=new Date()}={}) {
 const today=bangkokToday(now);
 return attendanceTransaction(pool,async db=>{
  const s=(await db.query('SELECT *,start_date::text,holiday_reviewed_through::text FROM public.attendance_settings WHERE id=true FOR SHARE')).rows[0];
  const finish=async(outcome,inserted=0,missing=0)=>{
   const result={through_date:today,outcome,inserted,missing_employee_setup:missing};
   await db.query(`INSERT INTO public.attendance_job_runs(through_date,outcome,inserted,missing_employee_setup) VALUES($1,$2,$3,$4)`,Object.values(result));
   return result;
  };
  if(!s?.auto_enabled || process.env.PAYDAY_AUTO_ATTENDANCE!=='true') return finish('disabled');
  if(!validDate(s.start_date)||!['skip'].includes(s.holiday_mode)||!validDate(s.holiday_reviewed_through)||s.holiday_reviewed_through<today)
   throw new Error('ATTENDANCE_POLICY_PENDING');
  leavePolicy(s,'sick');leavePolicy(s,'personal');
  const missing=Number((await db.query(`SELECT count(*) AS n FROM public.employees WHERE is_active AND
   (employment_start_date IS NULL OR auto_shift_type IS NULL)`)).rows[0].n);
  const inserted=(await db.query(`WITH eligible AS MATERIALIZED (
   SELECT * FROM public.employees WHERE is_active AND employment_start_date IS NOT NULL AND auto_shift_type IS NOT NULL FOR SHARE
  ) INSERT INTO public.work_logs(employee_id,work_date,regular_minutes,overtime_minutes,
   overtime_3x_minutes,shift_type,meal_allowance,wage_multiplier,source)
   SELECT e.id,d.day::date,480,0,0,e.auto_shift_type,83,1,'auto'
   FROM eligible e CROSS JOIN (SELECT $1::date+n AS day FROM generate_series(0,$2::date-$1::date) days(n)) d
   WHERE e.is_active AND e.employment_start_date IS NOT NULL AND e.auto_shift_type IS NOT NULL
    AND d.day::date>=e.employment_start_date AND (e.employment_end_date IS NULL OR d.day::date<=e.employment_end_date)
    AND EXTRACT(ISODOW FROM d.day) BETWEEN 1 AND 5
    AND NOT EXISTS(SELECT 1 FROM public.attendance_holidays h WHERE h.holiday_date=d.day::date)
    AND NOT EXISTS(SELECT 1 FROM public.payroll_periods p WHERE
     (p.saved_at IS NOT NULL OR p.published_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.payroll_items i WHERE i.payroll_period_id=p.id))
     AND (d.day::date BETWEEN p.start_date AND p.end_date OR d.day::date BETWEEN COALESCE(p.overtime_start_date,(date_trunc('month',COALESCE(p.payment_date,p.end_date))-interval '1 month')::date)
 AND COALESCE(p.overtime_end_date,(date_trunc('month',COALESCE(p.payment_date,p.end_date))-interval '1 day')::date)))
   ON CONFLICT(employee_id,work_date) DO NOTHING RETURNING *,work_date::text`,[s.start_date,today])).rows;
  for(const row of inserted) await audit(db,null,row,{role:'job'},'auto_work');
  return finish(missing?'incomplete_employee_setup':'ok',inserted.length,missing);
 });
}
