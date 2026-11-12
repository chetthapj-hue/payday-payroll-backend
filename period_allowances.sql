WITH selected_period AS (
    SELECT *
    FROM public.payroll_periods
    WHERE id = 1
),
allowance_totals AS (
    SELECT
        w.employee_id,
        SUM(w.meal_allowance) AS meal_pay,
        SUM(
            CASE w.shift_type
                WHEN 'night' THEN 150.00
                WHEN 'day' THEN 0.00
            END
        ) AS shift_pay
    FROM public.work_logs AS w
    CROSS JOIN selected_period AS p
    WHERE w.work_date BETWEEN p.start_date AND p.end_date
    GROUP BY w.employee_id
),
overtime_totals AS (
    SELECT
        w.employee_id,
        SUM(
            w.overtime_minutes - w.overtime_3x_minutes
        ) AS overtime_15_minutes,
        SUM(w.overtime_3x_minutes) AS overtime_3_minutes
    FROM public.work_logs AS w
    CROSS JOIN selected_period AS p
    WHERE w.work_date BETWEEN
        p.overtime_start_date AND p.overtime_end_date
    GROUP BY w.employee_id
),
employee_rates AS (
    SELECT
        id,
        employee_code,
        full_name,
        pay_type,
        CASE pay_type
            WHEN 'daily' THEN pay_rate / 8
            WHEN 'monthly' THEN pay_rate / 30 / 8
        END AS hourly_rate
    FROM public.employees
)
SELECT
    p.period_name AS "งวด",
    p.payment_date AS "วันจ่าย",
    e.employee_code AS "รหัสพนักงาน",
    e.full_name AS "ชื่อพนักงาน",
    ROUND(
        e.hourly_rate * 1.5
        * COALESCE(o.overtime_15_minutes, 0) / 60,
        2
    ) AS "โอที 1.5",
    ROUND(
        e.hourly_rate * 3
        * COALESCE(o.overtime_3_minutes, 0) / 60,
        2
    ) AS "โอที 3",
    COALESCE(a.meal_pay, 0.00) AS "ค่าแดกข้าว",
    COALESCE(a.shift_pay, 0.00) AS "ค่ากะ"
FROM employee_rates AS e
CROSS JOIN selected_period AS p
LEFT JOIN allowance_totals AS a
    ON a.employee_id = e.id
LEFT JOIN overtime_totals AS o
    ON o.employee_id = e.id
ORDER BY e.employee_code;