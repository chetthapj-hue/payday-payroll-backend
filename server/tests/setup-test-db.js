import 'dotenv/config';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const target = process.env.TEST_DATABASE_URL;
if (!target) throw new Error('Set TEST_DATABASE_URL to a NEW database whose name contains _test');
const url = new URL(target);
const name = decodeURIComponent(url.pathname.slice(1));
if (!/^payday[a-z0-9_]*_test[a-z0-9_]*$/.test(name)) throw new Error('Unsafe test database name');
const adminURL = new URL(target); adminURL.pathname = '/postgres';
const admin = new pg.Pool({ connectionString: adminURL.href });
try {
  // Name is restricted above; identifiers cannot use bind parameters.
  await admin.query(`CREATE DATABASE "${name}"`);
} finally { await admin.end(); }
const db = new pg.Pool({ connectionString: target });
try {
  await db.query(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  await db.query(await readFile(new URL('../migrations/001_saved_reports.sql', import.meta.url), 'utf8'));
  await db.query(await readFile(new URL('../migrations/002_auth.sql', import.meta.url), 'utf8'));
  await db.query(await readFile(new URL('../migrations/003_employee_status.sql', import.meta.url), 'utf8'));
  await db.query(await readFile(new URL('../migrations/004_weekend_payroll_metrics.sql', import.meta.url), 'utf8'));
  console.log('Created isolated empty test database:', name);
} finally { await db.end(); }
