import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
// Bootstrap a NEW, empty database only. Never part of start/build.
const db = await pool.connect();
try {
    await db.query('BEGIN');
    if ((await db.query("SELECT 1 FROM pg_tables WHERE schemaname='public' LIMIT 1")).rowCount) {
        throw new Error('Database is not empty; use npm run migrate instead. No existing tables were changed.');
    }
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.query('COMMIT');
    console.log('Base schema initialized. Next run npm run migrate, then npm run create-admin.');
} catch (error) {
    await db.query('ROLLBACK');
    console.error(error.message);
    process.exitCode = 1;
} finally { db.release(); await pool.end(); }
