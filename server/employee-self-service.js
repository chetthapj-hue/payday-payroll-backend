import {registerAttendanceRoutes} from './attendance.js';
import {bangkokToday,createWorkLog} from './work-logs.js';
import {calculate,periodDates} from './payroll.js';
export function registerEmployeeSelfService(app,pool,requireEmployee) {
 registerAttendanceRoutes(app,pool,requireEmployee,{employee:true});
 app.post('/api/me/work-logs',requireEmployee,async(req,res)=>{
  const row=await createWorkLog(pool,req.body,{employeeId:req.auth.employee_id,latestDate:bangkokToday()});
  res.status(201).json({data:row});
 });
 app.get('/api/me/accrued-income',requireEmployee,async(req,res)=>{
  const period=periodDates(req.query.month);
  const db=await pool.connect();
  try{
   await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const row=(await calculate(db,period,req.auth.employee_id))[0];
   if(!row)throw Object.assign(new Error('ไม่พบพนักงานของบัญชีนี้'),{status:404});
   await db.query('COMMIT');
   res.json({data:{period,row,as_of_date:bangkokToday(),kind:'accrued'}});
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 });
}
