import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base=process.env.PAYDAY_TEST_BASE_URL || 'http://127.0.0.1:5174';
const adminPassword=process.env.PAYDAY_TEST_ADMIN_PASSWORD;
assert.ok(adminPassword,'Use run-browser-tests.js with an isolated test database');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
const newPage=async()=>{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));return page;
};
async function login(page,code,password,role='employee'){
 await page.goto(base);
 await page.getByRole('heading',{name:'เข้าสู่ระบบ',exact:true}).waitFor();
 await page.getByLabel('ประเภทบัญชี',{exact:true}).selectOption(role);
 await page.getByLabel(role==='admin'?'ชื่อผู้ดูแลระบบ':'รหัสพนักงาน',{exact:true}).fill(code);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 const [r]=await Promise.all([page.waitForResponse(r=>r.url().includes('/api/auth/login')&&r.request().method()==='POST'),page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click()]);
 assert.equal(r.status(),200);
}
async function get(page,path){const r=await page.request.get(`${base}/api${path}`);return{status:r.status(),...(await r.json())};}
async function change(page,current,password){
 await page.getByRole('heading',{name:'เปลี่ยนรหัสผ่านชั่วคราว',exact:true}).waitFor();
 await page.getByLabel('รหัสผ่านปัจจุบัน',{exact:true}).fill(current);
 await page.getByLabel('รหัสผ่านใหม่',{exact:true}).fill(password.slice(0,3));
 assert.equal(await page.getByLabel('รหัสผ่านใหม่',{exact:true}).evaluate(e=>e.checkValidity()),false);
 await page.getByLabel('รหัสผ่านใหม่',{exact:true}).fill(password);
 await page.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill(password);
 const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/auth/password')),page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่'}).click()]);
 assert.equal(r.status(),200);
 await page.getByRole('heading',{name:'ข้อมูลของฉัน',exact:true}).waitFor();
}
try {
 const admin=await newPage();await login(admin,'browser-admin',adminPassword,'admin');
 await admin.getByRole('heading',{name:'เพิ่มพนักงาน',exact:true}).waitFor();
 assert.match((await get(admin,'/health/db')).database,/^payday[a-z0-9_]*_test[a-z0-9_]*$/);
 const employees=(await get(admin,'/employees')).data;
 const ids=Object.fromEntries(employees.map(e=>[e.employee_code,e.id]));
 let period=(await get(admin,'/payroll/periods')).data.find(p=>p.payment_date==='2026-11-25');
 assert.ok(period);assert.equal(period.published_at,null);
 const users=[];
 for(const [code,expected]of [['UI001','2,157.91'],['UI002','24,991.00']]){
  const temp=randomBytes(2).toString('hex'),password=temp.slice(0,3)+(temp[3]==='0'?'1':'0');
  await admin.getByLabel('เลือกพนักงานสำหรับบัญชี',{exact:true}).selectOption(String(ids[code]));
  await admin.getByLabel('รหัสผ่านชั่วคราว',{exact:true}).fill(temp.slice(0,3));
  assert.equal(await admin.getByLabel('รหัสผ่านชั่วคราว',{exact:true}).evaluate(e=>e.checkValidity()),false);
  await admin.getByLabel('รหัสผ่านชั่วคราว',{exact:true}).fill(temp);
  const [created]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith(`/api/employees/${ids[code]}/account`)),admin.getByRole('button',{name:'สร้างบัญชีพนักงาน',exact:true}).click()]);
  assert.equal(created.status(),201);
  const page=await newPage();await login(page,code,temp);
  const forced=await get(page,'/me/payroll');assert.equal(forced.status,403);assert.equal(forced.code,'PASSWORD_CHANGE_REQUIRED');
  await change(page,temp,password);
  const other=code==='UI001'?ids.UI002:ids.UI001;
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/me/work-logs?month=2026-10')),page.getByLabel('เดือนที่ทำงาน',{exact:true}).fill('2026-10')]);
  await page.getByRole('cell',{name:'31 ตุลาคม 2569',exact:true}).waitFor();
  assert.equal(await page.locator('tbody tr').count(),4);
  assert.equal(await page.getByRole('cell',{name:'8 ชม.',exact:true}).count(),4);
  const own=(await get(page,`/me/work-logs?month=2026-10&employee_id=${other}`)).data;
  assert.equal(own.length,4);assert.ok(own.every(r=>r.employee_id===ids[code]));
  assert.equal((await get(page,`/employees/${other}`)).status,403);
  assert.equal((await get(page,`/payroll/periods/${period.id}`)).status,403);
  await page.getByRole('button',{name:'เงินเดือนของฉัน',exact:true}).click();
  await page.getByText('ยังไม่มีงวดเงินเดือนที่เผยแพร่สำหรับคุณ',{exact:true}).waitFor();
  assert.deepEqual((await get(page,'/me/payroll')).data,[]);
  assert.equal((await get(page,`/me/payroll/${period.id}`)).status,404);
  if(code==='UI002') {
   await page.getByRole('button',{name:'ประวัติการทำงาน',exact:true}).click();
   await Promise.all([page.waitForResponse(r=>r.url().includes('/api/me/work-logs?month=2027-02')),page.getByLabel('เดือนที่ทำงาน',{exact:true}).fill('2027-02')]);
   const row=page.locator('tbody tr').filter({hasText:'1 กุมภาพันธ์ 2570'});await row.waitFor();
   assert.equal(await row.locator('td').nth(2).innerText(),'8 ชม.');
   assert.equal(await row.locator('td').nth(3).innerText(),'2 ชม.');
   assert.equal(await row.locator('td').nth(4).innerText(),'0.25 ชม.');
  }
  users.push({code,temp,password,page,expected});
 }
 // Save a new December period AFTER both employee accounts have completed password setup.
 await admin.getByRole('button',{name:'คำนวณเงินเดือน',exact:true}).click();
 await admin.getByLabel('เดือนจ่าย (จ่ายวันที่ 25)').fill('2026-12');
 await admin.getByRole('button',{name:'คำนวณ / เปิดงวด',exact:true}).click();
 await admin.getByRole('button',{name:'ตรวจยอดแล้ว — บันทึกงวดนี้',exact:true}).waitFor();
 const [saved]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith('/api/payroll/save')),admin.getByRole('button',{name:'ตรวจยอดแล้ว — บันทึกงวดนี้',exact:true}).click()]);
 assert.equal(saved.status(),201);period=(await saved.json()).data.period;
 for(const user of users){
  assert.deepEqual((await get(user.page,'/me/payroll')).data,[]);
  assert.equal((await get(user.page,`/me/payroll/${period.id}`)).status,404);
 }
 await admin.getByRole('button',{name:'รายงานที่บันทึก',exact:true}).click();
 await admin.locator('select option').filter({hasText:'25 ธันวาคม 2569'}).waitFor({state:'attached'});
 await admin.locator('select').selectOption(String(period.id));
 const [published]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith(`/api/payroll/periods/${period.id}/publish`)),admin.getByRole('button',{name:'เผยแพร่งวด',exact:true}).click()]);
 assert.equal(published.status(),200);
 await admin.getByText('เผยแพร่ให้พนักงานแล้ว',{exact:true}).waitFor();
 for(const user of users){
  await user.page.getByRole('button',{name:'ประวัติการทำงาน',exact:true}).click();
  await user.page.getByRole('button',{name:'เงินเดือนของฉัน',exact:true}).click();
  await user.page.getByRole('heading',{name:'เงินเดือนงวดจ่าย 25 ธันวาคม 2569',exact:true}).waitFor();
  const gross=user.page.locator('dl > div').filter({has:user.page.locator('dt',{hasText:'รายได้รวม'})});
  assert.match(await gross.innerText(),new RegExp(user.expected.replace(/[.,]/g,'\\$&')));
  const rows=(await get(user.page,'/me/payroll?employee_id=99999')).data;
  assert.equal(rows.length,1);assert.equal(rows[0].employee_id,ids[user.code]);
  const cookies=await user.page.context().cookies();assert.ok(cookies.find(c=>c.name==='payday_sid').httpOnly);
 }
 await users[0].page.screenshot({path:'/tmp/payday-browser/employee-payroll.png',fullPage:true});
 await users[1].page.setViewportSize({width:390,height:844});
 await users[1].page.evaluate(()=>document.fonts.ready);
 await users[1].page.screenshot({path:'/tmp/payday-browser/employee-mobile.png',fullPage:true});
 assert.equal(await users[1].page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // Logout revokes the exact captured session, not just the browser cookie.
 const old=(await users[1].page.context().cookies()).find(c=>c.name==='payday_sid');
 await users[1].page.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
 await users[1].page.getByRole('heading',{name:'เข้าสู่ระบบ',exact:true}).waitFor();
 const revoked=await fetch(`${base}/api/me/payroll`,{headers:{Cookie:`payday_sid=${old.value}`}});assert.equal(revoked.status,401);
 // Exercise reset and disable from the administrator's actual UI.
 await admin.getByRole('button',{name:'พนักงาน',exact:true}).click();
 await admin.getByLabel('เลือกพนักงานสำหรับบัญชี',{exact:true}).selectOption(String(ids.UI001));
 const reset=randomBytes(24).toString('base64url');
 await admin.getByLabel('รหัสผ่านชั่วคราว',{exact:true}).fill(reset);
 const [resetResponse]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith(`/api/employees/${ids.UI001}/reset-password`)),admin.getByRole('button',{name:'รีเซ็ตรหัสผ่าน / เปิดบัญชีอีกครั้ง',exact:true}).click()]);
 assert.equal(resetResponse.status(),200);assert.equal((await get(users[0].page,'/me/payroll')).status,401);
 await login(users[0].page,'UI001',reset);await users[0].page.getByRole('heading',{name:'เปลี่ยนรหัสผ่านชั่วคราว',exact:true}).waitFor();
 const [disabled]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith(`/api/employees/${ids.UI001}/disable-account`)),admin.getByRole('button',{name:'ปิดบัญชีพนักงาน',exact:true}).click()]);
 assert.equal(disabled.status(),200);assert.equal((await get(users[0].page,'/auth/session')).status,401);
 assert.deepEqual(errors,[]);
 console.log('PASS auth browser: admin+two employee accounts; temporary change; month filter; own-only APIs; hidden unpublished payroll; publish UI; individual snapshots; logout captured cookie rejected; reset and disable UI; desktop/mobile; no page errors');
} finally {await browser.close();}
