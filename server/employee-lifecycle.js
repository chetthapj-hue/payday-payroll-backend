const fail=(status,message,code)=>Object.assign(new Error(message),{status,code});
function idFor(req) {
 if(!/^[1-9][0-9]*$/.test(req.params.id)||Number(req.params.id)>2147483647)throw fail(400,'รหัสพนักงานไม่ถูกต้อง');
 return Number(req.params.id);
}
async function relations(db,id) {
 const row=(await db.query(`SELECT
  EXISTS(SELECT 1 FROM public.auth_accounts WHERE employee_id=$1) AS has_account,
  EXISTS(SELECT 1 FROM public.work_logs WHERE employee_id=$1) AS has_work_logs,
  EXISTS(SELECT 1 FROM public.payroll_items WHERE employee_id=$1) AS has_payroll`,[id])).rows[0];
 return {...row,can_delete:!row.has_account&&!row.has_work_logs&&!row.has_payroll};
}
async function transaction(pool,fn) {
 const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}
 catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
export function registerEmployeeLifecycle(app,pool,requireAdmin) {
 // Every management endpoint explicitly requires an administrator.
 app.get('/api/employees/:id/deletion-check',requireAdmin,async(req,res)=>{
  const id=idFor(req);
  if(!(await pool.query('SELECT 1 FROM public.employees WHERE id=$1',[id])).rowCount)throw fail(404,'ไม่พบพนักงาน');
  res.json({data:await relations(pool,id)});
 });
 app.delete('/api/employees/:id',requireAdmin,async(req,res)=>{
  const id=idFor(req);
  const data=await transaction(pool,async db=>{
   // FOR UPDATE also blocks new FK references while we check/delete.
   if(!(await db.query('SELECT id FROM public.employees WHERE id=$1 FOR UPDATE',[id])).rowCount)throw fail(404,'ไม่พบพนักงาน');
   const check=await relations(db,id);
   if(!check.can_delete)throw fail(409,'พนักงานมีบัญชีหรือประวัติแล้ว กรุณาปิดสถานะพนักงานแทนการลบถาวร','EMPLOYEE_HAS_HISTORY');
   await db.query('DELETE FROM public.employees WHERE id=$1',[id]);return {id,deleted:true};
  });res.json({data});
 });
 app.post('/api/employees/:id/deactivate',requireAdmin,async(req,res)=>{
  const id=idFor(req);
  const data=await transaction(pool,async db=>{
   const row=(await db.query(`SELECT id FROM public.employees WHERE id=$1 FOR UPDATE`,[id])).rows[0];
   if(!row)throw fail(404,'ไม่พบพนักงาน');
   await db.query('UPDATE public.auth_accounts SET is_active=false WHERE employee_id=$1',[id]);
   await db.query(`DELETE FROM public.auth_sessions WHERE account_id IN
    (SELECT id FROM public.auth_accounts WHERE employee_id=$1)`,[id]);
   return (await db.query(`UPDATE public.employees SET is_active=false WHERE id=$1
    RETURNING id,employee_code,full_name,pay_type,pay_rate,is_active`,[id])).rows[0];
  });res.json({data});
 });
}
