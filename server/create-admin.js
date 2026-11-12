import { emitKeypressEvents } from 'node:readline';
import { pool } from './db.js';
import { createFirstAdmin } from './auth.js';
function secret(prompt) {
  return new Promise((resolve,reject)=>{
    process.stdout.write(prompt);let value='';
    emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
    const finish=(error)=>{
      process.stdin.off('keypress',onKey);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onKey=(str,key)=>{
      if(key?.ctrl && key.name==='c') return finish(new Error('ยกเลิก'));
      if(key?.name==='return') return finish();
      if(key?.name==='backspace') value=value.slice(0,-1);
      else if(str && !key?.ctrl && !key?.meta) value+=str;
    };
    process.stdin.on('keypress',onKey);
  });
}
try {
  let username,password;
  if(process.stdin.isTTY) {
    const i=process.argv.indexOf('--username');username=i>=0 ? process.argv[i+1] : undefined;
    if(!username) throw new Error('ใช้ npm run create-admin -- --username ชื่อผู้ดูแล');
    password=await secret('ตั้งรหัสผ่าน admin (4–128 ตัวอักษร): ');
    if(password!==await secret('ยืนยันรหัสผ่าน: ')) throw new Error('รหัสผ่านไม่ตรงกัน');
  } else {
    // Automation passes JSON through stdin, never command arguments or a default password.
    let input='';for await (const chunk of process.stdin) input+=chunk;
    ({username,password}=JSON.parse(input));
  }
  const user=await createFirstAdmin(pool,username,password);
  console.log(`สร้าง admin คนแรกแล้ว: ${user.username}`);
} catch(e) {console.error(e.message);process.exitCode=1;} finally {await pool.end();}
