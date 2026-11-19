import { pool } from './db.js';
try {
 // to_jsonb supports pre-006 schemas too. Read aggregates only; never modify source or snapshots.
 const row=(await pool.query(`WITH work AS (
  SELECT COALESCE((to_jsonb(w)->>'overtime_1x_minutes')::integer,0)
   + COALESCE((to_jsonb(w)->>'overtime_2x_minutes')::integer,0) AS minutes FROM public.work_logs w
 ), saved AS (
  SELECT COALESCE((to_jsonb(i)->>'overtime_1_minutes')::integer,0)
   + COALESCE((to_jsonb(i)->>'overtime_2_minutes')::integer,0) AS minutes,
   COALESCE((to_jsonb(i)->>'overtime_1_pay')::numeric,0)
   + COALESCE((to_jsonb(i)->>'overtime_2_pay')::numeric,0) AS pay FROM public.payroll_items i
 ) SELECT
  (SELECT count(*)::integer FROM work WHERE minutes>0) AS legacy_rows,
  (SELECT COALESCE(sum(minutes),0) FROM work WHERE minutes>0) AS legacy_work_minutes,
  (SELECT count(*)::integer FROM saved WHERE minutes>0 OR pay>0) AS legacy_saved_items,
  (SELECT COALESCE(sum(minutes),0) FROM saved WHERE minutes>0 OR pay>0) AS legacy_saved_minutes,
  (SELECT COALESCE(sum(pay),0)::numeric(14,2) FROM saved WHERE minutes>0 OR pay>0) AS legacy_saved_ot_pay`)).rows[0];
 console.log(JSON.stringify(row));
} catch (error) {
 const code=typeof error.code==='string' && /^[A-Z0-9_]+$/.test(error.code)?error.code:'UNKNOWN';
 console.error('Legacy OT check failed; check database access and migrations. Code: '+code);process.exitCode=1;
} finally {await pool.end();}
