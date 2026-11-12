import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
if(!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required: browser tests erase test fixtures');
const name=decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1));
if(!/^payday[a-z0-9_]*_test[a-z0-9_]*$/.test(name)) throw new Error('Only payday*_test* databases allowed');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const {pool}=await import('../db.js');
try {
 if((await pool.query('SELECT current_database() AS n')).rows[0].n!==name) throw new Error('Wrong database');
 // Verify the browser target uses the same database before any browser writes.
 const backend=process.env.PAYDAY_TEST_BASE_URL || 'http://127.0.0.1:5174';
 const password=randomBytes(2).toString('hex');
 await pool.query('TRUNCATE auth_login_attempts,payroll_items,payroll_periods,work_logs,employees RESTART IDENTITY CASCADE');
 const env={...process.env,PAYDAY_TEST_ADMIN_PASSWORD:password};
 const run=(args,extra={})=>spawnSync(process.execPath,args,{env,encoding:'utf8',...extra});
 const first=run(['create-admin.js'],{input:JSON.stringify({username:'browser-admin',password})});
 if(first.status!==0) throw new Error(first.stderr || 'First admin setup failed');
 const second=run(['create-admin.js'],{input:JSON.stringify({username:'another-admin',password})});
 if(second.status!==1 || !second.stderr.includes('มี admin แล้ว')) throw new Error('Second bootstrap should fail');
 const login=await fetch(`${backend}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-PayDay-Request':'1'},body:JSON.stringify({role:'admin',login:'browser-admin',password})});
 if(login.status!==200) throw new Error('Browser target is not connected to the test database');
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const health=await (await fetch(`${backend}/api/health/db`,{headers:{Cookie:cookie}})).json();
 if(health.database!==name) throw new Error('Browser target database mismatch');
 const files=['browser.mjs','auth-browser.mjs','employee-lifecycle-browser.mjs','self-service-browser.mjs'];
 if(process.env.PAYDAY_HTTPS_TEST_BASE_URL)files.push('production-browser.mjs');
 for(const file of files){
  const r=run([`tests/${file}`],{stdio:'inherit'});if(r.status!==0) {process.exitCode=r.status || 1;break;}
 }
} finally {await pool.end();}
