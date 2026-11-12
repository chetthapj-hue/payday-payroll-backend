SELECT
    e.employee_code AS "รหัสพนักงาน",
    e.full_name AS "ชื่อพนักงาน",
    e.pay_type AS "ประเภท",
    ROUND(
        SUM(
            CASE e.pay_type
                WHEN 'daily' THEN e.pay_rate / 8
                WHEN 'monthly' THEN e.pay_rate / 30 / 8
            END
            * 1.5
            * (w.overtime_minutes - w.overtime_3x_minutes)
            / 60
        ),
        2
    ) AS "ค่าโอที 1.5 รวม",
    ROUND(
        SUM(
            CASE e.pay_type
                WHEN 'daily' THEN e.pay_rate / 8
                WHEN 'monthly' THEN e.pay_rate / 30 / 8
            END
            * 3
            * w.overtime_3x_minutes
            / 60
        ),
        2
    ) AS "ค่าโอที 3 รวม",
    SUM(w.meal_allowance) AS "ค่าข้าวรวม",
    SUM(
        CASE w.shift_type
            WHEN 'night' THEN 150.00    
            WHEN 'day' THEN 0.00
        END
    ) AS "ค่ากะรวม"
FROM public.payroll_periods AS p
CROSS JOIN public.employees AS e
JOIN public.work_logs AS w
    ON w.employee_id = e.id
    AND w.work_date BETWEEN p.start_date AND p.end_date
WHERE p.id = 1
GROUP BY e.id, e.employee_code, e.full_name, e.pay_type
ORDER BY e.employee_code;   