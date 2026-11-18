import { pool } from './db.js';
import { runAttendanceJob } from './attendance-job.js';
try {
 const result=await runAttendanceJob(pool);
 console.log('Attendance job:',JSON.stringify(result));
 if(result.outcome==='incomplete_employee_setup') process.exitCode=1;
} catch {
 // Do not print driver errors or connection details.
 console.error('Attendance job failed; check migration, policy, calendar coverage, and database availability.');
 process.exitCode=1;
} finally { await pool.end(); }
