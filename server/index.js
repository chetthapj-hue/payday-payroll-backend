import express from 'express';
import { pool } from './db.js';
import { registerPayrollRoutes } from './payroll.js';
import { registerAuth, requireAdmin } from './auth.js';
import { registerEmployeeLifecycle } from './employee-lifecycle.js';
import { registerAttendanceRoutes } from './attendance.js';
import { createWorkLog } from './work-logs.js';
import { registerFrontend } from './frontend.js';

export const app = express();
const port = Number(process.env.PORT || 3000);
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
registerAuth(app, pool);

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'PayDay API is running',
    });
});

app.get('/api/health/db', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT current_database() AS database'
        );

        res.json({
            status: 'ok',
            database: result.rows[0].database,
        });
    } catch (error) {
        console.error('Database check failed:', error.message);

        res.status(503).json({
            status: 'error',
            message: 'Database connection failed',
        });
    }
});

// Guard each management route so an unknown /api URL remains a JSON 404.
registerEmployeeLifecycle(app, pool, requireAdmin);

app.get('/api/employees', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                employee_code,
                full_name,
                pay_type,
                pay_rate, is_active, employment_start_date::text, employment_end_date::text, auto_shift_type
            FROM public.employees
            ORDER BY employee_code
        `);

        res.json({
            data: result.rows,
        });
    } catch (error) {
        console.error('Failed to fetch employees:', error.message);

        res.status(500).json({
            message: 'Unable to fetch employees',
        });
    }
});

app.get('/api/employees/:id', requireAdmin, async (req, res) => {
    const employeeId = Number(req.params.id);

    if (
        !/^[0-9]+$/.test(req.params.id) ||
        !Number.isInteger(employeeId) ||
        employeeId < 1 ||
        employeeId > 2147483647
    ) {
        return res.status(400).json({
            message: 'Employee ID must be a positive integer',
        });
    }

    try {
        const result = await pool.query(
            `
                SELECT
                    id,
                    employee_code,
                    full_name,
                    pay_type,
                    pay_rate, is_active, employment_start_date::text, employment_end_date::text, auto_shift_type
                FROM public.employees
                WHERE id = $1
            `,
            [employeeId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Employee not found',
            });
        }

        res.json({
            data: result.rows[0],
        });
    } catch (error) {
        console.error('Failed to fetch employee:', error.message);

        res.status(500).json({
            message: 'Unable to fetch employee',
        });
    }
});

app.post('/api/employees', requireAdmin, async (req, res) => {
    const {
        employee_code,
        full_name,
        pay_type,
        pay_rate,
    } = req.body ?? {};

    if (
        typeof employee_code !== 'string' ||
        employee_code.trim() === '' ||
        typeof full_name !== 'string' ||
        full_name.trim() === ''
    ) {
        return res.status(400).json({
            message: 'Employee code and full name are required',
        });
    }

    if (!['daily', 'monthly'].includes(pay_type)) {
        return res.status(400).json({
            message: 'Pay type must be daily or monthly',
        });
    }

    if (
        typeof pay_rate !== 'string' ||
        !/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(pay_rate) ||
        Number(pay_rate) <= 0
    ) {
        return res.status(400).json({
            message: 'Pay rate must be a positive decimal string',
        });
    }

    try {
        const result = await pool.query(
            `
                INSERT INTO public.employees (
                    employee_code,
                    full_name,
                    pay_type,
                    pay_rate
                )
                VALUES ($1, $2, $3, $4)
                RETURNING
                    id,
                    employee_code,
                    full_name,
                    pay_type,
                    pay_rate, is_active, employment_start_date::text, employment_end_date::text, auto_shift_type
            `,
            [
                employee_code.trim(),
                full_name.trim(),
                pay_type,
                pay_rate,
            ]
        );

        res.status(201).json({
            data: result.rows[0],
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({
                message: 'Employee code already exists',
            });
        }

        console.error('Failed to create employee:', error.message);

        res.status(500).json({
            message: 'Unable to create employee',
        });
    }
});

app.put('/api/employees/:id', requireAdmin, async (req, res) => {
    const employeeId = Number(req.params.id);

    if (
        !/^[0-9]+$/.test(req.params.id) ||
        !Number.isInteger(employeeId) ||
        employeeId < 1 ||
        employeeId > 2147483647
    ) {
        return res.status(400).json({
            message: 'Employee ID must be a positive integer',
        });
    }

    const {
        employee_code,
        full_name,
        pay_type,
        pay_rate,
    } = req.body ?? {};

    if (
        typeof employee_code !== 'string' ||
        employee_code.trim() === '' ||
        typeof full_name !== 'string' ||
        full_name.trim() === ''
    ) {
        return res.status(400).json({
            message: 'Employee code and full name are required',
        });
    }

    if (!['daily', 'monthly'].includes(pay_type)) {
        return res.status(400).json({
            message: 'Pay type must be daily or monthly',
        });
    }

    if (
        typeof pay_rate !== 'string' ||
        !/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(pay_rate) ||
        Number(pay_rate) <= 0
    ) {
        return res.status(400).json({
            message: 'Pay rate must be a positive decimal string',
        });
    }

    try {
        const result = await pool.query(
            `
                UPDATE public.employees
                SET
                    employee_code = $1,
                    full_name = $2,
                    pay_type = $3,
                    pay_rate = $4
                WHERE id = $5
                RETURNING
                    id,
                    employee_code,
                    full_name,
                    pay_type,
                    pay_rate, is_active, employment_start_date::text, employment_end_date::text, auto_shift_type
            `,
            [
                employee_code.trim(),
                full_name.trim(),
                pay_type,
                pay_rate,
                employeeId,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'Employee not found',
            });
        }

        res.json({
            data: result.rows[0],
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({
                message: 'Employee code already exists',
            });
        }

        console.error('Failed to update employee:', error.message);

        res.status(500).json({
            message: 'Unable to update employee',
        });
    }
});

app.post('/api/work-logs', requireAdmin, async (req, res) => {
    res.status(201).json({ data: await createWorkLog(pool, req.body) });
});

app.get('/api/work-logs', requireAdmin, async (req, res) => {
    const {employee_id,month}=req.query;
    if(employee_id!==undefined && (typeof employee_id!=='string' || !/^[1-9][0-9]*$/.test(employee_id) || Number(employee_id)>2147483647))
        return res.status(400).json({message:'รหัสพนักงานไม่ถูกต้อง'});
    if(month!==undefined && (typeof month!=='string' || !/^(20[0-9]{2}|21[0-9]{2})-(0[1-9]|1[0-2])$/.test(month)))
        return res.status(400).json({message:'เดือนประวัติไม่ถูกต้อง'});
    try {
        const result = await pool.query(`
            SELECT
                w.id,
                w.employee_id,
                e.employee_code,
                e.full_name,
                w.work_date::text AS work_date,
                w.shift_type,
                w.wage_multiplier, w.attendance_status, w.source, w.leave_paid,
                w.regular_minutes,
                w.overtime_minutes,
                w.overtime_3x_minutes, w.overtime_1x_minutes, w.overtime_2x_minutes,
                w.overtime_minutes - w.overtime_3x_minutes - w.overtime_1x_minutes - w.overtime_2x_minutes
                    AS overtime_15_minutes,
                w.meal_allowance
            FROM public.work_logs AS w
            JOIN public.employees AS e
                ON e.id = w.employee_id
            WHERE ($1::integer IS NULL OR w.employee_id=$1)
              AND ($2::date IS NULL OR (w.work_date >= $2::date AND w.work_date < $2::date + interval '1 month'))
            ORDER BY w.work_date DESC, w.id DESC
            LIMIT 100
        `, [employee_id || null, month ? `${month}-01` : null]);

        res.json({
            data: result.rows,
        });
    } catch (error) {
        console.error('Failed to fetch work logs:', error.message);

        res.status(500).json({
            message: 'Unable to fetch work logs',
        });
    }
});

registerAttendanceRoutes(app, pool, requireAdmin);
registerPayrollRoutes(app, pool, requireAdmin);
// API misses never fall through to React, including when the user is logged out.
app.use('/api', (req, res) => res.status(404).json({ message: 'ไม่พบ API ที่เรียก' }));
registerFrontend(app);

const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
if (process.env.NODE_ENV !== 'test') app.listen(port, host, () => {
    console.log(`PayDay: http://${host}:${port}`);
});