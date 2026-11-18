import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base=process.env.PAYDAY_TEST_BASE_URL || 'http://127.0.0.1:5174';
assert.ok(process.env.PAYDAY_TEST_ADMIN_PASSWORD,'Use the isolated browser runner');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
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
 assert.deepEqual(errors,[]);
 await user.screenshot({path:'/tmp/payday-browser/attendance.png',fullPage:true});
 console.log('PASS attendance browser: built Express app, employment setup, edit OT in hours/meal refresh, paid and unpaid leave, history and cancellation');
} finally {await browser.close();}
