import { pool } from './db.js';
try {
 const row=(await pool.query(`SELECT count(*)::integer AS legacy_rows FROM public.work_logs w
  WHERE COALESCE((to_jsonb(w)->>'overtime_1x_minutes')::integer,0)>0
   OR COALESCE((to_jsonb(w)->>'overtime_2x_minutes')::integer,0)>0`)).rows[0];
 console.log(JSON.stringify(row));
} catch (error) {
 const code=typeof error.code==='string' && /^[A-Z0-9_]+$/.test(error.code)?error.code:'UNKNOWN';
 console.error('Legacy OT check failed; check database access and migrations. Code: '+code);process.exitCode=1;
} finally {await pool.end();}
