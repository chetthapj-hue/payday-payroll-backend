WITH selected_period AS (
    SELECT *
    FROM public.payroll_periods
    WHERE id = 1
),
work_totals AS (
    SELECT
        w.employee_id,
        COUNT(*) AS recorded_days,
        BOOL_AND(w.regular_minutes = 480) AS all_full_days,
        SUM(w.meal_allowance) AS meal_pay,
        SUM(
            CASE w.shift_type
                WHEN 'day' THEN 0.00
                WHEN 'night' THEN 150.00
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
        pay_type,
        pay_rate,
        CASE pay_type
            WHEN 'daily' THEN pay_rate / 8
            WHEN 'monthly' THEN pay_rate / 30 / 8
        END AS hourly_rate
    FROM public.employees
),
calculated_payroll AS (
    SELECT
        p.id AS payroll_period_id,
        e.id AS employee_id,
        e.pay_type AS pay_type_used,
        e.pay_rate AS pay_rate_used,

        CASE e.pay_type
            WHEN 'monthly' THEN e.pay_rate
            WHEN 'daily' THEN
                CASE
                    WHEN w.employee_id IS NULL THEN 0.00
                    WHEN w.all_full_days
                    THEN e.pay_rate * w.recorded_days
                END
        END AS base_pay,

        ROUND(
            e.hourly_rate * 1.5
            * COALESCE(o.overtime_15_minutes, 0) / 60,
            2
        ) AS overtime_15_pay,

        ROUND(
            e.hourly_rate * 3
            * COALESCE(o.overtime_3_minutes, 0) / 60,
            2
        ) AS overtime_3_pay,

        COALESCE(w.meal_pay, 0.00) AS meal_pay,
        COALESCE(w.shift_pay, 0.00) AS shift_pay

    FROM employee_rates AS e
    CROSS JOIN selected_period AS p
    LEFT JOIN work_totals AS w
        ON w.employee_id = e.id
    LEFT JOIN overtime_totals AS o
        ON o.employee_id = e.id
)
INSERT INTO public.payroll_items (
    payroll_period_id,
    employee_id,
    pay_type_used,
    pay_rate_used,
    base_pay,
    overtime_15_pay,
    overtime_3_pay,
    meal_pay,
    shift_pay
)
SELECT
    payroll_period_id,
    employee_id,
    pay_type_used,
    pay_rate_used,
    base_pay,
    overtime_15_pay,
    overtime_3_pay,
    meal_pay,
    shift_pay
FROM calculated_payroll
ON CONFLICT (payroll_period_id, employee_id)
DO UPDATE SET
    pay_type_used = EXCLUDED.pay_type_used,
    pay_rate_used = EXCLUDED.pay_rate_used,
    base_pay = EXCLUDED.base_pay,
    overtime_15_pay = EXCLUDED.overtime_15_pay,
    overtime_3_pay = EXCLUDED.overtime_3_pay,
    meal_pay = EXCLUDED.meal_pay,
    shift_pay = EXCLUDED.shift_pay
RETURNING
    employee_id AS "เลขพนักงาน",
    base_pay AS "ค่าแรงพื้นฐาน",
    overtime_15_pay AS "โอที 1.5",
    overtime_3_pay AS "โอที 3",
    meal_pay AS "ค่าข้าว",
    shift_pay AS "ค่ากะ",
    gross_pay AS "รายได้รวม";