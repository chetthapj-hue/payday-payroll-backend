import pg from 'pg';
import { resetAdminPassword } from './reset-admin-password.js';

let client;
try {
  // Secrets arrive only through stdin, never arguments, dotenv, or logs.
  if (process.stdin.isTTY) throw new Error('STDIN_REQUIRED');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw new Error('INPUT_TOO_LARGE');
  }
  const { url, password } = JSON.parse(input);
  const target = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)) throw new Error('INVALID_URL');
  if (!target.searchParams.has('sslmode')) target.searchParams.set('sslmode', 'require');
  client = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 10000 });
  client.on('error', () => {});
  await client.connect();
  await resetAdminPassword(client, password);
  console.log('รีเซ็ต myadmin ใน payday_db_rv8p และยกเลิก session เดิมสำเร็จ');
} catch {
  console.error('รีเซ็ตไม่สำเร็จ: ตรวจ URL ชื่อฐาน บัญชี admin ที่เปิดใช้งาน และรหัสผ่าน 4–128 ตัวอักษร');
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
