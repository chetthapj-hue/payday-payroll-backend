import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {bangkokToday} from '../work-logs.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base=process.env.PAYDAY_TEST_BASE_URL || 'http://127.0.0.1:5174';
assert.ok(process.env.PAYDAY_TEST_ADMIN_PASSWORD,'Use isolated browser runner');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
async function newPage(){const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));return page;}
async function login(page,code,password,role='employee'){
 await page.goto(base);await page.getByRole('heading',{name:'เข้าสู่ระบบ',exact:true}).waitFor();
 await page.getByLabel('ประเภทบัญชี',{exact:true}).selectOption(role);
 await page.getByLabel(role==='admin'?'ชื่อผู้ดูแลระบบ':'รหัสพนักงาน',{exact:true}).fill(code);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
}
async function api(page,path,body){
 const session=await (await page.request.get(`${base}/api/auth/session`)).json();
 const r=await page.request.fetch(`${base}/api${path}`,{method:body?'POST':'GET',
  headers:{'X-PayDay-Request':'1','X-CSRF-Token':session.data.csrf_token},...(body?{data:body}:{})});
 return {status:r.status(),...(await r.json())};
}
const fullDay=(date,extra={})=>({work_date:date,regular_minutes:480,overtime_minutes:0,overtime_3x_minutes:0,shift_type:'day',...extra});
const card=(page,label)=>page.getByRole('region',{name:'รายได้สะสมของฉัน',exact:true}).locator('dl > div').filter({has:page.locator('dt',{hasText:label})}).locator('dd');
try{
 const admin=await newPage();await login(admin,'browser-admin',process.env.PAYDAY_TEST_ADMIN_PASSWORD,'admin');
 await admin.getByRole('heading',{name:'เพิ่มพนักงาน',exact:true}).waitFor();
 assert.match((await (await admin.request.get(`${base}/api/health/db`)).json()).database,/^payday[a-z0-9_]*_test[a-z0-9_]*$/);
 const e=(await api(admin,'/employees',{employee_code:'SELF001',full_name:'ทดสอบลงเวลาด้วยตนเอง',pay_type:'daily',pay_rate:'500.00'})).data;
 const other=(await api(admin,'/employees',{employee_code:'SELF002',full_name:'พนักงานอีกคน',pay_type:'daily',pay_rate:'900.00'})).data;
 const temp=randomBytes(2).toString('hex'),password=temp.slice(0,3)+(temp[3]==='0'?'1':'0');
 assert.equal((await api(admin,`/employees/${e.id}/account`,{temporary_password:temp})).status,201);
 // Original published October payroll is frozen before the employee adds a backdated record.
 assert.equal((await api(admin,'/work-logs',{employee_id:e.id,...fullDay('2026-09-17')})).status,201);
 const preview=(await api(admin,'/payroll/preview?month=2026-10')).data;
 const saved=await api(admin,'/payroll/save',{month:'2026-10',preview_token:preview.preview_token});assert.equal(saved.status,201);
 const id=saved.data.period.id;
 assert.equal((await api(admin,`/payroll/periods/${id}/publish`,{})).status,200);
 for(const date of ['2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21'])
  assert.equal((await api(admin,'/work-logs',{employee_id:e.id,...fullDay(date)})).status,201);
 assert.equal((await api(admin,'/work-logs',{employee_id:e.id,...fullDay('2026-11-01',{overtime_minutes:384})})).status,201);
 const page=await newPage();await login(page,'SELF001',temp);
 await page.getByRole('heading',{name:'เปลี่ยนรหัสผ่านชั่วคราว',exact:true}).waitFor();
 await page.getByLabel('รหัสผ่านปัจจุบัน',{exact:true}).fill(temp);
 await page.getByLabel('รหัสผ่านใหม่',{exact:true}).fill(password);
 await page.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill(password);
 await page.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();
 await page.getByRole('heading',{name:'ข้อมูลของฉัน',exact:true}).waitFor();
 const published=(await api(page,`/me/payroll/${id}`)).data;assert.equal(published.base_pay,'500.00');
 await page.getByRole('button',{name:'รายได้สะสมของฉัน',exact:true}).click();
 await page.getByLabel('เดือนจ่ายสำหรับยอดสะสม',{exact:true}).fill('2026-12');
 await page.getByText('จำนวนวันที่ลงงานในรอบค่าจ้าง:',{exact:false}).waitFor();
 await card(page,'ค่าจ้างปกติสะสม').filter({hasText:'2,500.00'}).waitFor();
 assert.match(await card(page,'OT 1.5 เท่า').innerText(),/600\.00/);
 assert.match(await card(page,'รายได้รวมสะสม').innerText(),/3,515\.00/);
 assert.match(await page.getByRole('region',{name:'รายได้สะสมของฉัน'}).innerText(),/5 วัน/);
 const own=(await api(page,`/me/accrued-income?month=2026-12&employee_id=${other.id}`)).data.row;
 assert.equal(own.employee_id,e.id);assert.equal(Number(own.base_pay)+Number(own.overtime_15_pay),3100);
 await page.getByRole('button',{name:'ลงเวลาทำงาน',exact:true}).click();
 const today=bangkokToday(),tomorrow=new Date(new Date(`${today}T00:00:00Z`).getTime()+86400000).toISOString().slice(0,10);
 const dateInput=page.getByLabel('วันที่ทำงาน',{exact:true});
 assert.equal(await dateInput.inputValue(),today);assert.equal(await dateInput.getAttribute('max'),today);
 assert.equal(await page.locator('select[name="employee_id"]').count(),0);
 assert.equal(await page.getByLabel('เวลาปกติ',{exact:true}).inputValue(),'8 ชม.');
 await dateInput.fill(tomorrow);assert.equal(await dateInput.evaluate(e=>e.checkValidity()),false);
 assert.equal((await api(page,'/me/work-logs',fullDay(tomorrow,{employee_id:other.id}))).status,400);
 await dateInput.fill(today);
 await page.getByLabel('กะ',{exact:true}).selectOption('night');
 await page.getByLabel('OT รวม',{exact:true}).fill('2');
 await page.getByLabel('OT 3 เท่า',{exact:true}).fill('0.5');
 const [post]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/me/work-logs')&&r.request().method()==='POST'),page.getByRole('button',{name:'บันทึกเวลาของฉัน',exact:true}).click()]);
 assert.equal(post.status(),201);const body=post.request().postDataJSON();assert.equal(body.overtime_minutes,120);assert.equal(body.overtime_3x_minutes,30);assert.ok(!('employee_id' in body));
 assert.equal((await post.json()).data.employee_id,e.id);
 await page.getByRole('status').filter({hasText:'ลงเวลาสำเร็จ'}).waitFor();
 // Live figures refresh without a page reload. Expected month follows the regular 17–16 cycle.
 const [year,month,day]=today.split('-').map(Number);
 const payMonth=new Date(Date.UTC(year,month-1+(day>=17?1:0),1)).toISOString().slice(0,7);
 assert.equal(await page.getByLabel('เดือนจ่ายสำหรับยอดสะสม',{exact:true}).inputValue(),payMonth);
 const live=(await api(page,`/me/accrued-income?month=${payMonth}`)).data.row;
 await card(page,'ค่าจ้างปกติสะสม').filter({hasText:Number(live.base_pay).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})}).waitFor();
 const [duplicate]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/me/work-logs')&&r.request().method()==='POST'),page.getByRole('button',{name:'บันทึกเวลาของฉัน',exact:true}).click()]);
 assert.equal(duplicate.status(),409);await page.getByRole('alert').filter({hasText:'มีบันทึกเวลา'}).waitFor();
 // An attempted owner override still creates a record for SELF001 only.
 const yesterday=new Date(new Date(`${today}T00:00:00Z`).getTime()-86400000).toISOString().slice(0,10);
 assert.equal((await api(page,'/me/work-logs',fullDay(yesterday,{employee_id:other.id}))).data.employee_id,e.id);
 assert.equal((await api(admin,`/work-logs?employee_id=${other.id}`)).data.length,0);
 // Past dates refresh history and the chosen accrual immediately, but not the published snapshot.
 await dateInput.fill('2026-09-18');await page.getByLabel('กะ',{exact:true}).selectOption('day');
 await page.getByLabel('OT รวม',{exact:true}).fill('0');await page.getByLabel('OT 3 เท่า',{exact:true}).fill('0');
 const [past]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/me/work-logs')&&r.request().method()==='POST'),page.getByRole('button',{name:'บันทึกเวลาของฉัน',exact:true}).click()]);assert.equal(past.status(),201);
 await card(page,'ค่าจ้างปกติสะสม').filter({hasText:'1,000.00'}).waitFor();
 assert.deepEqual((await api(page,`/me/payroll/${id}`)).data,published);
 await page.getByRole('button',{name:'ประวัติการทำงาน',exact:true}).click();
 assert.equal(await page.getByLabel('เดือนที่ทำงาน',{exact:true}).inputValue(),'2026-09');
 assert.equal(await page.locator('tbody tr').count(),2);
 await page.getByRole('button',{name:'เงินเดือนของฉัน',exact:true}).click();
 await page.getByLabel('งวดเงินเดือนของฉัน',{exact:true}).selectOption(String(id));
 await page.getByRole('heading',{name:'เงินเดือนงวดจ่าย 25 ตุลาคม 2569',exact:true}).waitFor();
 const salary=page.locator('dl > div').filter({has:page.locator('dt',{hasText:'ค่าจ้างปกติ'})});assert.match(await salary.innerText(),/500\.00/);
 await page.getByRole('button',{name:'ลงเวลาทำงาน',exact:true}).click();
 await card(page,'ค่าจ้างปกติสะสม').filter({hasText:'1,000.00'}).waitFor();
 await page.screenshot({path:'/tmp/payday-browser/self-service.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS self-service browser: Thai today/max date; future blocked in UI/API; hour entry to minutes; own-only records; duplicate prevented; 2500+600 example; immediate history/accrual; published snapshot unchanged');
}finally{await browser.close();}
