import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { periodDates } from '../payroll.js';
import { hashPassword } from '../passwords.js';
import { randomBytes } from 'node:crypto';
const testPassword=randomBytes(24).toString('base64url');
const adminHash=await hashPassword(testPassword);

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; never run against payday_db');
const dbName = decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1));
if (!/^payday[a-z0-9_]*_test[a-z0-9_]*$/.test(dbName)) throw new Error('Tests require a payday*_test* database');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
const { pool } = await import('../db.js');
const { app } = await import('../index.js');
let server, base, cookie, csrf;
before(async () => {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, dbName);
  await pool.query(await readFile(new URL('../migrations/001_saved_reports.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/002_auth.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/003_employee_status.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../migrations/004_weekend_payroll_metrics.sql', import.meta.url), 'utf8'));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); });
beforeEach(async () => {
  await pool.query('TRUNCATE auth_login_attempts,payroll_items,payroll_periods,work_logs,employees RESTART IDENTITY CASCADE');
  await pool.query("INSERT INTO auth_accounts(role,username,password_hash,must_change_password) VALUES ('admin','test-admin',$1,false)",[adminHash]);
  const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-PayDay-Request':'1'},body:JSON.stringify({role:'admin',login:'test-admin',password:testPassword})});
  assert.equal(login.status,200);
  cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).data.csrf_token;
});
async function call(path, body, method = 'POST') {
  const r = await fetch(`${base}${path}`, {
    method:body===undefined ? 'GET' : method, headers: { 'Content-Type':'application/json','X-PayDay-Request':'1','X-CSRF-Token':csrf,Cookie:cookie },
    ...(body===undefined ? {} : {body:JSON.stringify(body)}),
  });
  return { status: r.status, ...(await r.json()) };
}
const employee = (code = 'D001', type = 'daily', rate = '800.00') => call('/employees', { employee_code: code, full_name: `ชื่อ ${code}`, pay_type: type, pay_rate: rate });
const log = (id, date, ot = 60, triple = 30, shift = 'night') => call('/work-logs', {
  employee_id: id, work_date: date, regular_minutes: 480, overtime_minutes: ot, overtime_3x_minutes: triple, shift_type: shift,
});

test('dates: November 2025, January rollover, leap year and invalid month', () => {
  const p = periodDates('2025-11');
  assert.deepEqual([p.start_date,p.end_date,p.overtime_start_date,p.overtime_end_date,p.payment_date],
    ['2025-10-17','2025-11-16','2025-10-01','2025-10-31','2025-11-25']);
  assert.equal(periodDates('2026-01').start_date, '2025-12-17');
  assert.equal(periodDates('2024-03').overtime_end_date, '2024-02-29');
  assert.throws(() => periodDates('2025-13'));
});
test('employee CRUD, ordered list, duplicate code and validation', async () => {
  const b = await employee('B'); const a = await employee('A', 'monthly', '24000.00');
  assert.equal(b.status,201); assert.equal(a.status,201);
  assert.equal((await employee('A')).status,409);
  assert.equal((await employee('BAD','daily','-1')).status,400);
  const edit = await call(`/employees/${b.data.id}`, { employee_code: 'C', full_name: 'ชื่อใหม่', pay_type: 'monthly', pay_rate: '30000.00' }, 'PUT');
  assert.equal(edit.status,200); assert.equal(edit.data.full_name,'ชื่อใหม่');
  assert.deepEqual((await call('/employees')).data.map(e => e.employee_code),['A','C']);
});
test('work logs: duplicate, invalid date, negative OT, triple subset, meal eligibility', async () => {
  const { data: e } = await employee();
  assert.equal((await log(e.id,'2025-10-17',60,61)).status,400);
  assert.equal((await log(e.id,'2025-10-17',-1,0)).status,400);
  assert.equal((await log(e.id,'2025-02-30')).status,400);
  assert.equal((await log(e.id,'2025-10-17',961,0)).status,400);
  assert.equal((await log(e.id,'2025-10-17',59,0)).data.meal_allowance,'83.00');
  assert.equal((await log(e.id,'2025-10-17')).status,409);
  assert.equal((await log(e.id,'2025-10-18')).data.meal_allowance,'166.00');
  assert.equal((await call('/work-logs')).data.length,2);
});
test('November boundaries, daily/monthly, OT 3x and meal not double counted', async () => {
  const { data: d } = await employee();
  const { data: m } = await employee('M001','monthly','24000.00');
  for (const date of ['2025-09-30','2025-10-01','2025-10-16','2025-10-17','2025-10-31','2025-11-01','2025-11-16','2025-11-17']) {
    assert.equal((await log(d.id,date)).status,201);
    assert.equal((await log(m.id,date)).status,201);
  }
  const preview = await call('/payroll/preview?month=2025-11');
  assert.equal(preview.status,200);
  for (const row of preview.data.rows) {
    // Four wage/meal/shift dates, four OT dates. Hourly rate is 100 for both types.
    assert.equal(row.base_pay,row.pay_type_used === 'daily' ? '3200.00' : '24000.00');
    assert.equal(row.overtime_15_pay,'300.00'); assert.equal(row.overtime_3_pay,'600.00');
    assert.equal(row.meal_pay,'664.00'); assert.equal(row.shift_pay,'600.00');
    assert.equal(row.gross_pay,row.pay_type_used === 'daily' ? '5364.00' : '26164.00');
  }
});
test('save requires reviewed current preview; concurrent/repeated save is idempotent; frozen reports', async () => {
  const { data: e } = await employee(); await log(e.id,'2025-10-17');
  const preview = (await call('/payroll/preview?month=2025-11')).data;
  assert.equal((await call('/payroll/save',{ month:'2025-11' })).status,409);
  const body = { month:'2025-11',preview_token:preview.preview_token };
  const [first,second] = await Promise.all([call('/payroll/save',body),call('/payroll/save',body)]);
  assert.deepEqual([first.status,second.status].sort(),[200,201]);
  assert.deepEqual(first.data,second.data);
  const id = first.data.period.id;
  const edited = await call(`/employees/${e.id}`,{ employee_code:'NEW',full_name:'เปลี่ยนชื่อ',pay_type:'daily',pay_rate:'999.00' },'PUT');
  assert.equal(edited.status,200); await log(e.id,'2025-11-16');
  const report = (await call(`/payroll/periods/${id}`)).data;
  assert.deepEqual(report,first.data);
  assert.deepEqual((await call('/payroll/save',body)).data,first.data);
  assert.equal((await call('/payroll/periods')).data.length,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll_items')).rows[0].n,1);
  assert.equal((await call('/payroll/preview?month=2025-11')).data.saved,true);
});
test('reject stale preview after source changes', async () => {
  const { data: e } = await employee();
  const preview = (await call('/payroll/preview?month=2025-11')).data;
  await log(e.id,'2025-10-17');
  const r = await call('/payroll/save',{ month:'2025-11',preview_token:preview.preview_token });
  assert.equal(r.status,409);
  assert.equal((await call('/payroll/periods')).data.length,0);
});
test('ambiguous legacy partial days block calculation instead of guessing', async () => {
  const { data: e } = await employee(); await log(e.id,'2025-10-17');
  await pool.query('UPDATE work_logs SET regular_minutes=240 WHERE employee_id=$1',[e.id]);
  assert.equal((await call('/payroll/preview?month=2025-11')).status,422);
});
test('migration is repeatable, preserves legacy amounts and snapshots existing names', async () => {
  const { data: e } = await employee();
  const p = (await pool.query(`INSERT INTO payroll_periods(period_name,start_date,end_date,payment_date)
    VALUES ('legacy','2025-09-17','2025-10-16','2025-10-25') RETURNING id`)).rows[0];
  await pool.query('ALTER TABLE payroll_items ALTER COLUMN employee_code_snapshot DROP NOT NULL, ALTER COLUMN full_name_snapshot DROP NOT NULL');
  await pool.query(`INSERT INTO payroll_items(payroll_period_id,employee_id,
    pay_type_used,pay_rate_used,base_pay,overtime_15_pay,overtime_3_pay,meal_pay,shift_pay)
    VALUES ($1,$2,'daily',800,800,0,0,83,0)`,[p.id,e.id]);
  const sql = await readFile(new URL('../migrations/001_saved_reports.sql',import.meta.url),'utf8');
  await pool.query(sql); await pool.query(sql);
  const r = await call(`/payroll/periods/${p.id}`);
  assert.equal(r.status,200); assert.equal(r.data.rows[0].gross_pay,'883.00');
  assert.equal(r.data.rows[0].full_name,'ชื่อ D001');
  await pool.query("UPDATE employees SET full_name='changed' WHERE id=$1",[e.id]);
  await pool.query(sql);
  assert.deepEqual((await call(`/payroll/periods/${p.id}`)).data,r.data);
});
test('save rolls back whole period when any item insert fails', async () => {
  await employee('D001'); await employee('D002');
  await pool.query(`CREATE FUNCTION public.test_reject_item() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.employee_code_snapshot='D002' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
  await pool.query('CREATE TRIGGER test_reject BEFORE INSERT ON payroll_items FOR EACH ROW EXECUTE FUNCTION test_reject_item()');
  try {
    const p = (await call('/payroll/preview?month=2025-11')).data;
    assert.equal((await call('/payroll/save',{month:'2025-11',preview_token:p.preview_token})).status,500);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll_items')).rows[0].n,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payroll_periods')).rows[0].n,0);
  } finally {
    await pool.query('DROP TRIGGER test_reject ON payroll_items');
    await pool.query('DROP FUNCTION public.test_reject_item()');
  }
});


test('weekend daily wage, distinct days, monthly unchanged, weekday and future rejection', async () => {
  const { data: e } = await employee('W', 'daily', '400.00');
  const body = { employee_id:e.id, work_date:'2025-10-18', regular_minutes:480,
    overtime_minutes:120, overtime_3x_minutes:30, shift_type:'night', wage_multiplier:2 };
  assert.equal((await call('/work-logs', body)).status,201);
  assert.equal((await call('/work-logs', {...body, work_date:'2025-10-20'})).status,400);
  assert.equal((await call('/work-logs', {...body, wage_multiplier:3})).status,400);
  assert.equal((await call('/work-logs', {...body, work_date:'2199-01-01', wage_multiplier:1})).status,400);
  const row=(await call('/payroll/preview?month=2025-11')).data.rows[0];
  assert.equal(row.base_pay,'800.00'); assert.equal(row.recorded_days,1);
  assert.equal(row.overtime_total_minutes,120);
  assert.equal(row.overtime_15_minutes,90); assert.equal(row.overtime_3_minutes,30);
  assert.equal(row.overtime_15_pay,'112.50'); assert.equal(row.overtime_3_pay,'75.00');
  assert.equal(row.overtime_total_pay,'187.50');
  assert.equal(row.meal_pay,'166.00'); assert.equal(row.shift_pay,'150.00');
  assert.equal((await call('/work-logs')).data[0].wage_multiplier,2);
  const {data:m}=await employee('M', 'monthly', '24000.00');
  assert.equal((await call('/work-logs',{...body, employee_id:m.id})).status,201);
  const monthly=(await call('/payroll/preview?month=2025-11')).data.rows.find(r=>r.employee_id===m.id);
  assert.equal(monthly.base_pay,'24000.00'); assert.equal(monthly.recorded_days,1);
});

test('16/17 wage boundary and 2h OT at daily 400 pays 150 next month; snapshots freeze metrics', async () => {
  const {data:e}=await employee('W','daily','400.00');
  for(const date of ['2025-10-16','2025-10-17']) assert.equal((await log(e.id,date,0,0,'day')).status,201);
  assert.equal((await log(e.id,'2025-11-01',120,0,'day')).status,201);
  const october=(await call('/payroll/preview?month=2025-10')).data.rows[0];
  const november=(await call('/payroll/preview?month=2025-11')).data.rows[0];
  assert.equal(october.recorded_days,1); assert.equal(october.base_pay,'400.00');
  assert.equal(november.recorded_days,2); assert.equal(november.base_pay,'800.00');
  assert.equal(november.overtime_total_minutes,0);
  const preview=(await call('/payroll/preview?month=2025-12')).data;
  assert.equal(preview.period.payment_date,'2025-12-25');
  assert.equal(preview.rows[0].overtime_total_minutes,120);
  assert.equal(preview.rows[0].overtime_total_pay,'150.00');
  const saved=(await call('/payroll/save',{month:'2025-12',preview_token:preview.preview_token})).data;
  assert.equal(saved.rows[0].overtime_total_pay,'150.00');
  assert.equal(saved.rows[0].overtime_total_minutes,120);
  await pool.query('UPDATE work_logs SET overtime_minutes=0 WHERE employee_id=$1',[e.id]);
  assert.deepEqual((await call(`/payroll/periods/${saved.period.id}`)).data,saved);
});

test('new migration is repeatable and leaves legacy report metrics unknown', async () => {
  const {data:e}=await employee();
  await log(e.id,'2025-10-18',0,0,'day');
  const p=(await pool.query(`INSERT INTO payroll_periods(period_name,start_date,end_date,saved_at)
    VALUES('old','2025-10-17','2025-11-16',now()) RETURNING id`)).rows[0];
  await pool.query(`INSERT INTO payroll_items(payroll_period_id,employee_id,employee_code_snapshot,full_name_snapshot,
    pay_type_used,pay_rate_used,base_pay,overtime_15_pay,overtime_3_pay,meal_pay,shift_pay)
    VALUES($1,$2,'D001','old','daily',800,800,150,0,83,0)`,[p.id,e.id]);
  const sql=await readFile(new URL('../migrations/004_weekend_payroll_metrics.sql',import.meta.url),'utf8');
  await pool.query(sql); await pool.query(sql);
  const row=(await call(`/payroll/periods/${p.id}`)).data.rows[0];
  assert.equal(row.recorded_days,null); assert.equal(row.overtime_total_minutes,null);
  assert.equal(row.overtime_total_pay,'150.00'); assert.equal(row.overtime_15_pay,'150.00');
  assert.equal((await call('/work-logs')).data[0].wage_multiplier,1);
  await assert.rejects(pool.query("UPDATE work_logs SET wage_multiplier=2,work_date='2025-10-20' WHERE employee_id=$1",[e.id]));
});
