const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import assert from 'node:assert/strict';
const baseURL = process.env.PAYDAY_TEST_BASE_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const adminPassword=process.env.PAYDAY_TEST_ADMIN_PASSWORD;
assert.ok(adminPassword,'Use tests/run-browser-tests.js to create isolated test credentials');
async function adminLogin(p) {
 await p.goto(baseURL);
 await p.getByRole('heading',{name:/^เข้าสู่ระบบ/}).waitFor();
 await p.getByLabel('ประเภทบัญชี',{exact:true}).selectOption('admin');
 await p.getByLabel('ชื่อผู้ดูแลระบบ',{exact:true}).fill('browser-admin');
 await p.getByLabel('รหัสผ่าน',{exact:true}).fill(adminPassword);
 await p.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
 await p.getByRole('heading',{name:'เพิ่มพนักงาน',exact:true}).waitFor();
 const health=await (await p.request.get(`${baseURL}/api/health/db`)).json();
 assert.match(health.database || '',/^payday[a-z0-9_]*_test[a-z0-9_]*$/);
}
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const post = (path, action) => Promise.all([page.waitForResponse(r => r.url().includes(path) && r.request().method() === 'POST'), action()]);
try {
 await adminLogin(page);
 for (const [code,type,rate] of [['UI001','daily','800'],['UI002','monthly','24000']]) {
  await page.getByLabel('รหัสพนักงาน',{exact:true}).fill(code);
  await page.getByLabel('ชื่อ–นามสกุล').fill(`ทดสอบ ${code}`);
  await page.locator('select[name="pay_type"]').selectOption(type);
  await page.locator('input[name="pay_rate"]').fill(rate);
  const [r] = await post('/api/employees',() => page.getByRole('button',{name:'เพิ่มพนักงาน',exact:true}).click());
  assert.equal(r.status(),201);
  await page.getByRole('cell',{name:code,exact:true}).waitFor();
 }
 await page.getByLabel('รหัสพนักงาน',{exact:true}).fill('UI001');
 await page.getByLabel('ชื่อ–นามสกุล').fill('ซ้ำ');
 await page.locator('input[name="pay_rate"]').fill('800');
 const [duplicateEmployee] = await post('/api/employees',() => page.getByRole('button',{name:'เพิ่มพนักงาน',exact:true}).click());
 assert.equal(duplicateEmployee.status(),409);
 await page.getByRole('alert').filter({hasText:'รหัสพนักงานนี้มีอยู่แล้ว'}).waitFor();
 await page.getByRole('button',{name:'บันทึกการทำงาน',exact:true}).click();
 for (const code of ['UI001','UI002']) {
  await page.locator('select[name="employee_id"]').selectOption({label:`${code} — ทดสอบ ${code}`});
  for (const date of ['2026-09-30','2026-10-01','2026-10-16','2026-10-17','2026-10-31','2026-11-01','2026-11-16','2026-11-17']) {
   await page.getByLabel('วันที่ทำงาน').fill(date);
   await page.locator('select[name="shift_type"]').selectOption('night');
   await page.getByLabel('OT รวม',{exact:true}).fill('1');
   await page.getByLabel('อัตรา OT',{exact:true}).selectOption('1.5');
   const [r] = await post('/api/work-logs',() => page.getByRole('button',{name:'บันทึกเวลาทำงาน',exact:true}).click());
   assert.equal(r.status(),201);
   const work=(await r.json()).data;
   const session=(await (await page.request.get(`${baseURL}/api/auth/session`)).json()).data;
   const split=await page.request.patch(`${baseURL}/api/work-logs/${work.id}/overtime`,{headers:{'X-PayDay-Request':'1','X-CSRF-Token':session.csrf_token},data:{overtime_minutes:60,overtime_1x_minutes:0,overtime_2x_minutes:0,overtime_3x_minutes:30}});
   assert.equal(split.status(),200);
   await page.getByRole('status').filter({hasText:'บันทึกเวลาทำงานเรียบร้อยแล้ว'}).waitFor();
  }
 }
 assert.equal(await page.getByRole('cell',{name:'8 ชม.',exact:true}).count(),16);
 assert.equal(await page.getByLabel('เวลาปกติ',{exact:true}).inputValue(),'8 ชม.');
 const [duplicateLog] = await post('/api/work-logs',() => page.getByRole('button',{name:'บันทึกเวลาทำงาน',exact:true}).click());
 assert.equal(duplicateLog.status(),409);
 await page.getByRole('alert').filter({hasText:'มีบันทึกในวันที่เลือกแล้ว'}).waitFor();
 await page.getByRole('button',{name:'คำนวณเงินเดือน',exact:true}).click();
 await page.getByLabel('เดือนจ่าย (จ่ายวันที่ 25)').fill('2026-11');
 await page.getByRole('button',{name:'คำนวณ / เปิดงวด',exact:true}).click();
 await page.getByRole('heading',{name:/งวดจ่าย 25 พฤศจิกายน 2569/}).waitFor();
 const row = page.getByRole('row').filter({has:page.getByRole('cell',{name:'UI001',exact:true})});
 await row.waitFor();
 assert.match(await row.innerText(),/5,364\.00/);
 assert.match(await row.innerText(),/664\.00/);
 assert.match(await page.getByRole('row').filter({has:page.getByRole('cell',{name:'UI002',exact:true})}).innerText(),/26,164\.00/);
 const before = await page.locator('tbody').innerText();
 const [save] = await post('/api/payroll/save',() => page.getByRole('button',{name:'ตรวจยอดแล้ว — บันทึกงวดนี้'}).click());
 assert.equal(save.status(),201);
 await page.getByRole('heading',{name:/รายงานที่บันทึกแล้ว/}).waitFor();
 await page.getByRole('button',{name:'พนักงาน',exact:true}).click();
 await page.getByRole('button',{name:'แก้ไข UI001',exact:true}).click();
 await page.getByLabel('ชื่อ–นามสกุล').fill('แก้ชื่อหลังบันทึกงวด');
 await page.locator('input[name="pay_rate"]').fill('999');
 await Promise.all([page.waitForResponse(r => r.url().includes('/api/employees/') && r.request().method()==='PUT'),page.getByRole('button',{name:'บันทึกการแก้ไข'}).click()]);
 await page.getByRole('cell',{name:'แก้ชื่อหลังบันทึกงวด',exact:true}).waitFor();
 await page.reload();
 await page.getByRole('button',{name:'รายงานที่บันทึก',exact:true}).click();
 const selector = page.locator('select').filter({has:page.locator('option', {hasText:'เลือกงวดที่ต้องการเปิด'})});
 await selector.locator('option').filter({hasText:'25 พฤศจิกายน 2569'}).waitFor({state:'attached'});
 const value = await selector.locator('option').filter({hasText:'25 พฤศจิกายน 2569'}).getAttribute('value');
 await selector.selectOption(value);
 await page.getByRole('heading',{name:/รายงานที่บันทึกแล้ว/}).waitFor();
 assert.equal(await page.locator('tbody').innerText(),before);
 await page.screenshot({path:'/tmp/payday-browser/report-desktop.png',fullPage:true});
 const mobile = await browser.newPage({ viewport: {width:390,height:844} });
 mobile.on('pageerror', e => errors.push(e.message));
 await adminLogin(mobile);
 await mobile.getByRole('button',{name:'รายงานที่บันทึก',exact:true}).click();
 await mobile.locator('select option').filter({hasText:'25 พฤศจิกายน 2569'}).waitFor({state:'attached'});
 await mobile.locator('select').selectOption(value);
 await mobile.getByRole('heading',{name:/รายงานที่บันทึกแล้ว/}).waitFor();
 await mobile.evaluate(() => document.fonts.ready);
 await mobile.screenshot({path:'/tmp/payday-browser/report-mobile.png',fullPage:true});
 assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),false);
 // Separate past dates keep the original November/December payroll fixtures unchanged.
 await page.getByRole('button',{name:'บันทึกการทำงาน',exact:true}).click();
 await page.locator('select[name="employee_id"]').selectOption({label:'UI002 — ทดสอบ UI002'});
 assert.equal(await page.getByLabel('เวลาปกติ',{exact:true}).inputValue(),'8 ชม.');
 assert.equal(await page.getByLabel('เวลาปกติ',{exact:true}).getAttribute('readonly'),'');
 await page.getByLabel('OT รวม',{exact:true}).fill('-1');
 assert.equal(await page.getByLabel('OT รวม',{exact:true}).evaluate(e=>e.checkValidity()),false);
 await page.getByLabel('OT รวม',{exact:true}).fill('2');
 await page.getByLabel('อัตรา OT',{exact:true}).selectOption('3');
 for(const [date,hours,triple,minutes,tripleMinutes,meal] of [
  ['2025-02-01','2','3',120,120,'166.00'],
  ['2025-02-02','1','1.5',60,0,'166.00'],
  ['2025-02-03','0.25','2',15,0,'83.00']]) {
  await page.getByLabel('วันที่ทำงาน').fill(date);
  await page.getByLabel('OT รวม',{exact:true}).fill(hours);
  await page.getByLabel('อัตรา OT',{exact:true}).selectOption(triple);
  const [r]=await post('/api/work-logs',()=>page.getByRole('button',{name:'บันทึกเวลาทำงาน',exact:true}).click());
  assert.equal(r.status(),201);
  const body=r.request().postDataJSON();assert.equal(body.regular_minutes,480);
  assert.equal(body.overtime_minutes,minutes);assert.equal(body.overtime_3x_minutes,tripleMinutes);
  const saved=(await r.json()).data;assert.equal(saved.meal_allowance,meal);
 }
 await page.reload();
 await page.getByRole('button',{name:'บันทึกการทำงาน',exact:true}).click();
 const hoursRow=page.locator('tbody tr').filter({hasText:'1 กุมภาพันธ์ 2568'});
 await hoursRow.waitFor();
 assert.equal(await hoursRow.locator('td').nth(5).innerText(),'8 ชม.');
 assert.equal(await hoursRow.locator('td').nth(6).innerText(),'2 ชม.');
 assert.equal(await hoursRow.locator('td').nth(10).innerText(),'2 ชม.');
 const persisted=(await (await page.request.get(`${baseURL}/api/work-logs`)).json()).data.find(r=>r.work_date==='2025-02-01');
 assert.equal(persisted.overtime_minutes,120);assert.equal(persisted.regular_minutes,480);
 assert.deepEqual(errors,[]);
 console.log('PASS browser: create/edit daily+monthly, duplicate employee, 16 boundary work logs, duplicate work log, November preview, save, reload frozen report, mobile layout, no page errors');
} finally { await browser.close(); }
