import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base=process.env.PAYDAY_TEST_BASE_URL || 'http://127.0.0.1:5174';
assert.ok(process.env.PAYDAY_TEST_ADMIN_PASSWORD,'Use the isolated browser runner');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
async function assertCurrentOtUi(page, history=false) {
 if(history) await page.getByRole('columnheader',{name:'OT รวม (ชั่วโมง)',exact:true}).waitFor();
 else await page.getByText('ชั่วโมง OT 1.5 เท่า',{exact:true}).first().waitFor();
 const labels=await page.locator('th, dt, label, option').allTextContents();
 assert.ok(labels.every(label=>!/OT [12] เท่า/.test(label)),'No unsupported OT column, summary card, input or option');
 if(history) assert.deepEqual((await page.getByRole('columnheader').allTextContents()).filter(label=>label.startsWith('OT ')),['OT รวม (ชั่วโมง)','OT 1.5 เท่า (ชั่วโมง)','OT 3.0 เท่า (ชั่วโมง)']);
}

async function pageFor(){const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));return page;}
async function login(page,login,password,role){
 await page.goto(base);
 await page.getByLabel('ประเภทบัญชี',{exact:true}).selectOption(role);
 await page.getByLabel(role==='admin'?'ชื่อผู้ดูแลระบบ':'รหัสพนักงาน',{exact:true}).fill(login);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
}
async function api(page,path,body,method='POST') {
 const session=(await (await page.request.get(base+'/api/auth/session')).json()).data;
 const r=await page.request.fetch(base+'/api'+path,{method,headers:{'X-PayDay-Request':'1','X-CSRF-Token':session.csrf_token},...(body?{data:body}:{})});
 const json=await r.json();assert.ok(r.ok(),`${path}: ${json.message}`);return json.data;
}
try {
 const admin=await pageFor();await login(admin,process.env.PAYDAY_TEST_ADMIN_LOGIN || 'browser-admin',process.env.PAYDAY_TEST_ADMIN_PASSWORD,'admin');
 await admin.getByRole('heading',{name:'จัดการเงินเดือน',exact:true}).waitFor();
 // Verify the backend's actual database before any data writes.
 const info=await (await admin.request.get(base+'/api/health/db')).json();assert.match(info.database,/^payday[a-z0-9_]*_test[a-z0-9_]*$/);
 const code='ATT'+randomBytes(4).toString('hex'),temp=randomBytes(8).toString('hex'),permanent=randomBytes(8).toString('hex');
 const employee=await api(admin,'/employees',{employee_code:code,full_name:'Attendance browser',pay_type:'daily',pay_rate:'400.00'});
 await api(admin,`/employees/${employee.id}/account`,{temporary_password:temp});
 await admin.reload();
 await admin.getByRole('button',{name:'วันทำงาน / วันหยุด',exact:true}).click();
 await admin.getByLabel('ตั้งค่าการจ้างของพนักงาน').selectOption(String(employee.id));
 await admin.getByLabel('วันเริ่มงานจริง').fill('2020-01-01');
 await admin.getByLabel('กะสำหรับงานอัตโนมัติ').selectOption('day');
 await admin.getByRole('button',{name:'บันทึกช่วงการจ้างและกะ',exact:true}).click();
 await admin.getByRole('status').filter({hasText:'บันทึกแล้ว'}).waitFor();
 // A separate past month keeps these editable fixtures outside reports saved by the older browser suites.
 const date='2025-06-03';
 const yesterday=new Date(`${date}T00:00:00Z`);yesterday.setUTCDate(yesterday.getUTCDate()-1);const leaveDate=yesterday.toISOString().slice(0,10);
 await api(admin,'/work-logs',{employee_id:employee.id,work_date:date,regular_minutes:480,overtime_minutes:0,overtime_3x_minutes:0,shift_type:'day'});
 const user=await pageFor();await login(user,code,temp,'employee');
 await user.getByLabel('รหัสผ่านปัจจุบัน',{exact:true}).fill(temp);await user.getByLabel('รหัสผ่านใหม่',{exact:true}).fill(permanent);await user.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill(permanent);
 await user.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();
 await user.getByRole('heading',{name:'ข้อมูลของฉัน',exact:true}).waitFor();
 await user.getByRole('button',{name:'ประวัติการทำงาน',exact:true}).click();
 await user.getByLabel('เดือนที่ทำงาน',{exact:true}).fill(date.slice(0,7));
 await assertCurrentOtUi(user,true);
 await user.getByRole('button',{name:'แก้ไข OT',exact:true}).click();
 assert.deepEqual(await user.getByLabel('อัตรา OT',{exact:true}).locator('option').allTextContents(),['1.5 เท่า','3.0 เท่า']);
 await user.getByLabel('OT รวม',{exact:true}).fill('1.5');await user.getByLabel('อัตรา OT',{exact:true}).selectOption('3');
 const [edit]=await Promise.all([user.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/overtime')),user.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click()]);assert.equal(edit.status(),200);assert.equal((await edit.json()).data.overtime_3x_minutes,90);
 await user.getByRole('cell',{name:'1.5 ชม.',exact:true}).first().waitFor();await user.getByRole('cell',{name:'166.00',exact:true}).waitFor();
 for(const [hours,minutes,meal] of [[String(29/60),29,'83.00'],['0.5',30,'166.00'],['1',60,'166.00'],[String(29/60),29,'83.00']]) {
  await user.getByRole('button',{name:'แก้ไข OT',exact:true}).click();
  await user.getByLabel('OT รวม',{exact:true}).fill(hours);
  await user.getByLabel('อัตรา OT',{exact:true}).selectOption('3');
  await user.getByText(`ค่าอาหารหลังแก้: ${meal} บาท`,{exact:false}).waitFor();
  const [changed]=await Promise.all([user.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/overtime')),user.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click()]);
  const data=(await changed.json()).data;
  assert.equal(changed.status(),200);assert.equal(data.overtime_minutes,minutes);assert.equal(data.overtime_3x_minutes,minutes);assert.equal(data.meal_allowance,meal);
  await user.getByRole('cell',{name:meal,exact:true}).waitFor();
 }
 await user.getByRole('button',{name:'ลงวันลา',exact:true}).click();
 await user.getByLabel('วันที่ลา',{exact:true}).fill(leaveDate);await user.getByLabel('ค่าแรงวันลา').selectOption('true');
 const [leave]=await Promise.all([user.waitForResponse(r=>r.url().endsWith('/me/leaves')&&r.request().method()==='POST'),user.getByRole('button',{name:'บันทึกวันลา',exact:true}).click()]);assert.equal(leave.status(),201);
 await user.getByRole('button',{name:'ประวัติการทำงาน',exact:true}).click();
 await user.getByRole('cell',{name:'ลาป่วย (ได้เงิน)',exact:true}).waitFor();
 await user.getByRole('button',{name:'แก้ไขวันลา',exact:true}).click();
 await user.getByLabel('ค่าแรงวันลา').selectOption('false');
 await user.getByRole('button',{name:'บันทึกการแก้ไข',exact:true}).click();
 await user.getByRole('cell',{name:'ลาป่วย (ไม่ได้เงิน)',exact:true}).waitFor();
 await user.getByRole('button',{name:'แก้ไขวันลา',exact:true}).click();
 await user.getByRole('button',{name:'ยกเลิกวันลา',exact:true}).click();
 await user.getByRole('cell',{name:'ลาป่วย (ไม่ได้เงิน)',exact:true}).waitFor({state:'detached'});
 // Check the administrator's actual history and creation form too.
 await admin.getByRole('button',{name:'บันทึกการทำงาน',exact:true}).click();
 await admin.getByLabel('พนักงานสำหรับค้นประวัติ',{exact:true}).selectOption(String(employee.id));
 await admin.getByLabel('เดือนประวัติ',{exact:true}).fill('2025-06');
 await admin.getByRole('button',{name:'ค้นประวัติ',exact:true}).click();
 await admin.getByRole('button',{name:'แก้ไข OT',exact:true}).waitFor();
 await assertCurrentOtUi(admin,true);
 await admin.screenshot({path:'/tmp/payday-browser/ot-history-admin.png',fullPage:true});
 await user.screenshot({path:'/tmp/payday-browser/ot-history-employee.png',fullPage:true});
 await user.getByRole('button',{name:'รายได้สะสมของฉัน',exact:true}).click();
 await user.getByLabel('เดือนจ่ายสำหรับยอดสะสม',{exact:true}).fill('2025-06');
 await user.getByRole('region',{name:'รายได้สะสมของฉัน',exact:true}).getByText('งวดจ่าย',{exact:false}).first().waitFor();
 await assertCurrentOtUi(user);
 // Seed exactly one legacy row only in the verified isolated test DB. Never use application writes to bypass the rate policy.
 assert.ok(process.env.TEST_DATABASE_URL);
 const dbName=decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1));
 assert.match(dbName,/^payday[a-z0-9_]*_test[a-z0-9_]*$/);assert.equal(info.database,dbName);
 const {default:pg}=await import('pg');const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 try {
  assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name,dbName);
  const legacy=(await db.query(`INSERT INTO work_logs(employee_id,work_date,regular_minutes,overtime_minutes,overtime_2x_minutes,overtime_3x_minutes,shift_type,meal_allowance)
   VALUES($1,'2025-06-04',480,60,60,0,'day',166) RETURNING *`,[employee.id])).rows[0];
  await user.getByRole('button',{name:'ประวัติการทำงาน',exact:true}).click();
  await user.getByText('พบข้อมูล OT อัตราเดิมอื่น 1 รายการทำงาน',{exact:false}).waitFor();
  await assertCurrentOtUi(user,true);
  await user.getByRole('button',{name:'รายได้สะสมของฉัน',exact:true}).click();
  await user.getByLabel('เดือนจ่ายสำหรับยอดสะสม',{exact:true}).fill('2025-07');
  await user.getByText('พบข้อมูล OT อัตราเดิมอื่น 1 รายการพนักงาน',{exact:false}).waitFor();
  await assertCurrentOtUi(user);
  await admin.getByRole('button',{name:'ค้นประวัติ',exact:true}).click();
  await admin.getByText('พบข้อมูล OT อัตราเดิมอื่น 1 รายการทำงาน',{exact:false}).waitFor();
  await assertCurrentOtUi(admin,true);
  await admin.getByRole('button',{name:'คำนวณเงินเดือน',exact:true}).click();
  await admin.getByLabel('เดือนจ่าย (จ่ายวันที่ 25)').fill('2025-07');
  await admin.getByRole('button',{name:'คำนวณ / เปิดงวด',exact:true}).click();
  await admin.getByRole('button',{name:'ตรวจยอดแล้ว — บันทึกงวดนี้',exact:false}).waitFor();
  await assertCurrentOtUi(admin);
  const preview=await api(admin,'/payroll/preview?month=2025-07',undefined,'GET');
  const saved=await api(admin,'/payroll/save',{month:'2025-07',preview_token:preview.preview_token});
  const frozen=await api(admin,`/payroll/periods/${saved.period.id}/publish`,{});
  const originalItems=(await db.query('SELECT * FROM payroll_items WHERE payroll_period_id=$1 ORDER BY id',[saved.period.id])).rows;
  await admin.getByRole('button',{name:'รายงานที่บันทึก',exact:true}).click();
  await admin.getByLabel('งวดที่บันทึกแล้ว').selectOption(String(saved.period.id));
  await admin.getByRole('heading',{name:/รายงานที่บันทึกแล้ว/}).waitFor();
  await assertCurrentOtUi(admin);
  await user.getByRole('button',{name:'เงินเดือนของฉัน',exact:true}).click();
  await user.getByLabel('งวดเงินเดือนของฉัน',{exact:true}).selectOption(String(saved.period.id));
  await user.getByRole('heading',{name:/เงินเดือนงวดจ่าย/}).waitFor();
  await assertCurrentOtUi(user);
  assert.deepEqual(await api(admin,`/payroll/periods/${saved.period.id}`,undefined,'GET'),frozen);
  assert.deepEqual((await db.query('SELECT * FROM payroll_items WHERE payroll_period_id=$1 ORDER BY id',[saved.period.id])).rows,originalItems);
  assert.deepEqual((await db.query('SELECT * FROM work_logs WHERE id=$1',[legacy.id])).rows[0],legacy);
 } finally {await db.end();}
 assert.deepEqual(errors,[]);
 await user.screenshot({path:'/tmp/payday-browser/attendance.png',fullPage:true});
 console.log('PASS attendance browser: built Express app, employment setup, edit OT in hours/meal refresh, paid and unpaid leave, both-role history/metrics without OT 1/2, legacy warning and unchanged source/snapshot');
} finally {await browser.close();}
