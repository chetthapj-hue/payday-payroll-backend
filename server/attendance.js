import { createHash } from 'node:crypto';
import { bangkokToday } from './work-logs.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
export function validDate(value) {
 const d = new Date(`${value}T00:00:00Z`);
 return typeof value === 'string' && /^(20|21)\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(+d) && d.toISOString().slice(0,10) === value;
}
function id(value) {
 if (!/^[1-9]\d*$/.test(String(value)) || Number(value)>2147483647) throw fail(400,'รหัสรายการไม่ถูกต้อง');
 return Number(value);
}
export async function attendanceTransaction(pool, fn) {
 const db = await pool.connect();
 try {
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout = '10s'");
  // Same lock as payroll/save. Acquire before any employee/work-log row locks.
  await db.query('SELECT pg_advisory_xact_lock(80725101)');
  const result = await fn(db);
  await db.query('COMMIT');
  return result;
 } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
export const closedPeriodSQL = `SELECT 1 FROM public.payroll_periods p
 WHERE (p.saved_at IS NOT NULL OR p.published_at IS NOT NULL OR EXISTS
 (SELECT 1 FROM public.payroll_items i WHERE i.payroll_period_id=p.id))
 AND ($1::date BETWEEN p.start_date AND p.end_date
 OR $1::date BETWEEN COALESCE(p.overtime_start_date,(date_trunc('month',COALESCE(p.payment_date,p.end_date))-interval '1 month')::date)
 AND COALESCE(p.overtime_end_date,(date_trunc('month',COALESCE(p.payment_date,p.end_date))-interval '1 day')::date)) LIMIT 1`;
async function checkOpen(db,date,actor) {
 if (actor.role !== 'admin' && (await db.query(closedPeriodSQL,[date])).rowCount)
  throw fail(409,'วันที่นี้มีผลต่องวดที่บันทึก/เผยแพร่แล้ว ทั้งรอบค่าจ้างหรือรอบ OT กรุณาติดต่อแอดมิน','PERIOD_CLOSED');
}
// Explicit allowlist: never audit authentication/session/other request data.
function auditValue(row) {
 if (!row) return null;
 return Object.fromEntries(['employee_id','work_date','attendance_status','source','regular_minutes','overtime_minutes','overtime_3x_minutes','overtime_1x_minutes','overtime_2x_minutes','shift_type','meal_allowance','wage_multiplier','leave_paid','leave_wage_fraction','leave_monthly_deduction_fraction'].map(k=>[k,row[k]]));
}
const conflictToken = row => createHash('sha256').update(JSON.stringify({id:row.id,...auditValue(row)})).digest('hex');
export async function audit(db,before,after,actor,action) {
 const row=after || before;
 await db.query(`INSERT INTO public.attendance_audit(work_log_id,employee_id,actor_account_id,actor_role,action,before_value,after_value)
 VALUES($1,$2,$3,$4,$5,$6,$7)`,[row.id,row.employee_id,actor.id ?? null,actor.role,action,auditValue(before),auditValue(after)]);
}
async function ownLog(db,logId,actor) {
 const row=(await db.query(`SELECT *,work_date::text FROM public.work_logs WHERE id=$1
 AND ($2::integer IS NULL OR employee_id=$2) FOR UPDATE`,[id(logId),actor.role==='employee'?actor.employee_id:null])).rows[0];
 if(!row) throw fail(404,'ไม่พบรายการที่คุณมีสิทธิ์แก้ไข');
 await checkOpen(db,row.work_date,actor);
 return row;
}
export async function editOvertime(pool,logId,input,actor) {
 const {overtime_minutes:ot,overtime_3x_minutes:triple}=input || {};
 if(!Number.isInteger(ot)||!Number.isInteger(triple)||ot<0||ot>960||triple<0||triple>ot)
  throw fail(400,'OT ต้องเป็นนาทีเต็ม ไม่ติดลบ ไม่เกิน 16 ชม. และ OT 3 เท่าต้องไม่เกิน OT รวม');
 return attendanceTransaction(pool,async db=>{
  const before=await ownLog(db,logId,actor);
  const ot1=input.overtime_1x_minutes ?? before.overtime_1x_minutes,ot2=input.overtime_2x_minutes ?? before.overtime_2x_minutes;
  if(!Number.isInteger(ot1)||!Number.isInteger(ot2)||ot1<0||ot2<0||ot1+ot2+triple>ot) throw fail(400,'ส่วนแบ่ง OT ต้องไม่ติดลบและรวมกันไม่เกิน OT รวม');
  if(before.attendance_status!=='work') throw fail(409,'วันลาไม่สามารถลง OT ได้','LEAVE_CONFLICT');
  if(before.regular_minutes+ot>1440) throw fail(400,'เวลารวมต้องไม่เกิน 24 ชม.');
  if(before.work_date>bangkokToday()) throw fail(400,'ไม่สามารถแก้วันในอนาคต');
  const after=(await db.query(`UPDATE public.work_logs SET overtime_minutes=$1,overtime_3x_minutes=$2,
   meal_allowance=$3,source='manual',overtime_1x_minutes=$5,overtime_2x_minutes=$6 WHERE id=$4 RETURNING *,work_date::text`,[ot,triple,ot>=60?'166.00':'83.00',before.id,ot1,ot2])).rows[0];
  await audit(db,before,after,actor,'edit_ot'); return after;
 });
}
export function leavePolicy(settings,type) {
 const policy=settings?.leave_policy?.[type];
 if(!['sick','personal'].includes(type)) throw fail(400,'กรุณาเลือกลาป่วยหรือลากิจ');
 if(!policy || typeof policy.daily_wage_fraction!=='number' || policy.daily_wage_fraction<0 || policy.daily_wage_fraction>1 ||
 typeof policy.meal_allowance!=='number' || !Number.isFinite(policy.meal_allowance) || policy.meal_allowance<0 || policy.meal_allowance>99999999 ||
 !(policy.monthly_deduction_divisor===null || (typeof policy.monthly_deduction_divisor==='number' && Number.isFinite(policy.monthly_deduction_divisor) && policy.monthly_deduction_divisor>=1)))
  throw fail(409,'ยังไม่เปิดใช้วันลา: ต้องยืนยันค่าแรงรายวัน วิธีหักเงินเดือน และค่าอาหารก่อน','LEAVE_POLICY_PENDING');
 return policy;
}
async function checkEmployee(db,employeeId,date) {
 const e=(await db.query(`SELECT *,employment_start_date::text,employment_end_date::text FROM public.employees WHERE id=$1 FOR SHARE`,[employeeId])).rows[0];
 if(!e?.is_active) throw fail(409,'พนักงานปิดสถานะหรือไม่มีอยู่');
 if(!e.employment_start_date) throw fail(409,'กรุณาให้แอดมินกำหนดวันเริ่มงานจริงก่อน','EMPLOYMENT_PENDING');
 if(date<e.employment_start_date || (e.employment_end_date && date>e.employment_end_date)) throw fail(400,'วันที่อยู่นอกช่วงการจ้าง');
 return e;
}
export async function setLeave(pool,input,actor) {
 const {work_date:date,type}=input || {};
 if(!validDate(date)||date>bangkokToday()) throw fail(400,'วันลาต้องเป็นวันที่ถูกต้องและไม่เกินวันนี้ตามเวลาไทย');
 const employeeId=actor.role==='employee'?actor.employee_id:id(input?.employee_id);
 return attendanceTransaction(pool,async db=>{
  await checkOpen(db,date,actor);
  await checkEmployee(db,employeeId,date);
  const settings=(await db.query('SELECT * FROM public.attendance_settings WHERE id=true FOR SHARE')).rows[0];
  const policy=leavePolicy(settings,type);
  const paid=input.paid ?? false;
  if(typeof paid!=='boolean') throw fail(400,'กรุณาเลือกลาได้เงินหรือไม่ได้เงิน');
  if(paid && actor.role!=='admin' && !settings.employee_can_choose_paid_leave) throw fail(403,'วันลาได้เงินต้องให้แอดมินเป็นผู้กำหนด','PAID_LEAVE_ADMIN_REQUIRED');
  const before=(await db.query(`SELECT *,work_date::text FROM public.work_logs WHERE employee_id=$1 AND work_date=$2 FOR UPDATE`,[employeeId,date])).rows[0];
  const workConflict=before && before.attendance_status==='work' && (before.source!=='auto'||before.overtime_minutes!==0||before.overtime_3x_minutes!==0);
  if(workConflict && !(actor.role==='admin' && input.replace_work_token===conflictToken(before)))
   throw fail(409,'วันนี้มี OT หรือรายการลงงานเอง กรุณาติดต่อแอดมินเพื่อตรวจสอบก่อน ไม่มีข้อมูลถูกลบ','LEAVE_CONFLICT');
  // Keep the original automatic work day for cancellation, including its chosen shift.
  const restore=before?.attendance_status==='work'?auditValue(before):before?.leave_restore ?? null;
  const args=[employeeId,date,type,policy.meal_allowance,paid?1:policy.daily_wage_fraction,
   paid || policy.monthly_deduction_divisor===null?0:1/policy.monthly_deduction_divisor,restore,paid];
  const after=(await db.query(`INSERT INTO public.work_logs(employee_id,work_date,attendance_status,source,regular_minutes,
   overtime_minutes,overtime_3x_minutes,shift_type,meal_allowance,wage_multiplier,leave_wage_fraction,leave_monthly_deduction_fraction,leave_restore,leave_paid,overtime_1x_minutes,overtime_2x_minutes)
   VALUES($1,$2,$3,'leave',0,0,0,NULL,$4,1,$5,$6,$7,$8,0,0)
   ON CONFLICT(employee_id,work_date) DO UPDATE SET attendance_status=$3,source='leave',regular_minutes=0,
   overtime_minutes=0,overtime_3x_minutes=0,overtime_1x_minutes=0,overtime_2x_minutes=0,shift_type=NULL,meal_allowance=$4,wage_multiplier=1,
   leave_wage_fraction=$5,leave_monthly_deduction_fraction=$6,leave_restore=$7,leave_paid=$8 RETURNING *,work_date::text`,args)).rows[0];
  await audit(db,before,after,actor,before?.attendance_status==='work'?(workConflict?'confirmed_work_to_leave':'auto_to_leave'):'set_leave');return after;
 });
}
export async function cancelLeave(pool,logId,actor) {
 return attendanceTransaction(pool,async db=>{
  const before=await ownLog(db,logId,actor);
  if(before.attendance_status==='work') throw fail(409,'รายการนี้ไม่ใช่วันลา');
  if(before.work_date>bangkokToday()) throw fail(400,'ไม่สามารถแก้วันในอนาคต');
  await checkEmployee(db,before.employee_id,before.work_date);
  let after=null;
  if(before.leave_restore) {
   const r=before.leave_restore;
   after=(await db.query(`UPDATE public.work_logs SET attendance_status='work',source=$5,regular_minutes=$2,
    overtime_minutes=$6,overtime_3x_minutes=$7,shift_type=$3,meal_allowance=$4,wage_multiplier=$8,overtime_1x_minutes=$9,overtime_2x_minutes=$10,
    leave_wage_fraction=NULL,leave_monthly_deduction_fraction=NULL,leave_restore=NULL,leave_paid=NULL WHERE id=$1 RETURNING *,work_date::text`,
    [before.id,r.regular_minutes,r.shift_type,r.meal_allowance,r.source,r.overtime_minutes,r.overtime_3x_minutes,r.wage_multiplier,r.overtime_1x_minutes ?? 0,r.overtime_2x_minutes ?? 0])).rows[0];
  } else await db.query('DELETE FROM public.work_logs WHERE id=$1',[before.id]);
  await audit(db,before,after,actor,'cancel_leave');
  return after || {id:before.id,employee_id:before.employee_id,work_date:before.work_date,cancelled:true};
 });
}
export async function configureAttendance(pool,input) {
 return attendanceTransaction(pool,async db=>{
  const current=(await db.query('SELECT *,start_date::text,holiday_reviewed_through::text FROM public.attendance_settings WHERE id=true FOR UPDATE')).rows[0];
  const s={...current,...input};
  if(typeof s.employee_can_choose_paid_leave!=='boolean' || typeof s.auto_enabled!=='boolean' || (s.start_date!==null&&!validDate(s.start_date)) ||
   ![null,'skip'].includes(s.holiday_mode) || (s.holiday_reviewed_through!==null&&!validDate(s.holiday_reviewed_through))) throw fail(400,'ตรวจการตั้งค่าการลงเวลาอัตโนมัติ');
  if(current.start_date && s.start_date!==current.start_date) throw fail(409,'วันเปิดฟีเจอร์ถูกกำหนดแล้ว ห้ามเปลี่ยนเพื่อเติมอดีต');
  if(!current.start_date && s.start_date && s.start_date<bangkokToday()) throw fail(400,'วันเปิดฟีเจอร์ครั้งแรกต้องเป็นวันนี้หรืออนาคต');
  if(s.leave_policy!==null) {leavePolicy(s,'sick');leavePolicy(s,'personal');}
  if(s.auto_enabled) {
   if(!s.start_date || s.holiday_mode!=='skip' || !s.holiday_reviewed_through || s.holiday_reviewed_through<bangkokToday()) throw fail(409,'ต้องกำหนดวันเปิดฟีเจอร์และตรวจปฏิทินวันหยุดก่อน');
   leavePolicy(s,'sick');leavePolicy(s,'personal');
  }
  return (await db.query(`UPDATE public.attendance_settings SET auto_enabled=$1,start_date=$2,leave_policy=$3,
   holiday_mode=$4,holiday_reviewed_through=$5,employee_can_choose_paid_leave=$6 WHERE id=true RETURNING *,start_date::text,holiday_reviewed_through::text`,
   [s.auto_enabled,s.start_date,s.leave_policy,s.holiday_mode,s.holiday_reviewed_through,s.employee_can_choose_paid_leave])).rows[0];
 });
}
export function registerAttendanceRoutes(app,pool,guard,{employee=false}={}) {
 const prefix=employee?'/api/me':'/api';
 app.patch(`${prefix}/work-logs/:id/overtime`,guard,async(req,res)=>res.json({data:await editOvertime(pool,req.params.id,req.body,req.auth)}));
 app.post(`${prefix}/leaves`,guard,async(req,res)=>res.status(201).json({data:await setLeave(pool,req.body,req.auth)}));
 app.delete(`${prefix}/leaves/:id`,guard,async(req,res)=>res.json({data:await cancelLeave(pool,req.params.id,req.auth)}));
 if(employee) {
  app.get('/api/me/attendance-policy',guard,async(req,res)=>res.json({data:(await pool.query(`SELECT leave_policy IS NOT NULL AS leave_enabled,employee_can_choose_paid_leave,
   (SELECT COALESCE(json_agg(holiday_date::text),'[]'::json) FROM public.attendance_holidays) AS holiday_dates FROM public.attendance_settings WHERE id=true`)).rows[0]}));
  return;
 }
 app.get('/api/attendance/day',guard,async(req,res)=>{
  if(!validDate(req.query.date)) throw fail(400,'วันที่ไม่ถูกต้อง');
  const row=(await pool.query('SELECT *,work_date::text FROM public.work_logs WHERE employee_id=$1 AND work_date=$2',[id(req.query.employee_id),req.query.date])).rows[0];
  if(!row) throw fail(404,'ไม่พบรายการ');
  res.json({data:{row,replace_work_token:conflictToken(row)}});
 });
 app.put('/api/attendance/holidays/:date',guard,async(req,res)=>{
  if(!validDate(req.params.date)||typeof req.body?.label!=='string'||!req.body.label.trim()||req.body.label.length>200) throw fail(400,'ตรวจวันที่และชื่อวันหยุด');
  await attendanceTransaction(pool,async db=>{
   if((await db.query("SELECT 1 FROM public.work_logs WHERE work_date=$1 AND source='auto'",[req.params.date])).rowCount) throw fail(409,'มีรายการอัตโนมัติแล้ว ต้องตรวจแก้ต้นทางก่อนเพิ่มวันหยุด');
   await db.query(`INSERT INTO public.attendance_holidays VALUES($1,$2) ON CONFLICT(holiday_date) DO UPDATE SET label=$2`,[req.params.date,req.body.label.trim()]);
  });res.json({data:{holiday_date:req.params.date,label:req.body.label.trim()}});
 });
 app.delete('/api/attendance/holidays/:date',guard,async(req,res)=>{
  if(!validDate(req.params.date)) throw fail(400,'วันที่ไม่ถูกต้อง');
  await attendanceTransaction(pool,async db=>{
   const s=(await db.query('SELECT auto_enabled,start_date::text FROM public.attendance_settings WHERE id=true')).rows[0];
   if(s.auto_enabled && req.params.date<=bangkokToday() && req.params.date>=s.start_date) throw fail(409,'ปิดงานอัตโนมัติและตรวจผลกระทบก่อนลบวันหยุดที่ผ่านมา');
   await db.query('DELETE FROM public.attendance_holidays WHERE holiday_date=$1',[req.params.date]);
  });res.json({data:{deleted:true}});
 });
 app.get('/api/work-logs/:id/audit',guard,async(req,res)=>res.json({data:(await pool.query('SELECT * FROM public.attendance_audit WHERE work_log_id=$1 ORDER BY id',[id(req.params.id)])).rows}));
 app.put('/api/attendance/settings',guard,async(req,res)=>res.json({data:await configureAttendance(pool,req.body)}));
 app.get('/api/attendance/status',guard,async(req,res)=>{
  res.json({data:{settings:(await pool.query('SELECT *,start_date::text,holiday_reviewed_through::text FROM public.attendance_settings')).rows[0],
   holidays:(await pool.query('SELECT holiday_date::text,label FROM public.attendance_holidays ORDER BY holiday_date')).rows,
   runs:(await pool.query('SELECT * FROM public.attendance_job_runs ORDER BY id DESC LIMIT 10')).rows}});
 });
 app.put('/api/employees/:id/attendance',guard,async(req,res)=>{
  const {employment_start_date:start,employment_end_date:end,auto_shift_type:shift}=req.body || {};
  if(!validDate(start)||(end!==null && (!validDate(end)||end<start)) || ![null,'day','night'].includes(shift)) throw fail(400,'ตรวจวันเริ่ม/สิ้นสุดการจ้างและกะอัตโนมัติ');
  const row=await attendanceTransaction(pool,async db=>(await db.query(`UPDATE public.employees SET employment_start_date=$2,
   employment_end_date=$3,auto_shift_type=$4 WHERE id=$1 RETURNING id,employment_start_date::text,employment_end_date::text,auto_shift_type`,[id(req.params.id),start,end,shift])).rows[0]);
  if(!row) throw fail(404,'ไม่พบพนักงาน');res.json({data:row});
 });
}
