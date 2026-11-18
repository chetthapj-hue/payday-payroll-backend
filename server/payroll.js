import { OT_MEAL_MINUTES, NORMAL_MEAL_BAHT, OT_MEAL_BAHT } from '../shared/meal-allowance.js';
import { createHash } from 'node:crypto';

export function periodDates(month) {
  if (typeof month !== 'string' || !/^(20[0-9]{2}|21[0-9]{2})-(0[1-9]|1[0-2])$/.test(month)) {
    throw Object.assign(new Error('กรุณาเลือกเดือนจ่ายระหว่างปี 2000–2199'), { status: 400 });
  }
  const [year, m] = month.split('-').map(Number);
  const date = (y, mon, day) => new Date(Date.UTC(y, mon - 1, day)).toISOString().slice(0, 10);
  return {
    period_name: `งวดจ่าย ${month}-25`,
    start_date: date(year, m - 1, 17), end_date: date(year, m, 16),
    overtime_start_date: date(year, m - 1, 1), overtime_end_date: date(year, m, 0),
    payment_date: date(year, m, 25),
  };
}

// Formula source: save_period_payroll.sql and period_allowances.sql.
// Keep PostgreSQL numeric arithmetic and round each component before gross pay.
// Live accrual/unsaved previews use the current policy; saved reports bypass this SQL.
// Preserve nonstandard legacy meal amounts and leave eligibility. Never rewrite work rows here.
const calculationSQL = `
WITH work AS (
 SELECT employee_id, COUNT(DISTINCT work_date) FILTER (WHERE attendance_status='work') AS days,
 COUNT(*) FILTER (WHERE attendance_status='sick')::integer AS sick_days,
 COUNT(*) FILTER (WHERE attendance_status='personal')::integer AS personal_days,
 SUM(CASE WHEN attendance_status='work' THEN wage_multiplier ELSE leave_wage_fraction END) AS paid_days,
 SUM(COALESCE(leave_monthly_deduction_fraction,0)) AS monthly_deductions, ROUND(SUM(CASE WHEN attendance_status='work' AND meal_allowance IN ($7::numeric,$7::numeric+$8::numeric)
 THEN $7::numeric + CASE WHEN overtime_minutes >= $6::integer THEN $8::numeric ELSE 0 END
 ELSE meal_allowance END),2) AS meal,
 SUM(CASE WHEN attendance_status='work' AND shift_type='night' THEN 150.00 ELSE 0.00 END) AS shift
 FROM public.work_logs WHERE work_date BETWEEN $1::date AND $2::date AND ($5::integer IS NULL OR employee_id=$5) GROUP BY employee_id
), overtime AS (
 SELECT employee_id, SUM(overtime_minutes - overtime_3x_minutes - overtime_1x_minutes - overtime_2x_minutes) AS ot15,
 SUM(overtime_1x_minutes) AS ot1,SUM(overtime_2x_minutes) AS ot2,
 SUM(overtime_3x_minutes) AS ot3 FROM public.work_logs
 WHERE work_date BETWEEN $3::date AND $4::date AND ($5::integer IS NULL OR employee_id=$5) GROUP BY employee_id
), amounts AS (
 SELECT e.id AS employee_id, e.employee_code, e.full_name,
 e.pay_type AS pay_type_used, e.pay_rate AS pay_rate_used, COALESCE(w.days,0)::integer AS recorded_days,
 COALESCE(w.sick_days,0)::integer AS sick_days,COALESCE(w.personal_days,0)::integer AS personal_days,
 ROUND(CASE e.pay_type WHEN 'monthly' THEN e.pay_rate * GREATEST(0,1-COALESCE(w.monthly_deductions,0)) ELSE e.pay_rate * COALESCE(w.paid_days,0) END,2) AS base_pay,
 ROUND((CASE e.pay_type WHEN 'daily' THEN e.pay_rate / 8 ELSE e.pay_rate / 30 / 8 END)
 * 1.5 * COALESCE(o.ot15,0) / 60,2) AS overtime_15_pay,
 ROUND((CASE e.pay_type WHEN 'daily' THEN e.pay_rate / 8 ELSE e.pay_rate / 30 / 8 END)
 * 3 * COALESCE(o.ot3,0) / 60,2) AS overtime_3_pay,
 ROUND((CASE e.pay_type WHEN 'daily' THEN e.pay_rate / 8 ELSE e.pay_rate / 30 / 8 END) * COALESCE(o.ot1,0) / 60,2) AS overtime_1_pay,
 ROUND((CASE e.pay_type WHEN 'daily' THEN e.pay_rate / 8 ELSE e.pay_rate / 30 / 8 END) * 2 * COALESCE(o.ot2,0) / 60,2) AS overtime_2_pay,
 COALESCE(o.ot1,0)::integer AS overtime_1_minutes,COALESCE(o.ot2,0)::integer AS overtime_2_minutes,
 COALESCE(o.ot15,0)::integer AS overtime_15_minutes,
 COALESCE(o.ot3,0)::integer AS overtime_3_minutes,
 (COALESCE(o.ot1,0)+COALESCE(o.ot2,0)+COALESCE(o.ot15,0)+COALESCE(o.ot3,0))::integer AS overtime_total_minutes,
 COALESCE(w.meal,0.00) AS meal_pay, COALESCE(w.shift,0.00) AS shift_pay
 FROM public.employees e LEFT JOIN work w ON w.employee_id=e.id
 LEFT JOIN overtime o ON o.employee_id=e.id
 WHERE ($5::integer IS NULL OR e.id=$5)
)
SELECT *, overtime_1_pay + overtime_2_pay + overtime_15_pay + overtime_3_pay AS overtime_total_pay, base_pay + overtime_1_pay + overtime_2_pay + overtime_15_pay + overtime_3_pay + meal_pay + shift_pay AS gross_pay
FROM amounts ORDER BY employee_code`;

export async function calculate(db, period, employeeId = null) {
  const values = [period.start_date, period.end_date, period.overtime_start_date, period.overtime_end_date, employeeId];
  const invalid = await db.query(`SELECT id, work_date::text AS work_date FROM public.work_logs
    WHERE (work_date BETWEEN $1::date AND $2::date OR work_date BETWEEN $3::date AND $4::date)
    AND ($5::integer IS NULL OR employee_id=$5)
    AND ((attendance_status='work' AND (regular_minutes<>480 OR shift_type IS NULL OR overtime_3x_minutes IS NULL))
 OR (attendance_status<>'work' AND (regular_minutes<>0 OR overtime_minutes<>0 OR overtime_3x_minutes<>0 OR overtime_1x_minutes<>0 OR overtime_2x_minutes<>0 OR leave_wage_fraction IS NULL OR leave_monthly_deduction_fraction IS NULL)))
    ORDER BY id LIMIT 10`, values);
  if (invalid.rows.length) {
    throw Object.assign(new Error(`คำนวณไม่ได้: บันทึกเวลา ${invalid.rows.map(r => r.id).join(', ')} มีวันไม่เต็มหรือข้อมูลกะ/OT ไม่ครบ ต้องยืนยันกติกาก่อน`), { status: 422 });
  }
  return (await db.query(calculationSQL, [...values, OT_MEAL_MINUTES, NORMAL_MEAL_BAHT, OT_MEAL_BAHT])).rows;
}
const tokenFor = (period, rows) => createHash('sha256').update(JSON.stringify({ period, rows })).digest('hex');
const periodSelect = `SELECT id,period_name,start_date::text,end_date::text,
 overtime_start_date::text,overtime_end_date::text,payment_date::text,saved_at,published_at
 FROM public.payroll_periods`;
async function report(db, id) {
  const p = (await db.query(`${periodSelect} WHERE id=$1 AND saved_at IS NOT NULL`, [id])).rows[0];
  if (!p) throw Object.assign(new Error('ไม่พบรายงานงวดที่บันทึกแล้ว'), { status: 404 });
  const rows = (await db.query(`SELECT employee_id, employee_code_snapshot AS employee_code,
    full_name_snapshot AS full_name,pay_type_used,pay_rate_used,base_pay,overtime_15_pay,
    overtime_3_pay,meal_pay,shift_pay,gross_pay,recorded_days,sick_days,personal_days,overtime_1_minutes,overtime_2_minutes,overtime_1_pay,overtime_2_pay,overtime_15_minutes,
    overtime_3_minutes,overtime_total_minutes,
    COALESCE(overtime_total_pay,overtime_15_pay+overtime_3_pay) AS overtime_total_pay FROM public.payroll_items
    WHERE payroll_period_id=$1 ORDER BY employee_code_snapshot`, [id])).rows;
  return { period: p, rows, saved: true };
}
const route = fn => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

export function registerPayrollRoutes(app, pool, requireAdmin) {
  app.get('/api/payroll/preview', requireAdmin, route(async (req, res) => {
    const period = periodDates(req.query.month);
    const db = await pool.connect();
    try {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const saved = (await db.query(`${periodSelect} WHERE start_date=$1 AND end_date=$2 AND saved_at IS NOT NULL`,
        [period.start_date, period.end_date])).rows[0];
      const data = saved ? await report(db, saved.id) : await (async () => {
        const rows = await calculate(db, period);
        return { period, rows, saved: false, preview_token: tokenFor(period, rows) };
      })();
      await db.query('COMMIT');
      res.json({ data });
    } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  }));

  app.post('/api/payroll/save', requireAdmin, route(async (req, res) => {
    const period = periodDates(req.body?.month);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Serialize all saves, then freeze source rows while rechecking the preview.
      await db.query("SELECT pg_advisory_xact_lock(80725101)");
      const saved = (await db.query(`${periodSelect} WHERE start_date=$1 AND end_date=$2 AND saved_at IS NOT NULL`,
        [period.start_date, period.end_date])).rows[0];
      if (saved) {
        const data = await report(db, saved.id);
        await db.query('COMMIT');
        return res.json({ data });
      }
      await db.query('LOCK TABLE public.employees, public.work_logs IN SHARE MODE');
      const rows = await calculate(db, period);
      if (!rows.length) throw Object.assign(new Error('ยังไม่มีพนักงานให้บันทึกงวด'), { status: 422 });
      if (req.body?.preview_token !== tokenFor(period, rows)) {
        throw Object.assign(new Error('ข้อมูลเปลี่ยนจากยอดที่ตรวจแล้ว กรุณาคำนวณและตรวจยอดใหม่ก่อนบันทึก'), { status: 409 });
      }
      const p = (await db.query(`INSERT INTO public.payroll_periods
        (period_name,start_date,end_date,overtime_start_date,overtime_end_date,payment_date)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (start_date,end_date) DO UPDATE SET
        period_name=EXCLUDED.period_name,overtime_start_date=EXCLUDED.overtime_start_date,
        overtime_end_date=EXCLUDED.overtime_end_date,payment_date=EXCLUDED.payment_date RETURNING id`,
        Object.values(period))).rows[0];
      for (const r of rows) {
        await db.query(`INSERT INTO public.payroll_items
          (payroll_period_id,employee_id,employee_code_snapshot,full_name_snapshot,
          pay_type_used,pay_rate_used,base_pay,overtime_15_pay,overtime_3_pay,meal_pay,shift_pay,
          recorded_days,overtime_15_minutes,overtime_3_minutes,overtime_total_minutes,overtime_total_pay,sick_days,personal_days,overtime_1_minutes,overtime_2_minutes,overtime_1_pay,overtime_2_pay)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
          [p.id,r.employee_id,r.employee_code,r.full_name,r.pay_type_used,r.pay_rate_used,
            r.base_pay,r.overtime_15_pay,r.overtime_3_pay,r.meal_pay,r.shift_pay,r.recorded_days,r.overtime_15_minutes,r.overtime_3_minutes,
            r.overtime_total_minutes,r.overtime_total_pay,r.sick_days,r.personal_days,r.overtime_1_minutes,r.overtime_2_minutes,r.overtime_1_pay,r.overtime_2_pay]);
      }
      await db.query('UPDATE public.payroll_periods SET saved_at=CURRENT_TIMESTAMP WHERE id=$1', [p.id]);
      const data = await report(db, p.id);
      await db.query('COMMIT');
      res.status(201).json({ data });
    } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  }));
  app.get('/api/payroll/periods', requireAdmin, route(async (req, res) => {
    res.json({ data: (await pool.query(`${periodSelect} WHERE saved_at IS NOT NULL ORDER BY payment_date DESC,id DESC`)).rows });
  }));
  app.get('/api/payroll/periods/:id', requireAdmin, route(async (req, res) => {
    if (!/^[1-9][0-9]*$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
      throw Object.assign(new Error('รหัสงวดไม่ถูกต้อง'), { status: 400 });
    }
    res.json({ data: await report(pool, req.params.id) });
  }));
  app.post('/api/payroll/periods/:id/publish', requireAdmin, route(async (req, res) => {
    if (!/^[1-9][0-9]*$/.test(req.params.id) || Number(req.params.id)>2147483647) {
      throw Object.assign(new Error('รหัสงวดไม่ถูกต้อง'), {status:400});
    }
    const row=(await pool.query(`UPDATE public.payroll_periods
      SET published_at=COALESCE(published_at,CURRENT_TIMESTAMP)
      WHERE id=$1 AND saved_at IS NOT NULL RETURNING id`,[req.params.id])).rows[0];
    if(!row) throw Object.assign(new Error('ไม่พบงวดที่บันทึกแล้ว'),{status:404});
    res.json({data:await report(pool,row.id)});
  }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('API:', error.message);
    const status = error.status || 500;
    res.status(status).json({ message: status < 500 ? error.message : 'ระบบฐานข้อมูลไม่พร้อม กรุณาตรวจสอบ Backend และ migration', code: error.code && status < 500 ? error.code : undefined });
  });
}
