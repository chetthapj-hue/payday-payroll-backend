const fail=(status,message,code)=>Object.assign(new Error(message),{status,code});
export function bangkokToday(now=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
export async function createWorkLog(pool,input,{employeeId,latestDate=bangkokToday()}={}) {
 const {work_date,regular_minutes,overtime_minutes,overtime_3x_minutes,shift_type}=input || {};
 const employee_id=employeeId ?? input?.employee_id;
 if(!Number.isInteger(employee_id)||employee_id<1||employee_id>2147483647)throw fail(400,'รหัสพนักงานไม่ถูกต้อง');
 const parsed=new Date(`${work_date}T00:00:00.000Z`);
 if(typeof work_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(work_date)||work_date.startsWith('0000-')||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==work_date)
  throw fail(400,'วันที่ทำงานไม่ถูกต้อง');
 if(latestDate && work_date>latestDate)throw fail(400,'ไม่สามารถลงเวลาวันในอนาคตได้ (ยึดวันที่ประเทศไทย)','FUTURE_WORK_DATE');
 const wage_multiplier=input?.wage_multiplier ?? 1;
 if(![1,2].includes(wage_multiplier) || (wage_multiplier===2 && ![0,6].includes(parsed.getUTCDay())))
  throw fail(400,'ค่าแรง 2 เท่าเลือกได้เฉพาะวันเสาร์–อาทิตย์');
 if(regular_minutes!==480)throw fail(400,'เวลาปกติเต็มวันต้องเป็น 8 ชม.');
 if(!Number.isInteger(overtime_minutes)||!Number.isInteger(overtime_3x_minutes)||overtime_minutes<0||overtime_3x_minutes<0||overtime_3x_minutes>overtime_minutes||480+overtime_minutes>1440)
  throw fail(400,'OT ต้องไม่ติดลบ OT 3 เท่าต้องไม่เกิน OT รวม และเวลาทั้งวันต้องไม่เกิน 24 ชม.');
 if(!['day','night'].includes(shift_type))throw fail(400,'กรุณาเลือกกะกลางวันหรือกลางคืน');
 try {
  const result=await pool.query(`INSERT INTO public.work_logs
   (employee_id,work_date,regular_minutes,overtime_minutes,overtime_3x_minutes,shift_type,meal_allowance,wage_multiplier)
   SELECT $1,$2,$3,$4,$5,$6,$7,$8 FROM
   (SELECT id FROM public.employees WHERE id=$1 AND is_active FOR SHARE) active_employee
   RETURNING id,employee_id,work_date::text,regular_minutes,overtime_minutes,overtime_3x_minutes,shift_type,meal_allowance,wage_multiplier`,
   [employee_id,work_date,regular_minutes,overtime_minutes,overtime_3x_minutes,shift_type,overtime_minutes>=60?'166.00':'83.00',wage_multiplier]);
  if(!result.rows.length)throw fail(409,'ไม่สามารถลงเวลาให้พนักงานที่ปิดสถานะหรือไม่มีอยู่ได้','EMPLOYEE_INACTIVE');
  return result.rows[0];
 }catch(e){
  if(e.code==='23505')throw fail(409,'มีบันทึกเวลาของพนักงานคนนี้ในวันที่เลือกแล้ว กรุณาตรวจสอบประวัติ','WORK_LOG_DUPLICATE');
  if(e.code==='23503')throw fail(404,'ไม่พบพนักงาน');throw e;
 }
}
