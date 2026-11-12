import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../passwords.js';
import { createFirstAdmin } from '../auth.js';
import { bangkokToday } from '../work-logs.js';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required');
const name=decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1));
if(!/^payday[a-z0-9_]*_test[a-z0-9_]*$/.test(name)) throw new Error('Only payday*_test* databases allowed');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.NODE_ENV='test';
const {pool}=await import('../db.js'); const {app}=await import('../index.js');
const password=randomBytes(24).toString('base64url'); const hash=await hashPassword(password);
const temp=randomBytes(24).toString('base64url'), permanent=randomBytes(24).toString('base64url');
let server,base,admin,a,b;
async function request(path,body,session,method) {
 const r=await fetch(`${base}${path}`,{method:method || (body===undefined?'GET':'POST'),
  headers:{'Content-Type':'application/json','X-PayDay-Request':'1',...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}: {})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=await r.json();return {status:r.status,...json,cookie:r.headers.get('set-cookie')?.split(';')[0],setCookie:r.headers.get('set-cookie')};
}
async function login(login,password,role='employee') {
 const r=await request('/auth/login',{login,password,role});
 return {...r,csrf:r.data?.csrf_token};
}
before(async()=>{
 assert.equal((await pool.query('SELECT current_database() AS n')).rows[0].n,name);
 for(const f of ['001_saved_reports.sql','002_auth.sql','003_employee_status.sql'])await pool.query(await readFile(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
beforeEach(async()=>{
 await pool.query('TRUNCATE auth_login_attempts,payroll_items,payroll_periods,work_logs,employees RESTART IDENTITY CASCADE');
 await pool.query("INSERT INTO auth_accounts(role,username,password_hash,must_change_password) VALUES('admin','test-admin',$1,false)",[hash]);
 admin=await login('test-admin',password,'admin');assert.equal(admin.status,200);
 const make=async(code,rate)=> (await request('/employees',{employee_code:code,full_name:`ชื่อ ${code}`,pay_type:'daily',pay_rate:rate},admin)).data;
 a=await make('A','800.00');b=await make('B','1000.00');
});
async function account(e){return request(`/employees/${e.id}/account`,{temporary_password:temp},admin);}
async function ready(e){await account(e);const s=await login(e.employee_code,temp);return request('/auth/password',{current_password:temp,new_password:permanent},s).then(r=>({...r,csrf:r.data?.csrf_token}));}
async function save(){
 for(const e of [a,b])await request('/work-logs',{employee_id:e.id,work_date:'2026-10-17',regular_minutes:480,overtime_minutes:60,overtime_3x_minutes:30,shift_type:'night'},admin);
 const preview=(await request('/payroll/preview?month=2026-11',undefined,admin)).data;
 return (await request('/payroll/save',{month:'2026-11',preview_token:preview.preview_token},admin)).data;
}

test('passwords are salted scrypt hashes; first admin has no default and cannot be bootstrapped twice',async()=>{
 assert.equal(await verifyPassword(password,hash),true);assert.equal(await verifyPassword('incorrect',hash),false);
 assert.notEqual(await hashPassword(password),hash);
 await assert.rejects(()=>hashPassword('abc'));
 await assert.rejects(()=>createFirstAdmin(pool,'another-admin',password),/มี admin แล้ว/);
 await pool.query("DELETE FROM auth_sessions; DELETE FROM auth_accounts WHERE role='admin'");
 const user=await createFirstAdmin(pool,'first-admin',password);assert.equal(user.username,'first-admin');
 assert.equal((await login('first-admin',password,'admin')).status,200);
});
test('every management endpoint denies anonymous and employee callers, including direct writes',async()=>{
 const s=await ready(a);
 const endpoints=[[`/employees/${b.id}/deletion-check`],[`/employees/${b.id}`,{},'DELETE'],[`/employees/${b.id}/deactivate`,{}],['/employees'],[`/employees/${b.id}`],['/work-logs'],['/payroll/preview?month=2026-11'],['/payroll/periods'],['/payroll/periods/1'],['/accounts'],['/health/db'],
 ['/employees',{}],[`/employees/${b.id}`,{},'PUT'],['/work-logs',{}],['/payroll/save',{}],['/payroll/periods/1/publish',{}],
 [`/employees/${b.id}/account`,{}],[`/employees/${b.id}/reset-password`,{}],[`/employees/${b.id}/disable-account`,{}]];
 for(const [path,body,method] of endpoints){
  assert.equal((await request(path,body,undefined,method)).status,401,`anonymous ${path}`);
  const r=await request(path,body,s,method);assert.equal(r.status,403,`employee ${path}`);assert.equal(r.code,'FORBIDDEN');
 }
});
test('temporary password gates every data API and change rotates session; expired and tampered sessions fail',async()=>{
 await account(a);const s=await login('A',temp);assert.equal(s.data.user.must_change_password,true);
 assert.match(s.setCookie,/HttpOnly/);assert.match(s.setCookie,/SameSite=Lax/);assert.doesNotMatch(s.setCookie,/; Secure/);
 for(const path of ['/me/work-logs?month=2026-10','/me/payroll','/me/payroll/1','/employees']){
  const r=await request(path,undefined,s);assert.equal(r.status,403);assert.equal(r.code,'PASSWORD_CHANGE_REQUIRED');
 }
 assert.equal((await request('/auth/password',{current_password:'wrong',new_password:permanent},s)).status,400);
 assert.equal((await request('/auth/password',{current_password:temp,new_password:temp},s)).status,400);
 const changed=await request('/auth/password',{current_password:temp,new_password:permanent},s);
 assert.equal(changed.status,200);assert.notEqual(changed.cookie,s.cookie);
 assert.equal((await request('/auth/session',undefined,s)).status,401);
 const current={cookie:changed.cookie,csrf:changed.data.csrf_token};
 assert.equal((await request('/me/payroll',undefined,current)).status,200);
 assert.equal((await request('/auth/session',undefined,{cookie:'payday_sid=forged'})).status,401);
 await pool.query('UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP-interval \'1 second\' WHERE account_id=$1',[changed.data.user.id]);
 assert.equal((await request('/auth/session',undefined,current)).status,401);
});
test('employee ownership comes from session even if IDs are forged; unpublished and another-only periods stay hidden',async()=>{
 const sa=await ready(a),sb=await ready(b);const saved=await save();const id=saved.period.id;
 assert.deepEqual((await request('/me/payroll',undefined,sa)).data,[]);
 assert.equal((await request(`/me/payroll/${id}`,undefined,sa)).status,404);
 const logs=(await request(`/me/work-logs?month=2026-10&employee_id=${b.id}`,undefined,sa)).data;
 assert.equal(logs.length,1);assert.equal(logs[0].employee_id,a.id);
 assert.deepEqual((await request('/me/work-logs?month=2026-11',undefined,sa)).data,[]);
 const published=await request(`/payroll/periods/${id}/publish`,{},admin);assert.equal(published.status,200);
 const repeat=await request(`/payroll/periods/${id}/publish`,{},admin);
 assert.equal(repeat.data.period.published_at,published.data.period.published_at);
 for(const [s,e,gross]of [[sa,a,'1341.00'],[sb,b,'1597.25']]){
  const rows=(await request(`/me/payroll?employee_id=${e.id===a.id?b.id:a.id}`,undefined,s)).data;
  assert.equal(rows.length,1);assert.equal(rows[0].employee_id,e.id);assert.equal(rows[0].gross_pay,gross);
  const detail=(await request(`/me/payroll/${id}?employee_id=999`,undefined,s)).data;
  assert.equal(detail.employee_id,e.id);
 }
 // A period containing only B must not disclose its metadata or amounts to A.
 const other=(await pool.query(`INSERT INTO payroll_periods(period_name,start_date,end_date,payment_date,saved_at,published_at)
  VALUES('B only','2026-11-17','2026-12-16','2026-12-25',now(),now()) RETURNING id`)).rows[0];
 await pool.query(`INSERT INTO payroll_items(payroll_period_id,employee_id,employee_code_snapshot,full_name_snapshot,
  pay_type_used,pay_rate_used,base_pay,overtime_15_pay,overtime_3_pay,meal_pay,shift_pay)
  VALUES($1,$2,'B','ชื่อ B','daily',1000,1000,0,0,0,0)`,[other.id,b.id]);
 assert.equal((await request(`/me/payroll/${other.id}`,undefined,sa)).status,404);
 assert.equal((await request(`/me/payroll/${other.id}`,undefined,sb)).status,200);
 const before=(await request(`/me/payroll/${id}`,undefined,sa)).data;
 await request(`/employees/${a.id}`,{employee_code:'A-new',full_name:'เปลี่ยนแล้ว',pay_type:'daily',pay_rate:'9999.00'},admin,'PUT');
 await pool.query('UPDATE work_logs SET meal_allowance=0 WHERE employee_id=$1',[a.id]);
 assert.deepEqual((await request(`/me/payroll/${id}`,undefined,sa)).data,before);
 assert.equal((await login('A',permanent)).status,401);assert.equal((await login('A-new',permanent)).status,200);
});
test('logout invalidates captured cookie; reset and disable revoke ALL sessions and force a new password',async()=>{
 let sa=await ready(a);const second=await login('A',permanent),third=await login('A',permanent);
 assert.equal((await request('/auth/logout',{},sa)).status,200);
 assert.equal((await request('/me/payroll',undefined,sa)).status,401);
 assert.equal((await request('/me/payroll',undefined,second)).status,200);
 const reset=await request(`/employees/${a.id}/reset-password`,{temporary_password:temp},admin);assert.equal(reset.status,200);
 assert.equal((await request('/me/payroll',undefined,second)).status,401);
 assert.equal((await request('/me/payroll',undefined,third)).status,401);
 assert.equal((await login('A',permanent)).status,401);
 sa=await login('A',temp);assert.equal(sa.data.user.must_change_password,true);
 assert.equal((await request('/me/payroll',undefined,sa)).status,403);
 const pendingSecond=await login('A',temp);
 const disabled=await request(`/employees/${a.id}/disable-account`,{},admin);assert.equal(disabled.status,200);
 assert.equal((await request('/auth/session',undefined,sa)).status,401);
 assert.equal((await request('/auth/session',undefined,pendingSecond)).status,401);
 assert.equal((await login('A',temp)).status,401);
 await request(`/employees/${a.id}/reset-password`,{temporary_password:permanent},admin);
 assert.equal((await login('A',permanent)).data.user.must_change_password,true);
});
test('CSRF, secure cookie on HTTPS, duplicate account, invalid month, no hash/token leakage',async()=>{
 await account(a);assert.equal((await account(a)).status,409);
 const stored=(await pool.query('SELECT password_hash FROM auth_accounts WHERE employee_id=$1',[a.id])).rows[0].password_hash;
 assert.notEqual(stored,temp);assert.equal(await verifyPassword(temp,stored),true);
 const accounts=(await request('/accounts',undefined,admin)).data;
 assert.ok(!JSON.stringify(accounts).includes('password_hash'));
 const r=await fetch(`${base}/employees`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:admin.cookie},body:'{}'});
 assert.equal(r.status,403);
 const forged={...admin,csrf:'forged'};assert.equal((await request('/payroll/save',{},forged)).code,'CSRF_REJECTED');
 const s=await ready(b);assert.equal((await request('/me/work-logs?month=2026-13',undefined,s)).status,400);
 app.set('trust proxy',1);
 try {
  const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-PayDay-Request':'1','X-Forwarded-Proto':'https'},body:JSON.stringify({role:'admin',login:'test-admin',password})});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/; Secure/);
 } finally {app.set('trust proxy',false);}
 const sessions=(await pool.query('SELECT token_hash FROM auth_sessions')).rows;
 assert.ok(sessions.every(row=>/^[a-f0-9]{64}$/.test(row.token_hash)));
 assert.ok(!sessions.some(row=>admin.cookie.endsWith(row.token_hash)));
});
test('login throttles repeated wrong passwords and never reveals whether account exists',async()=>{
 let message;
 for(let i=0;i<10;i++){
  const r=await login('unknown-user','wrong-password');assert.equal(r.status,401);message=r.message;
 }
 assert.equal((await login('unknown-user','wrong-password')).status,429);
 const known=await login('test-admin','wrong-password','admin');assert.equal(known.message,message);
});

test('forged account ID cannot change another employee password; only saved periods can be published',async()=>{
 const sa=await ready(a),sb=await ready(b),newPassword=randomBytes(24).toString('base64url');
 const r=await request('/auth/password',{current_password:permanent,new_password:newPassword,account_id:sb.data.user.id,employee_id:b.id},sa);
 assert.equal(r.status,200);assert.equal(r.data.user.employee_id,a.id);
 assert.equal((await login('B',permanent)).status,200);
 assert.equal((await login('A',permanent)).status,401);
 const p=(await pool.query("INSERT INTO payroll_periods(period_name,start_date,end_date) VALUES('draft','2026-10-17','2026-11-16') RETURNING id")).rows[0];
 assert.equal((await request(`/payroll/periods/${p.id}/publish`,{},admin)).status,404);
 assert.equal((await pool.query('SELECT published_at FROM payroll_periods WHERE id=$1',[p.id])).rows[0].published_at,null);
});

test('4-character passwords work for first admin, employee creation, reset and change; 3 are rejected',async()=>{
 const four=randomBytes(2).toString('hex');
 const next=four.slice(0,3)+(four[3]==='0'?'1':'0');
 await assert.rejects(()=>createFirstAdmin(pool,'short-admin',four.slice(0,3)),/4–128/);
 await pool.query("DELETE FROM auth_accounts WHERE role='admin'");
 await createFirstAdmin(pool,'short-admin',four);
 admin=await login('short-admin',four,'admin');assert.equal(admin.status,200);
 const endpoint=`/employees/${a.id}`;
 assert.equal((await request(`${endpoint}/account`,{temporary_password:four.slice(0,3)},admin)).status,400);
 assert.equal((await request(`${endpoint}/account`,{temporary_password:four},admin)).status,201);
 const s=await login('A',four);assert.equal(s.status,200);
 assert.equal((await request('/auth/password',{current_password:four,new_password:next.slice(0,3)},s)).status,400);
 const changed=await request('/auth/password',{current_password:four,new_password:next},s);
 assert.equal(changed.status,200);assert.equal((await login('A',next)).status,200);
 const active={cookie:changed.cookie,csrf:changed.data.csrf_token};
 assert.equal((await request(`${endpoint}/reset-password`,{temporary_password:four.slice(0,3)},admin)).status,400);
 assert.equal((await request('/auth/session',undefined,active)).status,200);
 assert.equal((await request(`${endpoint}/reset-password`,{temporary_password:four},admin)).status,200);
 assert.equal((await login('A',four)).status,200);
 assert.equal(await verifyPassword(password,hash),true); // Existing longer hashes remain valid.
 await assert.rejects(()=>hashPassword('a'.repeat(129)),/4–128/);
 assert.equal(await verifyPassword('a'.repeat(128),await hashPassword('a'.repeat(128))),true);
});

test('admin permanently deletes only employees with no account, work or payroll references',async()=>{
 assert.equal((await request(`/employees/${b.id}/deletion-check`,undefined,admin)).data.can_delete,true);
 assert.equal((await request(`/employees/${b.id}`,{},admin,'DELETE')).status,200);
 assert.equal((await request(`/employees/${b.id}`,undefined,admin)).status,404);
 await account(a);
 const blocked=await request(`/employees/${a.id}`,{},admin,'DELETE');
 assert.equal(blocked.status,409);assert.equal(blocked.code,'EMPLOYEE_HAS_HISTORY');
 assert.equal((await request(`/employees/${a.id}`,undefined,admin)).status,200);
});
test('work-only and payroll-only references independently prevent deletion',async()=>{
 await request('/work-logs',{employee_id:a.id,work_date:'2026-10-17',regular_minutes:480,overtime_minutes:0,overtime_3x_minutes:0,shift_type:'day'},admin);
 assert.equal((await request(`/employees/${a.id}`,{},admin,'DELETE')).status,409);
 await save(); // B now has a saved item; remove its test work to isolate the payroll FK.
 await pool.query('DELETE FROM work_logs WHERE employee_id=$1',[b.id]);
 const check=(await request(`/employees/${b.id}/deletion-check`,undefined,admin)).data;
 assert.equal(check.has_payroll,true);assert.equal(check.has_work_logs,false);assert.equal(check.has_account,false);
 assert.equal((await request(`/employees/${b.id}`,{},admin,'DELETE')).status,409);
});
test('deactivation revokes sessions, blocks new work/account reset and preserves searchable history and saved payroll',async()=>{
 const employee=await ready(a),second=await login('A',permanent);
 const saved=await save();const before=(await request(`/payroll/periods/${saved.period.id}`,undefined,admin)).data;
 const r=await request(`/employees/${a.id}/deactivate`,{},admin);assert.equal(r.status,200);assert.equal(r.data.is_active,false);
 assert.equal((await request(`/employees/${a.id}/deactivate`,{},admin)).status,200);
 assert.equal((await request('/me/payroll',undefined,employee)).status,401);
 assert.equal((await request('/auth/session',undefined,second)).status,401);
 assert.equal((await login('A',permanent)).status,401);
 assert.equal((await request(`/employees/${a.id}/reset-password`,{temporary_password:temp},admin)).status,409);
 const work=await request('/work-logs',{employee_id:a.id,work_date:'2026-11-01',regular_minutes:480,overtime_minutes:60,overtime_3x_minutes:0,shift_type:'day'},admin);
 assert.equal(work.status,409);
 const history=await request(`/work-logs?employee_id=${a.id}&month=2026-10`,undefined,admin);
 assert.equal(history.status,200);assert.equal(history.data.length,1);assert.equal(history.data[0].employee_id,a.id);
 assert.deepEqual((await request(`/payroll/periods/${saved.period.id}`,undefined,admin)).data,before);
 assert.equal((await request('/employees',undefined,admin)).data.find(e=>e.id===a.id).is_active,false);
 for(let i=0;i<2;i++)await pool.query(await readFile(new URL('../migrations/003_employee_status.sql',import.meta.url),'utf8'));
 assert.equal((await request(`/employees/${a.id}`,undefined,admin)).data.is_active,false);
 assert.equal((await request('/work-logs?month=2026-13',undefined,admin)).status,400);
 assert.equal((await request('/work-logs?employee_id=bad',undefined,admin)).status,400);
 await request(`/employees/${b.id}/deactivate`,{},admin);
 assert.equal((await request(`/employees/${b.id}/account`,{temporary_password:temp},admin)).status,409);
});

const fullDay=(date,extra={})=>({work_date:date,regular_minutes:480,overtime_minutes:0,overtime_3x_minutes:0,shift_type:'day',...extra});
const offsetDate=(date,days)=>new Date(new Date(`${date}T00:00:00Z`).getTime()+days*86400000).toISOString().slice(0,10);
test('Bangkok date boundary is independent of host timezone',()=>{
 assert.equal(bangkokToday(new Date('2026-11-11T16:59:59.999Z')),'2026-11-11');
 assert.equal(bangkokToday(new Date('2026-11-11T17:00:00.000Z')),'2026-11-12');
});
test('employee self logging accepts today/past, rejects future and forged owner, validates OT and gates temporary passwords',async()=>{
 await account(a);const temporary=await login('A',temp);
 assert.equal((await request('/me/work-logs',fullDay(bangkokToday()),temporary)).status,403);
 assert.equal((await request('/me/accrued-income?month=2026-12',undefined,temporary)).status,403);
 const change=await request('/auth/password',{current_password:temp,new_password:permanent},temporary);
 const s={cookie:change.cookie,csrf:change.data.csrf_token};
 const today=bangkokToday(),yesterday=offsetDate(today,-1),tomorrow=offsetDate(today,1);
 assert.equal((await request('/me/work-logs',fullDay(tomorrow,{today:tomorrow,employee_id:b.id}),s)).status,400);
 for(const extra of [{overtime_minutes:-1},{overtime_minutes:30,overtime_3x_minutes:31},{overtime_minutes:1.5},{regular_minutes:240},{overtime_minutes:961}])
  assert.equal((await request('/me/work-logs',fullDay(today,extra),s)).status,400);
 const row=await request('/me/work-logs',fullDay(today,{employee_id:b.id,overtime_minutes:120,overtime_3x_minutes:30,shift_type:'night'}),s);
 assert.equal(row.status,201);assert.equal(row.data.employee_id,a.id);assert.equal(row.data.meal_allowance,'166.00');
 assert.equal((await request('/me/work-logs',fullDay(yesterday),s)).status,201);
 assert.equal((await request('/me/work-logs',fullDay(today),s)).status,409);
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM work_logs WHERE employee_id=$1',[b.id])).rows[0].n,0);
 assert.equal((await request('/me/work-logs',fullDay(today))).status,401);
 assert.equal((await request('/me/work-logs',fullDay(today),admin)).status,403);
});
test('admin/employee concurrent work submission creates exactly one employee/date record',async()=>{
 const s=await ready(a),date=bangkokToday();
 const results=await Promise.all([request('/me/work-logs',fullDay(date),s),request('/work-logs',{...fullDay(date),employee_id:a.id},admin)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM work_logs WHERE employee_id=$1 AND work_date=$2',[a.id,date])).rows[0].n,1);
});
test('accrued income: five 500-baht days plus prior-month OT 600 = 3100 before allowances; same Admin formula and own scope',async()=>{
 await request(`/employees/${a.id}`,{employee_code:'A',full_name:'ชื่อ A',pay_type:'daily',pay_rate:'500.00'},admin,'PUT');
 const s=await ready(a);
 const write=async(date,extra={})=>assert.equal((await request('/work-logs',{...fullDay(date,extra),employee_id:a.id},admin)).status,201);
 for(const date of ['2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21'])await write(date);
 await write('2026-11-01',{overtime_minutes:384});
 const data=(await request(`/me/accrued-income?month=2026-12&employee_id=${b.id}`,undefined,s)).data;
 assert.equal(data.row.employee_id,a.id);assert.equal(data.row.recorded_days,5);
 assert.equal(data.row.base_pay,'2500.00');assert.equal(data.row.overtime_15_pay,'600.00');
 assert.equal(Number(data.row.base_pay)+Number(data.row.overtime_15_pay),3100);
 assert.equal(data.row.meal_pay,'415.00');assert.equal(data.row.gross_pay,'3515.00');
 const p=data.period;assert.deepEqual([p.start_date,p.end_date,p.overtime_start_date,p.overtime_end_date,p.payment_date],['2026-11-17','2026-12-16','2026-11-01','2026-11-30','2026-12-25']);
 const adminRow=(await request('/payroll/preview?month=2026-12',undefined,admin)).data.rows.find(r=>r.employee_id===a.id);
 assert.deepEqual(data.row,adminRow);
 assert.equal((await request('/me/accrued-income?month=bad',undefined,s)).status,400);
 assert.equal((await request('/me/accrued-income?month=2026-12')).status,401);
});
test('wage day 16/17 and OT month end/day 1 belong to distinct periods including January rollover',async()=>{
 const s=await ready(a);
 for(const date of ['2026-11-16','2026-11-17','2026-11-30','2026-12-01','2026-12-16','2026-12-17'])
  assert.equal((await request('/work-logs',{employee_id:a.id,...fullDay(date,{overtime_minutes:60,overtime_3x_minutes:30})},admin)).status,201);
 const get=async month=>(await request(`/me/accrued-income?month=${month}`,undefined,s)).data;
 const november=await get('2026-11'),december=await get('2026-12'),january=await get('2027-01');
 assert.equal(november.row.recorded_days,1);assert.equal(november.row.base_pay,'800.00');assert.equal(november.row.overtime_3_pay,'0.00');
 assert.equal(december.row.recorded_days,4);assert.equal(december.row.base_pay,'3200.00');
 assert.equal(december.row.overtime_15_pay,'225.00');assert.equal(december.row.overtime_3_pay,'450.00');
 assert.equal(january.row.recorded_days,1);assert.equal(january.row.base_pay,'800.00');
 assert.equal(january.row.overtime_15_pay,'225.00');assert.equal(january.row.overtime_3_pay,'450.00');
 assert.equal(january.period.overtime_start_date,'2026-12-01');assert.equal(january.period.payment_date,'2027-01-25');
});
test('self logging updates live accrual while published payroll remains frozen',async()=>{
 const s=await ready(a);const saved=await save();
 await request(`/payroll/periods/${saved.period.id}/publish`,{},admin);
 const old=(await request(`/me/payroll/${saved.period.id}`,undefined,s)).data;
 const before=(await request('/me/accrued-income?month=2026-11',undefined,s)).data.row;
 assert.equal((await request('/me/work-logs',fullDay('2026-10-18'),s)).status,201);
 const after=(await request('/me/accrued-income?month=2026-11',undefined,s)).data.row;
 assert.equal(after.recorded_days,before.recorded_days+1);
 assert.equal(Number(after.base_pay),Number(before.base_pay)+800);
 assert.equal(Number(after.meal_pay),Number(before.meal_pay)+83);
 assert.deepEqual((await request(`/me/payroll/${saved.period.id}`,undefined,s)).data,old);
});
test('monthly accrual keeps full monthly rate; another employee invalid work cannot leak or block own income',async()=>{
 await request(`/employees/${a.id}`,{employee_code:'A',full_name:'ชื่อ A',pay_type:'monthly',pay_rate:'24000.00'},admin,'PUT');
 const s=await ready(a);
 await request('/work-logs',{employee_id:b.id,...fullDay('2026-11-17')},admin);
 await pool.query('UPDATE work_logs SET regular_minutes=240 WHERE employee_id=$1',[b.id]);
 const data=(await request('/me/accrued-income?month=2026-12',undefined,s)).data;
 assert.equal(data.row.recorded_days,0);assert.equal(data.row.base_pay,'24000.00');assert.equal(data.row.employee_id,a.id);
});

test('unknown API GET/POST are JSON 404 for anonymous, admin and employee; known API still enforces roles',async()=>{
 const employee=await ready(a);
 for(const session of [undefined,admin,employee]){
  for(const [path,body]of [['/does-not-exist'],['/payroll/does-not-exist'],['/does-not-exist',{}]]){
   const r=await request(path,body,session);assert.equal(r.status,404,path);assert.match(r.message,/ไม่พบ API/);
  }
 }
 const bare=await fetch(`${base}/does-not-exist`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(bare.status,404);
 assert.equal((await request('/employees')).status,401);
 assert.equal((await request('/employees',undefined,employee)).status,403);
});
