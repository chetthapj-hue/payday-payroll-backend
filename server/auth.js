import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { registerEmployeeSelfService } from './employee-self-service.js';
const cookieName = 'payday_sid';
const sessionMs = 8 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
const failure = (status, message, code) => Object.assign(new Error(message), { status, code });
const userSQL = `SELECT a.id,a.role,a.employee_id,a.username,a.must_change_password,a.is_active,
 e.employee_code,COALESCE(e.full_name,a.username) AS full_name FROM public.auth_accounts a
 LEFT JOIN public.employees e ON e.id=a.employee_id`;
function publicUser(row) {
  return { id:row.id, role:row.role, employee_id:row.employee_id,
    login:row.role==='admin' ? row.username : row.employee_code,
    full_name:row.full_name, must_change_password:row.must_change_password };
}
function cookieOptions(req) {
  return { httpOnly:true, sameSite:'lax', secure:req.secure || process.env.COOKIE_SECURE==='true', path:'/' };
}
function checkCsrf(req, res, next) {
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
        if (req.get('X-PayDay-Request') !== '1') return next(failure(403,'คำขอไม่ถูกต้อง กรุณาทำรายการจากหน้าเว็บ','CSRF_REJECTED'));
        if (req.auth && req.path !== '/api/auth/login' && req.get('X-CSRF-Token') !== req.csrf) {
            return next(failure(403,'เซสชันของหน้าเว็บเปลี่ยน กรุณาโหลดหน้าใหม่','CSRF_REJECTED'));
        }
    }
    next();
}
export function requireSession(req, res, next) {
  if (!req.auth) return next(failure(401,'กรุณาเข้าสู่ระบบ','AUTH_REQUIRED'));
  checkCsrf(req, res, next);
}
function ready(req, next, role) {
  if (!req.auth) return next(failure(401,'กรุณาเข้าสู่ระบบ','AUTH_REQUIRED'));
  if (req.auth.must_change_password) return next(failure(403,'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนดูข้อมูล','PASSWORD_CHANGE_REQUIRED'));
  if (req.auth.role !== role) return next(failure(403,'คุณไม่มีสิทธิ์ทำรายการนี้','FORBIDDEN'));
  checkCsrf(req, null, next);
}
export const requireAdmin = (req, res, next) => ready(req,next,'admin');
const requireEmployee = (req, res, next) => ready(req,next,'employee');
async function transaction(pool, fn) {
  const db=await pool.connect();
  try { await db.query('BEGIN'); const result=await fn(db); await db.query('COMMIT'); return result; }
  catch(e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
async function newSession(db, accountId) {
  const token=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex');
  await db.query(`INSERT INTO public.auth_sessions(token_hash,account_id,csrf_token,expires_at)
    VALUES ($1,$2,$3,CURRENT_TIMESTAMP + interval '8 hours')`,[digest(token),accountId,csrf]);
  const user=publicUser((await db.query(`${userSQL} WHERE a.id=$1`,[accountId])).rows[0]);
  return { token, data:{user,csrf_token:csrf} };
}
function sendSession(req,res,result) {
  res.cookie(cookieName,result.token,{...cookieOptions(req),maxAge:sessionMs});
  res.json({data:result.data});
}
export async function createFirstAdmin(pool, username, password) {
  if (typeof username!=='string' || !/^[a-zA-Z0-9_.-]{3,80}$/.test(username)) {
    throw failure(400,'ชื่อ admin ต้องเป็นอักษรอังกฤษ ตัวเลข . _ - จำนวน 3–80 ตัว');
  }
  const hash=await hashPassword(password);
  return transaction(pool,async db => {
    await db.query('SELECT pg_advisory_xact_lock(80725102)');
    if ((await db.query("SELECT 1 FROM public.auth_accounts WHERE role='admin'")).rowCount) {
      throw failure(409,'มี admin แล้ว คำสั่งนี้ใช้สร้างผู้ดูแลคนแรกเท่านั้น');
    }
    return (await db.query(`INSERT INTO public.auth_accounts(role,username,password_hash,must_change_password)
      VALUES ('admin',$1,$2,false) RETURNING id,username`,[username,hash])).rows[0];
  });
}
export function registerAuth(app,pool) {
  app.use('/api',async (req,res,next) => {
    res.set('Cache-Control','no-store');
    let token;
    for (const part of (req.headers.cookie || '').split(';')) {
      const [key,value]=part.trim().split('='); if(key===cookieName) token=value;
    }
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const row=(await pool.query(`${userSQL} JOIN public.auth_sessions s ON s.account_id=a.id
        WHERE s.token_hash=$1 AND s.expires_at>CURRENT_TIMESTAMP AND a.is_active AND (a.role='admin' OR e.is_active)`,[digest(token)])).rows[0];
      if(row) {
        req.auth=row; req.sessionHash=digest(token);
        // Read CSRF in the same request; revoked sessions never authenticate.
        const session=(await pool.query('SELECT csrf_token FROM public.auth_sessions WHERE token_hash=$1',[req.sessionHash])).rows[0];
        if(session) req.csrf=session.csrf_token; else req.auth=null;
      }
    }
    next();
  });
  app.get('/api/auth/session',requireSession,(req,res)=>res.json({data:{user:publicUser(req.auth),csrf_token:req.csrf}}));
  app.post('/api/auth/login',checkCsrf,async (req,res)=>{
    const {login,password,role='employee'}=req.body || {};
    if(typeof login!=='string' || !login.trim() || login.length>100 || typeof password!=='string' || password.length>128 || !['admin','employee'].includes(role)) {
      throw failure(400,'กรุณากรอกรหัสผู้ใช้ ประเภทบัญชี และรหัสผ่านให้ถูกต้อง');
    }
    const key=digest(`${req.ip}|${role}|${login.trim()}`);
    const attempts=(await pool.query(`INSERT INTO public.auth_login_attempts(attempt_key,attempts,expires_at)
      VALUES ($1,1,CURRENT_TIMESTAMP+interval '15 minutes') ON CONFLICT(attempt_key) DO UPDATE SET
      attempts=CASE WHEN auth_login_attempts.expires_at<CURRENT_TIMESTAMP THEN 1 ELSE auth_login_attempts.attempts+1 END,
      expires_at=CASE WHEN auth_login_attempts.expires_at<CURRENT_TIMESTAMP THEN EXCLUDED.expires_at ELSE auth_login_attempts.expires_at END
      RETURNING attempts`,[key])).rows[0].attempts;
    if(attempts>10) throw failure(429,'เข้าสู่ระบบไม่สำเร็จหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');
    const account=(await pool.query(`SELECT a.id,a.password_hash,a.employee_id FROM public.auth_accounts a
      LEFT JOIN public.employees e ON e.id=a.employee_id WHERE a.role=$1
      AND (a.role='admin' OR e.is_active) AND (($1='admin' AND a.username=$2) OR ($1='employee' AND e.employee_code=$2))`,[role,login.trim()])).rows[0];
    // Equal-cost scrypt for unknown logins; this hash is never a usable account password.
    const candidate=account?.password_hash || `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
    const valid=await verifyPassword(password,candidate);
    if(!account || !valid) throw failure(401,'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิด');
    const result=await transaction(pool,async db=>{
      if(account.employee_id && !(await db.query('SELECT 1 FROM public.employees WHERE id=$1 AND is_active FOR SHARE',[account.employee_id])).rowCount) throw failure(401,'บัญชีพนักงานถูกปิดสถานะ');
      const current=(await db.query('SELECT password_hash,is_active FROM public.auth_accounts WHERE id=$1 FOR UPDATE',[account.id])).rows[0];
      if(!current?.is_active || current.password_hash!==account.password_hash) throw failure(401,'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกปิด');
      if(req.sessionHash) await db.query('DELETE FROM public.auth_sessions WHERE token_hash=$1',[req.sessionHash]);
      await db.query('DELETE FROM public.auth_sessions WHERE expires_at<=CURRENT_TIMESTAMP');
      await db.query('DELETE FROM public.auth_login_attempts WHERE attempt_key=$1 OR expires_at<=CURRENT_TIMESTAMP',[key]);
      return newSession(db,account.id);
    });
    sendSession(req,res,result);
  });
  app.post('/api/auth/logout',requireSession,async(req,res)=>{
    await pool.query('DELETE FROM public.auth_sessions WHERE token_hash=$1',[req.sessionHash]);
    res.clearCookie(cookieName,cookieOptions(req));res.json({data:{logged_out:true}});
  });
  app.post('/api/auth/password',requireSession,async(req,res)=>{
    const {current_password,new_password}=req.body || {};
    validatePassword(new_password);
    if(current_password===new_password) throw failure(400,'รหัสผ่านใหม่ต้องต่างจากรหัสผ่านเดิม');
    const hash=await hashPassword(new_password);
    const result=await transaction(pool,async db=>{
      const account=(await db.query('SELECT * FROM public.auth_accounts WHERE id=$1 FOR UPDATE',[req.auth.id])).rows[0];
      const session=(await db.query('SELECT 1 FROM public.auth_sessions WHERE token_hash=$1',[req.sessionHash])).rowCount;
      if(!session || !account?.is_active) throw failure(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      if(!await verifyPassword(current_password,account.password_hash)) throw failure(400,'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      await db.query('UPDATE public.auth_accounts SET password_hash=$1,must_change_password=false WHERE id=$2',[hash,account.id]);
      await db.query('DELETE FROM public.auth_sessions WHERE account_id=$1',[account.id]);
      return newSession(db,account.id);
    });
    sendSession(req,res,result);
  });
  app.get('/api/accounts',requireAdmin,async(req,res)=>{
    res.json({data:(await pool.query(`SELECT id,employee_id,is_active,must_change_password
      FROM public.auth_accounts WHERE role='employee' ORDER BY employee_id`)).rows});
  });
  const employeeId=req=>{
    if(!/^[1-9][0-9]*$/.test(req.params.id) || Number(req.params.id)>2147483647) throw failure(400,'รหัสพนักงานไม่ถูกต้อง');
    return Number(req.params.id);
  };
  app.post('/api/employees/:id/account',requireAdmin,async(req,res)=>{
    const id=employeeId(req);const hash=await hashPassword(req.body?.temporary_password);
    if(!(await pool.query('SELECT 1 FROM public.employees WHERE id=$1',[id])).rowCount) throw failure(404,'ไม่พบพนักงาน');
    try {
      const row=(await pool.query(`INSERT INTO public.auth_accounts(role,employee_id,password_hash)
        SELECT 'employee',$1,$2 FROM (SELECT id FROM public.employees WHERE id=$1 AND is_active FOR SHARE) AS active_employee RETURNING id,employee_id,is_active,must_change_password`,[id,hash])).rows[0];
      if(!row) throw failure(409,'พนักงานถูกปิดสถานะ ไม่สามารถสร้างบัญชีได้');
      res.status(201).json({data:row});
    } catch(e) { if(e.code==='23505') throw failure(409,'พนักงานคนนี้มีบัญชีอยู่แล้ว');throw e; }
  });
  app.post('/api/employees/:id/reset-password',requireAdmin,async(req,res)=>{
    const id=employeeId(req);const hash=await hashPassword(req.body?.temporary_password);
    const data=await transaction(pool,async db=>{
      if(!(await db.query('SELECT 1 FROM public.employees WHERE id=$1 AND is_active FOR SHARE',[id])).rowCount) throw failure(409,'พนักงานถูกปิดสถานะ ไม่สามารถเปิดบัญชีได้');
      const row=(await db.query(`UPDATE public.auth_accounts SET password_hash=$1,must_change_password=true,is_active=true
        WHERE employee_id=$2 AND role='employee' RETURNING id,employee_id,is_active,must_change_password`,[hash,id])).rows[0];
      if(!row) throw failure(404,'ยังไม่มีบัญชีพนักงาน');
      await db.query('DELETE FROM public.auth_sessions WHERE account_id=$1',[row.id]);return row;
    });
    res.json({data});
  });
  app.post('/api/employees/:id/disable-account',requireAdmin,async(req,res)=>{
    const id=employeeId(req);
    const data=await transaction(pool,async db=>{
      const row=(await db.query(`UPDATE public.auth_accounts SET is_active=false WHERE employee_id=$1 AND role='employee'
        RETURNING id,employee_id,is_active,must_change_password`,[id])).rows[0];
      if(!row) throw failure(404,'ยังไม่มีบัญชีพนักงาน');
      await db.query('DELETE FROM public.auth_sessions WHERE account_id=$1',[row.id]);return row;
    });
    res.json({data});
  });
  registerEmployeeSelfService(app,pool,requireEmployee);
  app.get('/api/me/work-logs',requireEmployee,async(req,res)=>{
    const month=req.query.month;
    if(typeof month!=='string' || !/^(20[0-9]{2}|21[0-9]{2})-(0[1-9]|1[0-2])$/.test(month)) throw failure(400,'กรุณาเลือกเดือนที่ถูกต้อง');
    const rows=(await pool.query(`SELECT id,employee_id,work_date::text,wage_multiplier,shift_type,regular_minutes,
      overtime_minutes,overtime_3x_minutes,meal_allowance FROM public.work_logs
      WHERE employee_id=$1 AND work_date>=$2::date AND work_date<($2::date+interval '1 month')
      ORDER BY work_date DESC,id DESC`,[req.auth.employee_id,`${month}-01`])).rows;
    res.json({data:rows});
  });
  const ownPayrollSQL=`SELECT p.id,p.period_name,p.payment_date::text,p.start_date::text,p.end_date::text,
    p.overtime_start_date::text,p.overtime_end_date::text,p.published_at,
    i.employee_id,i.employee_code_snapshot AS employee_code,i.full_name_snapshot AS full_name,
    i.pay_type_used,i.pay_rate_used,i.base_pay,i.overtime_15_pay,i.overtime_3_pay,i.meal_pay,i.shift_pay,i.gross_pay,i.recorded_days,i.overtime_15_minutes,i.overtime_3_minutes,i.overtime_total_minutes,COALESCE(i.overtime_total_pay,i.overtime_15_pay+i.overtime_3_pay) AS overtime_total_pay
    FROM public.payroll_periods p JOIN public.payroll_items i ON i.payroll_period_id=p.id
    WHERE i.employee_id=$1 AND p.saved_at IS NOT NULL AND p.published_at IS NOT NULL`;
  app.get('/api/me/payroll',requireEmployee,async(req,res)=>{
    res.json({data:(await pool.query(`${ownPayrollSQL} ORDER BY p.payment_date DESC,p.id DESC`,[req.auth.employee_id])).rows});
  });
  app.get('/api/me/payroll/:id',requireEmployee,async(req,res)=>{
    const id=employeeId(req);
    const row=(await pool.query(`${ownPayrollSQL} AND p.id=$2`,[req.auth.employee_id,id])).rows[0];
    if(!row) throw failure(404,'ไม่พบงวดที่เผยแพร่สำหรับคุณ');res.json({data:row});
  });
}
