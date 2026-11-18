import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {bangkokToday} from '../work-logs.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base=process.env.PAYDAY_HTTPS_TEST_BASE_URL;
assert.ok(base?.startsWith('https://'),'Set PAYDAY_HTTPS_TEST_BASE_URL to the local test proxy');
assert.ok(process.env.PAYDAY_TEST_ADMIN_PASSWORD,'Use isolated test runner');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[];
async function pageFor(){const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;}
async function login(page,login,password,role='employee'){
 await page.getByRole('heading',{name:/^เข้าสู่ระบบ/}).waitFor();
 await page.getByLabel('ประเภทบัญชี',{exact:true}).selectOption(role);
 await page.getByLabel(role==='admin'?'ชื่อผู้ดูแลระบบ':'รหัสพนักงาน',{exact:true}).fill(login);
 await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
 await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
}
async function get(page,path){const r=await page.request.get(base+path);return{...(await r.json()),status:r.status()};}
try{
 const admin=await pageFor();
 const root=await admin.request.get(base+'/');assert.equal(root.status(),200);assert.match(await root.text(),/\/assets\//);
 for(const path of ['/api/unknown','/assets/no-such-file.js','/server/.env','/.env'])assert.equal((await admin.request.get(base+path)).status(),404,path);
 assert.equal((await get(admin,'/api/health')).status,200);
 const navigation=await admin.goto(base+'/reports/period/123');assert.equal(navigation.status(),200);
 const scripts=await admin.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src')));
 assert.ok(scripts.some(src=>src.startsWith('/assets/')));assert.ok(!scripts.some(src=>src.includes('@vite/client')));
 await login(admin,'browser-admin',process.env.PAYDAY_TEST_ADMIN_PASSWORD,'admin');
 await admin.getByRole('heading',{name:'เพิ่มพนักงาน',exact:true}).waitFor();
 assert.match((await get(admin,'/api/health/db')).database,/^payday[a-z0-9_]*_test[a-z0-9_]*$/);
 const cookie=(await admin.context().cookies()).find(c=>c.name==='payday_sid');
 assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Lax');
 await admin.getByLabel('รหัสพนักงาน',{exact:true}).fill('TLS001');
 await admin.getByLabel('ชื่อ–นามสกุล').fill('ทดสอบ HTTPS origin เดียว');
 await admin.locator('input[name="pay_rate"]').fill('500');
 const [created]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith('/api/employees')&&r.request().method()==='POST'),admin.getByRole('button',{name:'เพิ่มพนักงาน',exact:true}).click()]);
 assert.equal(created.status(),201);const employee=(await created.json()).data;
 assert.equal(new URL(created.url()).origin,new URL(base).origin);
 const session=(await get(admin,'/api/auth/session')).data;
 const rejected=await admin.request.post(base+'/api/employees',{headers:{'X-PayDay-Request':'1'},data:{}});
 assert.equal(rejected.status(),403);assert.equal((await rejected.json()).code,'CSRF_REJECTED');
 const temp=randomBytes(2).toString('hex'),password=temp.slice(0,3)+(temp[3]==='0'?'1':'0');
 const account=await admin.request.post(base+`/api/employees/${employee.id}/account`,{headers:{'X-PayDay-Request':'1','X-CSRF-Token':session.csrf_token},data:{temporary_password:temp}});assert.equal(account.status(),201);
 const user=await pageFor();await user.goto(base+'/employee/work');
 await login(user,'TLS001',temp);
 await user.getByRole('heading',{name:'เปลี่ยนรหัสผ่านชั่วคราว',exact:true}).waitFor();
 await user.getByLabel('รหัสผ่านปัจจุบัน',{exact:true}).fill(temp);
 await user.getByLabel('รหัสผ่านใหม่',{exact:true}).fill(password);
 await user.getByLabel('ยืนยันรหัสผ่านใหม่',{exact:true}).fill(password);
 await user.getByRole('button',{name:'บันทึกรหัสผ่านใหม่',exact:true}).click();
 await user.getByRole('heading',{name:'ข้อมูลของฉัน',exact:true}).waitFor();
 assert.equal((await get(user,'/api/employees')).status,403);
 const own=(await get(user,'/api/me/accrued-income?month=2026-12')).data.row;assert.equal(own.employee_id,employee.id);
 await user.getByRole('button',{name:'ลงเวลาทำงาน',exact:true}).click();
 assert.equal(await user.getByLabel('วันที่ทำงาน',{exact:true}).inputValue(),bangkokToday());
 const [work]=await Promise.all([user.waitForResponse(r=>r.url().endsWith('/api/me/work-logs')&&r.request().method()==='POST'),user.getByRole('button',{name:'บันทึกเวลาของฉัน',exact:true}).click()]);
 assert.equal(work.status(),201);assert.equal(new URL(work.url()).origin,new URL(base).origin);
 const oldCookie=(await user.context().cookies()).find(c=>c.name==='payday_sid');assert.equal(oldCookie.secure,true);assert.equal(oldCookie.httpOnly,true);
 await user.getByRole('button',{name:'ออกจากระบบ',exact:true}).click();
 await user.getByRole('heading',{name:/^เข้าสู่ระบบ/}).waitFor();
 const old=await user.request.get(base+'/api/me/payroll',{headers:{Cookie:`payday_sid=${oldCookie.value}`}});assert.equal(old.status(),401);
 assert.equal((await get(admin,'/api/unknown')).status,404);
 assert.deepEqual(errors,[]);
 await admin.screenshot({path:'/tmp/payday-browser/production-https.png',fullPage:true});
 console.log('PASS production HTTPS browser: built assets/no Vite, deep-link refresh, API404, same-origin admin/employee login, Secure+HttpOnly+SameSite cookie, CSRF write/rejection, role guards, self work, revoked logout cookie');
}finally{await browser.close();}
