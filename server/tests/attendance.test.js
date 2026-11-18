import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../passwords.js';
import { runAttendanceJob } from '../attendance-job.js';
import { configureAttendance } from '../attendance.js';
import { bangkokToday } from '../work-logs.js';
import { periodDates, calculate } from '../payroll.js';
const target=process.env.TEST_DATABASE_URL;
if(!target || !/^payday[a-z0-9_]*_test[a-z0-9_]*$/.test(decodeURIComponent(new URL(target).pathname.slice(1)))) throw new Error('Isolated payday*_test* required');
process.env.DATABASE_URL=target;process.env.NODE_ENV='test';
const {pool}=await import('../db.js');const {app}=await import('../index.js');
const password=randomBytes(24).toString('base64url'),hash=await hashPassword(password);
const unpaid={daily_wage_fraction:0,monthly_deduction_divisor:30,meal_allowance:0};
const policy={sick:unpaid,personal:unpaid};
let server,base,admin,employee,other,e,m;
async function request(path,body,session=admin,method) {
 const r=await fetch(base+path,{method:method || (body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-PayDay-Request':'1',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const j=await r.json();return {status:r.status,...j,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(login,role='employee') {const r=await request('/auth/login',{role,login,password},null);assert.equal(r.status,200);return {cookie:r.cookie,csrf:r.data.csrf_token};}
const makeLog=(date,ot=0,extra={})=>request('/work-logs',{employee_id:e.id,work_date:date,regular_minutes:480,overtime_minutes:ot,overtime_3x_minutes:0,shift_type:'day',...extra});
const leave=(date,paid=false,type='sick',session=employee,extra={})=>request('/me/leaves',{work_date:date,paid,type,...extra},session);
const job=(date='2025-10-22T05:00:00Z')=>runAttendanceJob(pool,{now:new Date(date)});
async function automaticSetup() {
 process.env.PAYDAY_AUTO_ATTENDANCE='true';
 await pool.query(`UPDATE attendance_settings SET auto_enabled=true,start_date='2025-10-16',holiday_mode='skip',holiday_reviewed_through='2027-12-31'`);
}
before(async()=>{
 assert.equal((await pool.query('SELECT current_database() n')).rows[0].n,decodeURIComponent(new URL(target).pathname.slice(1)));
 for(const name of (await readdir(new URL('../migrations/',import.meta.url))).sort()) await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;
});
after(async()=>{delete process.env.PAYDAY_AUTO_ATTENDANCE;if(server)await new Promise(r=>server.close(r));await pool.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE attendance_audit,attendance_job_runs,attendance_holidays,auth_login_attempts,payroll_items,payroll_periods,work_logs,employees RESTART IDENTITY CASCADE');
 await pool.query(`UPDATE attendance_settings SET auto_enabled=false,start_date=NULL,holiday_mode=NULL,holiday_reviewed_through=NULL,leave_policy=$1,employee_can_choose_paid_leave=true`,[policy]);
 delete process.env.PAYDAY_AUTO_ATTENDANCE;
 await pool.query(`INSERT INTO auth_accounts(role,username,password_hash,must_change_password) VALUES('admin','attendance-admin',$1,false)`,[hash]);
 [e,m]=(await pool.query(`INSERT INTO employees(employee_code,full_name,pay_type,pay_rate,employment_start_date,auto_shift_type) VALUES
 ('D','Daily','daily',400,'2025-10-17','day'),('M','Monthly','monthly',30000,'2025-10-20','night') RETURNING *`)).rows;
 for(const row of [e,m])await pool.query(`INSERT INTO auth_accounts(role,employee_id,password_hash,must_change_password) VALUES('employee',$1,$2,false)`,[row.id,hash]);
 admin=await login('attendance-admin','admin');employee=await login('D');other=await login('M');
});

test('OT edits enforce owner, role, CSRF, minute validation and meal threshold; audit only allowed fields',async()=>{
 const row=(await makeLog('2025-10-18',0,{wage_multiplier:2})).data;
 const path=`/me/work-logs/${row.id}/overtime`;
 assert.equal((await request(path,{overtime_minutes:60,overtime_3x_minutes:0},null,'PATCH')).status,401);
 assert.equal((await request(path,{overtime_minutes:60,overtime_3x_minutes:0},other,'PATCH')).status,404);
 assert.equal((await request(`/work-logs/${row.id}/overtime`,{},employee,'PATCH')).status,403);
 assert.equal((await request(path,{overtime_minutes:60,overtime_3x_minutes:0},{...employee,csrf:'wrong'},'PATCH')).status,403);
 for(const [ot,triple] of [[-1,0],[60,61],[961,0],[0.5,0]]) assert.equal((await request(path,{overtime_minutes:ot,overtime_3x_minutes:triple},employee,'PATCH')).status,400);
 for(const [ot,meal] of [[29,'83.00'],[30,'166.00'],[60,'166.00'],[29,'83.00']]) {
  const r=await request(path,{overtime_minutes:ot,overtime_3x_minutes:0,password:'must-not-be-audited'},employee,'PATCH');
  assert.equal(r.status,200);assert.equal(r.data.meal_allowance,meal);assert.equal(r.data.wage_multiplier,2);
 }
 const audits=(await pool.query('SELECT * FROM attendance_audit')).rows;
 assert.equal(audits.length,4);assert.equal(audits[0].actor_account_id,(await pool.query('SELECT id FROM auth_accounts WHERE employee_id=$1',[e.id])).rows[0].id);
 assert.equal(audits[0].before_value.overtime_minutes,0);assert.equal(audits[0].after_value.overtime_minutes,29);
 assert.ok(audits[0].changed_at);assert.ok(!JSON.stringify(audits).includes('must-not-be-audited'));
});

test('both wage and OT windows lock employees; admin changes live source without changing published snapshots',async()=>{
 for(const date of ['2025-10-16','2025-10-17','2025-10-31','2025-11-16','2025-11-17'])await makeLog(date,60);
 const preview=(await request('/payroll/preview?month=2025-11')).data;
 const saved=(await request('/payroll/save',{month:'2025-11',preview_token:preview.preview_token})).data;
 await request(`/payroll/periods/${saved.period.id}/publish`,{});
 const snapshot=(await request(`/payroll/periods/${saved.period.id}`)).data;
 const logs=(await pool.query('SELECT id,work_date::text FROM work_logs WHERE employee_id=$1 ORDER BY work_date',[e.id])).rows;
 for(const log of logs) {
  const r=await request(`/me/work-logs/${log.id}/overtime`,{overtime_minutes:120,overtime_3x_minutes:30},employee,'PATCH');
  assert.equal(r.status,log.work_date==='2025-11-17'?200:409);
 }
 assert.equal((await leave('2025-10-20')).code,'PERIOD_CLOSED');
 assert.equal((await request(`/work-logs/${logs[0].id}/overtime`,{overtime_minutes:120,overtime_3x_minutes:0},admin,'PATCH')).status,200);
 assert.deepEqual((await request(`/payroll/periods/${saved.period.id}`)).data,snapshot);
});

test('automatic job catches up only weekdays since launch and employment dates; respects holiday, end date, inactive and missing setup',async()=>{
 await automaticSetup();
 await pool.query("UPDATE employees SET employment_end_date='2025-10-21' WHERE id=$1",[m.id]);
 await pool.query("INSERT INTO attendance_holidays VALUES('2025-10-21','company holiday')");
 await pool.query("INSERT INTO employees(employee_code,full_name,pay_type,pay_rate) VALUES('X','Unknown','daily',400)");
 await pool.query("INSERT INTO employees(employee_code,full_name,pay_type,pay_rate,employment_start_date,auto_shift_type,is_active) VALUES('I','Inactive','daily',400,'2025-10-01','day',false)");
 const r=await job();assert.equal(r.outcome,'incomplete_employee_setup');assert.equal(r.inserted,4);assert.equal(r.missing_employee_setup,1);
 const dates=(await pool.query('SELECT employee_id,work_date::text,regular_minutes,overtime_minutes,wage_multiplier,shift_type FROM work_logs ORDER BY employee_id,work_date')).rows;
 assert.deepEqual(dates.filter(l=>l.employee_id===e.id).map(l=>l.work_date),['2025-10-17','2025-10-20','2025-10-22']);
 assert.deepEqual(dates.filter(l=>l.employee_id===m.id).map(l=>l.work_date),['2025-10-20']);
 assert.ok(dates.every(l=>l.regular_minutes===480 && l.overtime_minutes===0 && l.wage_multiplier===1));
 assert.equal((await job()).inserted,0);
});

test('job concurrent retries and collision with manual work/leave never duplicate or overwrite',async()=>{
 await automaticSetup();
 await makeLog('2025-10-20',120,{shift_type:'night'});
 await leave('2025-10-21');
 await Promise.all([job(),job(),job(),makeLog('2025-10-22',60)]);
 assert.equal((await job()).inserted,0);
 assert.equal(Number((await pool.query('SELECT count(*) n FROM work_logs WHERE employee_id=$1 AND work_date=$2',[e.id,'2025-10-22'])).rows[0].n),1);
 const manual=(await pool.query("SELECT * FROM work_logs WHERE employee_id=$1 AND work_date='2025-10-20'",[e.id])).rows[0];
 assert.equal(manual.overtime_minutes,120);assert.equal(manual.shift_type,'night');assert.equal(manual.source,'manual');
 assert.equal((await pool.query("SELECT attendance_status FROM work_logs WHERE employee_id=$1 AND work_date='2025-10-21'",[e.id])).rows[0].attendance_status,'sick');
});

test('job serializes with leave conversion, preserves exactly one day and skips both closed windows',async()=>{
 await automaticSetup();
 await pool.query(`INSERT INTO payroll_periods(period_name,start_date,end_date,overtime_start_date,overtime_end_date,payment_date,saved_at)
 VALUES('frozen','2025-10-17','2025-11-16','2025-10-01','2025-10-31','2025-11-25',now())`);
 assert.equal((await job()).inserted,0);
 await pool.query('DELETE FROM payroll_periods');
 const [r]=await Promise.all([leave('2025-10-20'),job()]);assert.equal(r.status,201);
 assert.equal((await pool.query("SELECT count(*) n FROM work_logs WHERE employee_id=$1 AND work_date='2025-10-20'",[e.id])).rows[0].n,'1');
 assert.equal((await pool.query("SELECT attendance_status FROM work_logs WHERE employee_id=$1 AND work_date='2025-10-20'",[e.id])).rows[0].attendance_status,'sick');
});

test('paid/unpaid leaves are employee selectable, no meals or worked days; monthly unpaid deducts rate / 30',async()=>{
 assert.equal((await leave('2025-10-20',false,'sick')).status,201);
 assert.equal((await leave('2025-10-21',true,'personal')).status,201);
 assert.equal((await leave('2025-10-20',false,'sick',other)).status,201);
 assert.equal((await leave('2025-10-21',true,'personal',other)).status,201);
 const rows=await calculate(pool,periodDates('2025-11'));
 assert.deepEqual(rows.map(r=>[r.recorded_days,r.sick_days,r.personal_days,r.base_pay,r.meal_pay,r.shift_pay]),[[0,1,1,'400.00','0.00','0.00'],[0,1,1,'29000.00','0.00','0.00']]);
 const preview=(await request('/payroll/preview?month=2025-11')).data;
 const saved=(await request('/payroll/save',{month:'2025-11',preview_token:preview.preview_token})).data;
 assert.equal(saved.rows[0].sick_days,1);assert.equal(saved.rows[0].personal_days,1);
 const log=(await pool.query('SELECT id FROM work_logs WHERE employee_id=$1 LIMIT 1',[e.id])).rows[0];
 assert.equal((await request(`/me/leaves/${log.id}`,undefined,employee,'DELETE')).status,409);
});

test('leave is idempotent, converts auto in transaction, cancels/restores; manual or OT conflicts stay intact',async()=>{
 await automaticSetup();await job();
 const original=(await pool.query("SELECT *,work_date::text FROM work_logs WHERE employee_id=$1 AND work_date='2025-10-20'",[e.id])).rows[0];
 const results=await Promise.all([leave('2025-10-20'),leave('2025-10-20')]);assert.ok(results.every(r=>r.status===201));
 assert.equal(results[0].data.id,original.id);assert.equal(results[1].data.id,original.id);
 assert.equal((await request(`/me/leaves/${original.id}`,undefined,other,'DELETE')).status,404);
 const cancel=await request(`/me/leaves/${original.id}`,undefined,employee,'DELETE');assert.equal(cancel.status,200);assert.equal(cancel.data.source,'auto');assert.equal(cancel.data.shift_type,original.shift_type);assert.equal(cancel.data.meal_allowance,'83.00');
 await request(`/me/work-logs/${original.id}/overtime`,{overtime_minutes:60,overtime_3x_minutes:0},employee,'PATCH');
 assert.equal((await leave('2025-10-20')).code,'LEAVE_CONFLICT');
 const leaveRow=await leave('2025-10-23',false,'personal');assert.equal(leaveRow.status,201);
 const cancelled=await request(`/me/leaves/${leaveRow.data.id}`,undefined,employee,'DELETE');assert.equal(cancelled.data.cancelled,true);
 const audits=(await pool.query("SELECT action FROM attendance_audit WHERE work_log_id=$1",[leaveRow.data.id])).rows;assert.equal(audits.length,2);
});

test('policy gates, employment bounds, timezone boundary, closed end/start boundaries and double wage OT base',async()=>{
 assert.equal(bangkokToday(new Date('2025-10-31T16:59:59Z')),'2025-10-31');
 assert.equal(bangkokToday(new Date('2025-10-31T17:00:00Z')),'2025-11-01');
 assert.equal((await leave('2025-10-16')).status,400);assert.equal((await leave('2199-01-01')).status,400);
 await pool.query('UPDATE attendance_settings SET leave_policy=NULL');assert.equal((await leave('2025-10-20')).code,'LEAVE_POLICY_PENDING');
 await pool.query('UPDATE attendance_settings SET leave_policy=$1',[policy]);
 await makeLog('2025-10-18',120,{wage_multiplier:2});
 const r=(await calculate(pool,periodDates('2025-11'),e.id))[0];assert.equal(r.base_pay,'800.00');assert.equal(r.overtime_15_pay,'150.00');assert.equal(r.meal_pay,'166.00');
 assert.equal((await job()).outcome,'disabled');await automaticSetup();delete process.env.PAYDAY_AUTO_ATTENDANCE;assert.equal((await job()).outcome,'disabled');
 process.env.PAYDAY_AUTO_ATTENDANCE='true';await pool.query("UPDATE attendance_settings SET holiday_reviewed_through='2025-10-21'");await assert.rejects(()=>job(),/POLICY_PENDING/);
});

test('configuration cannot silently backfill before launch; calendar and attendance APIs require admin',async()=>{
 await assert.rejects(()=>configureAttendance(pool,{start_date:'2020-01-01'}),/วันนี้หรืออนาคต/);
 assert.equal((await request('/attendance/status',undefined,employee)).status,403);
 assert.equal((await request('/attendance/settings',{auto_enabled:true},employee,'PUT')).status,403);
 assert.equal((await request('/attendance/holidays/2025-12-05',{label:'holiday'},employee,'PUT')).status,403);
 assert.equal((await request('/attendance/holidays/2025-12-05',{label:'holiday'},admin,'PUT')).status,200);
 assert.equal((await request('/attendance/holidays/2025-12-05',{label:'new label'},admin,'PUT')).status,200);
 assert.equal((await request('/attendance/holidays/2025-12-05',undefined,admin,'DELETE')).status,200);
 const today=bangkokToday();
 await configureAttendance(pool,{start_date:today,holiday_mode:'skip',holiday_reviewed_through:'2199-12-31'});
 await configureAttendance(pool,{auto_enabled:true});await configureAttendance(pool,{auto_enabled:false});
 assert.equal((await pool.query('SELECT auto_enabled FROM attendance_settings')).rows[0].auto_enabled,false);
});

test('admin must review exact conflicting work before replacing it; stale confirmation and employee bypass fail; cancellation restores original work',async()=>{
 const original=(await makeLog('2025-10-18',120,{overtime_3x_minutes:30,shift_type:'night',wage_multiplier:2})).data;
 assert.equal((await request('/leaves',{employee_id:e.id,work_date:'2025-10-18',type:'sick',paid:false})).code,'LEAVE_CONFLICT');
 let review=(await request(`/attendance/day?employee_id=${e.id}&date=2025-10-18`)).data;
 assert.equal((await leave('2025-10-18',false,'sick',employee,{replace_work_token:review.replace_work_token})).code,'LEAVE_CONFLICT');
 await request(`/work-logs/${original.id}/overtime`,{overtime_minutes:180,overtime_3x_minutes:30},admin,'PATCH');
 assert.equal((await request('/leaves',{employee_id:e.id,work_date:'2025-10-18',type:'sick',paid:false,replace_work_token:review.replace_work_token})).code,'LEAVE_CONFLICT');
 review=(await request(`/attendance/day?employee_id=${e.id}&date=2025-10-18`)).data;
 const changed=await request('/leaves',{employee_id:e.id,work_date:'2025-10-18',type:'sick',paid:false,replace_work_token:review.replace_work_token});
 assert.equal(changed.status,201);assert.equal(changed.data.overtime_minutes,0);
 const restored=await request(`/leaves/${original.id}`,undefined,admin,'DELETE');
 assert.equal(restored.data.overtime_minutes,180);assert.equal(restored.data.overtime_3x_minutes,30);assert.equal(restored.data.shift_type,'night');assert.equal(restored.data.wage_multiplier,2);assert.equal(restored.data.source,'manual');
 assert.equal((await pool.query("SELECT count(*) n FROM attendance_audit WHERE action='confirmed_work_to_leave'")).rows[0].n,'1');
});

test('audit failure rolls OT back, including meal and source changes',async()=>{
 const original=(await makeLog('2025-10-20')).data;
 await pool.query(`CREATE OR REPLACE FUNCTION public.attendance_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test audit failure'; END$$;
 CREATE TRIGGER attendance_test_failure BEFORE INSERT ON public.attendance_audit FOR EACH ROW EXECUTE FUNCTION public.attendance_test_failure()`);
 try {
  assert.equal((await request(`/me/work-logs/${original.id}/overtime`,{overtime_minutes:120,overtime_3x_minutes:0},employee,'PATCH')).status,500);
  const row=(await pool.query('SELECT * FROM work_logs WHERE id=$1',[original.id])).rows[0];
  assert.equal(row.overtime_minutes,0);assert.equal(row.meal_allowance,'83.00');
 } finally {await pool.query('DROP TRIGGER attendance_test_failure ON attendance_audit; DROP FUNCTION attendance_test_failure()');}
});

test('job/save concurrency freezes source before snapshot or rejects stale preview, never backfills a closed report',async()=>{
 await automaticSetup();
 const preview=(await request('/payroll/preview?month=2025-11')).data;
 const [saved]=await Promise.all([request('/payroll/save',{month:'2025-11',preview_token:preview.preview_token}),job()]);
 assert.ok([201,409].includes(saved.status));
 let report=saved.data;
 if(saved.status===409) {
  const fresh=(await request('/payroll/preview?month=2025-11')).data;
  report=(await request('/payroll/save',{month:'2025-11',preview_token:fresh.preview_token})).data;
 }
 assert.ok(report.saved);
 const count=(await pool.query('SELECT count(*) n FROM work_logs')).rows[0].n;
 assert.equal((await job()).inserted,0);
 assert.equal((await pool.query('SELECT count(*) n FROM work_logs')).rows[0].n,count);
 assert.deepEqual((await request(`/payroll/periods/${report.period.id}`)).data,report);
});

test('migration repeat keeps old work, money and snapshots intact; unknown leave metrics remain null',async()=>{
 await makeLog('2025-10-18',120,{wage_multiplier:2});
 const preview=(await request('/payroll/preview?month=2025-11')).data;
 const saved=(await request('/payroll/save',{month:'2025-11',preview_token:preview.preview_token})).data;
 await pool.query('UPDATE payroll_items SET sick_days=NULL,personal_days=NULL WHERE payroll_period_id=$1',[saved.period.id]);
 const before=(await pool.query('SELECT * FROM payroll_items ORDER BY id')).rows;
 const work=(await pool.query('SELECT * FROM work_logs ORDER BY id')).rows;
 await pool.query(await readFile(new URL('../migrations/005_attendance.sql',import.meta.url),'utf8'));
 assert.deepEqual((await pool.query('SELECT * FROM payroll_items ORDER BY id')).rows,before);
 assert.deepEqual((await pool.query('SELECT * FROM work_logs ORDER BY id')).rows,work);
});

test('three times regular wage is limited to weekends/company holidays; OT still uses ordinary base rate',async()=>{
 assert.equal((await makeLog('2025-10-18',120,{wage_multiplier:3})).status,201);
 assert.equal((await makeLog('2025-10-20',120,{wage_multiplier:3})).status,400);
 assert.equal((await request('/attendance/holidays/2025-10-20',{label:'Company holiday'},admin,'PUT')).status,200);
 assert.equal((await makeLog('2025-10-20',120,{wage_multiplier:3})).status,201);
 const daily=(await calculate(pool,periodDates('2025-11'),e.id))[0];
 assert.equal(daily.base_pay,'2400.00');assert.equal(daily.overtime_15_pay,'300.00');
 assert.equal((await request('/work-logs',{employee_id:m.id,work_date:'2025-10-20',regular_minutes:480,overtime_minutes:120,overtime_3x_minutes:0,shift_type:'day',wage_multiplier:3})).status,201);
 const monthly=(await calculate(pool,periodDates('2025-11'),m.id))[0];assert.equal(monthly.base_pay,'30000.00');assert.equal(monthly.overtime_15_pay,'375.00');
});

test('legacy unsupported OT keeps original calculation and snapshot and requires review instead of automatic conversion',async()=>{
 const seed=async(employeeId)=>(await pool.query(`INSERT INTO work_logs(employee_id,work_date,regular_minutes,overtime_minutes,overtime_1x_minutes,overtime_2x_minutes,overtime_3x_minutes,shift_type,wage_multiplier,meal_allowance) VALUES($1,'2025-10-18',480,240,60,60,60,'day',3,166) RETURNING *`,[employeeId])).rows[0];
 const original={data:await seed(e.id)};
 assert.equal((await makeLog('2025-10-19',60,{overtime_1x_minutes:30,overtime_2x_minutes:31})).status,400);
 const daily=(await calculate(pool,periodDates('2025-11'),e.id))[0];
 assert.equal(daily.base_pay,'1200.00');assert.equal(daily.overtime_1_pay,'50.00');assert.equal(daily.overtime_15_pay,'75.00');assert.equal(daily.overtime_2_pay,'100.00');assert.equal(daily.overtime_3_pay,'150.00');assert.equal(daily.overtime_total_pay,'375.00');assert.equal(daily.overtime_total_minutes,240);
 await seed(m.id);
 const monthly=(await calculate(pool,periodDates('2025-11'),m.id))[0];assert.equal(monthly.base_pay,'30000.00');assert.equal(monthly.overtime_total_pay,'937.50');
 const preview=(await request('/payroll/preview?month=2025-11')).data;
 const saved=(await request('/payroll/save',{month:'2025-11',preview_token:preview.preview_token})).data;
 assert.equal(saved.rows[0].overtime_1_minutes,60);assert.equal(saved.rows[0].overtime_2_minutes,60);assert.equal(saved.rows[0].overtime_2_pay,'100.00');
 assert.equal((await request(`/work-logs/${original.data.id}/overtime`,{overtime_minutes:120,overtime_1x_minutes:0,overtime_2x_minutes:0,overtime_3x_minutes:0},admin,'PATCH')).status,409);
 assert.deepEqual((await request(`/payroll/periods/${saved.period.id}`)).data,saved);
 const before=(await pool.query('SELECT * FROM payroll_items ORDER BY id')).rows;
 await pool.query(await readFile(new URL('../migrations/006_premium_rates.sql',import.meta.url),'utf8'));
 assert.deepEqual((await pool.query('SELECT * FROM payroll_items ORDER BY id')).rows,before);
});

test('legacy closed period missing OT dates still protects canonical previous-month OT without changing its snapshot',async()=>{
 await makeLog('2025-10-16',60);
 const log=(await pool.query('SELECT id FROM work_logs WHERE employee_id=$1',[e.id])).rows[0];
 await pool.query(`INSERT INTO payroll_periods(period_name,start_date,end_date,saved_at)
 VALUES('legacy','2025-10-17','2025-11-16',now())`);
 assert.equal((await request(`/me/work-logs/${log.id}/overtime`,{overtime_minutes:120,overtime_3x_minutes:0},employee,'PATCH')).code,'PERIOD_CLOSED');
 await automaticSetup();assert.equal((await job()).inserted,0);
 const period=(await pool.query('SELECT overtime_start_date,overtime_end_date FROM payroll_periods')).rows[0];
 assert.equal(period.overtime_start_date,null);assert.equal(period.overtime_end_date,null);
});


test('30-minute meal boundary for admin and employee creates/edits counts total OT once including triple',async()=>{
 for(const [owner,session] of [[e,employee],[m,other]]) {
  for(const [day,minutes,meal] of [[23,29,'83.00'],[24,30,'166.00'],[25,60,'166.00']]) {
   const body={employee_id:owner.id,work_date:`2025-10-${day}`,regular_minutes:480,overtime_minutes:minutes,overtime_3x_minutes:minutes,shift_type:'day'};
   const created=owner===e?await request('/work-logs',body):await request('/me/work-logs',body,session);
   assert.equal(created.status,201);assert.equal(created.data.meal_allowance,meal);
   const prefix=owner===e?'':'/me';
   for(const [ot,expected] of [[29,'83.00'],[30,'166.00'],[60,'166.00'],[29,'83.00']]) {
    const edited=await request(`${prefix}/work-logs/${created.data.id}/overtime`,{overtime_minutes:ot,overtime_3x_minutes:ot},owner===e?admin:session,'PATCH');
    assert.equal(edited.status,200);assert.equal(edited.data.meal_allowance,expected);
   }
  }
 }
});

test('open payroll/accrual recalculates standard legacy meals without writes, preserves special meals/leaves and 17–16 window',async()=>{
 for(const [date,ot,meal] of [['2025-10-16',30,83],['2025-10-17',30,83],['2025-10-31',60,166],['2025-11-16',30,83],['2025-11-17',30,83],['2025-10-20',30,40],['2025-10-21',30,0],['2025-10-23',29,83]]) {
  await pool.query(`INSERT INTO work_logs(employee_id,work_date,regular_minutes,overtime_minutes,overtime_3x_minutes,shift_type,meal_allowance)
   VALUES($1,$2,480,$3,$3,'day',$4)`,[e.id,date,ot,meal]);
 }
 await leave('2025-10-22');
 const original=(await pool.query('SELECT * FROM work_logs ORDER BY id')).rows;
 const preview=(await request('/payroll/preview?month=2025-11')).data;
 const row=preview.rows.find(r=>r.employee_id===e.id);
 assert.equal(row.meal_pay,'621.00'); // Three eligible days, one 29-min day, and a special 40-baht day.
 const accrued=(await request('/me/accrued-income?month=2025-11',undefined,employee)).data.row;
 assert.deepEqual(accrued,row);
 assert.equal((await calculate(pool,periodDates('2025-12'),e.id))[0].meal_pay,'166.00');
 assert.equal((await calculate(pool,periodDates('2025-10'),e.id))[0].meal_pay,'166.00');
 assert.deepEqual((await pool.query('SELECT * FROM work_logs ORDER BY id')).rows,original);
 const saved=(await request('/payroll/save',{month:'2025-11',preview_token:preview.preview_token})).data;
 assert.equal(saved.rows.find(r=>r.employee_id===e.id).meal_pay,'621.00');
 assert.equal((await request('/me/accrued-income?month=2025-11',undefined,employee)).data.row.meal_pay,'621.00');
 assert.deepEqual((await pool.query('SELECT * FROM work_logs ORDER BY id')).rows,original);
});

test('old saved/published meal snapshots stay fixed while another open month gets 30-minute policy',async()=>{
 const work=(await makeLog('2025-10-17',30)).data;
 await pool.query('UPDATE work_logs SET meal_allowance=83 WHERE id=$1',[work.id]);
 const p=(await pool.query(`INSERT INTO payroll_periods(period_name,start_date,end_date,overtime_start_date,overtime_end_date,payment_date,saved_at,published_at)
  VALUES('old snapshot','2025-10-17','2025-11-16','2025-10-01','2025-10-31','2025-11-25',now(),now()) RETURNING id`)).rows[0];
 await pool.query(`INSERT INTO payroll_items(payroll_period_id,employee_id,employee_code_snapshot,full_name_snapshot,pay_type_used,pay_rate_used,base_pay,overtime_15_pay,overtime_3_pay,meal_pay,shift_pay)
  VALUES($1,$2,'D','Daily','daily',400,400,37.5,0,83,0)`,[p.id,e.id]);
 const frozen=(await request(`/payroll/periods/${p.id}`)).data;
 assert.equal((await request('/payroll/preview?month=2025-11')).data.rows[0].meal_pay,'83.00');
 assert.equal((await request('/me/accrued-income?month=2025-11',undefined,employee)).data.row.meal_pay,'166.00');
 const next=(await makeLog('2025-11-17',30)).data;
 await pool.query('UPDATE work_logs SET meal_allowance=83 WHERE id=$1',[next.id]);
 assert.equal((await request('/payroll/preview?month=2025-12')).data.rows[0].meal_pay,'166.00');
 assert.equal((await request(`/work-logs/${work.id}/overtime`,{overtime_minutes:29,overtime_3x_minutes:0},admin,'PATCH')).data.meal_allowance,'83.00');
 assert.equal((await request(`/work-logs/${work.id}/overtime`,{overtime_minutes:30,overtime_3x_minutes:0},admin,'PATCH')).data.meal_allowance,'166.00');
 assert.deepEqual((await request(`/payroll/periods/${p.id}`)).data,frozen);
 assert.equal((await request('/me/payroll',undefined,employee)).data[0].meal_pay,'83.00');
});


test('API accepts only 1.5/3 including 0.5 hours; rejects other rates/components on admin and employee create/edit',async()=>{
 for(const [rate,triple] of [[1.5,0],[3,30],['3.0',30]]) {
  const date=rate===1.5?'2025-10-23':rate===3?'2025-10-24':'2025-10-25';
  const body={employee_id:e.id,work_date:date,regular_minutes:480,overtime_minutes:30,overtime_3x_minutes:triple,overtime_rate:rate,shift_type:'day'};
  const result=await request('/me/work-logs',body,employee);assert.equal(result.status,201);assert.equal(result.data.meal_allowance,'166.00');
  for(const prefix of ['/me','']) {
   const session=prefix?employee:admin;
   for(const extra of [{overtime_rate:1},{overtime_rate:2},{overtime_rate:4},{overtime_rate:true},{overtime_1x_minutes:1},{overtime_2x_minutes:1}]) {
    const input={overtime_minutes:30,overtime_3x_minutes:0,...extra};
    assert.equal((await request(`${prefix}/work-logs`,{...body,...input,work_date:'2025-10-26'},session)).status,400);
    assert.equal((await request(`${prefix}/work-logs/${result.data.id}/overtime`,input,session,'PATCH')).status,400);
   }
  }
  for(const [minutes,meal] of [[29,'83.00'],[30,'166.00'],[60,'166.00']]) {
   const changed=await request(`/me/work-logs/${result.data.id}/overtime`,{overtime_minutes:minutes,overtime_3x_minutes:minutes,overtime_rate:3},employee,'PATCH');
   assert.equal(changed.status,200);assert.equal(changed.data.meal_allowance,meal);
  }
 }
});

test('legacy 1/2 OT cannot be silently converted even when zero components are requested',async()=>{
 const row=(await pool.query(`INSERT INTO work_logs(employee_id,work_date,regular_minutes,overtime_minutes,overtime_2x_minutes,overtime_3x_minutes,shift_type,meal_allowance)
 VALUES($1,'2025-10-20',480,30,30,0,'day',166) RETURNING *`,[e.id])).rows[0];
 for(const [prefix,session] of [['/me',employee],['',admin]]) {
  const result=await request(`${prefix}/work-logs/${row.id}/overtime`,{overtime_minutes:60,overtime_3x_minutes:60,overtime_rate:3,overtime_1x_minutes:0,overtime_2x_minutes:0},session,'PATCH');
  assert.equal(result.status,409);assert.equal(result.code,'LEGACY_OT_REVIEW_REQUIRED');
 }
 assert.deepEqual((await pool.query('SELECT * FROM work_logs WHERE id=$1',[row.id])).rows[0],row);
 assert.equal((await pool.query('SELECT count(*) n FROM attendance_audit')).rows[0].n,'0');
});
