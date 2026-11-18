import { pool } from './db.js';
import { configureAttendance } from './attendance.js';
try {
 let input='';
 for await (const chunk of process.stdin) {input+=chunk;if(input.length>65536)throw new Error('INPUT_TOO_LARGE');}
 await configureAttendance(pool,JSON.parse(input));
 console.log('Attendance configuration saved.');
} catch(e) {
 console.error(e.status && e.status<500?e.message:'Attendance configuration failed; check input, migration, and database availability.');
 process.exitCode=1;
} finally {await pool.end();}
