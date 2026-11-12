SELECT
    p.period_name AS "งวด",
    e.employee_code AS "รหัสพนักงาน",
    e.full_name AS "ชื่อพนักงาน",
    COUNT(w.id) AS "วันที่มีบันทึก",
    ROUND(
        COALESCE(SUM(w.overtime_minutes), 0) / 60.0,
        2
    ) AS "ชั่วโมงโอทีรวม",
    COALESCE(SUM(w.meal_allowance), 0.00) AS "ค่าข้าวรวม"
FROM public.payroll_periods AS p
CROSS JOIN public.employees AS e
LEFT JOIN public.work_logs AS w
    ON w.employee_id = e.id
    AND w.work_date BETWEEN p.start_date AND p.end_date
WHERE p.id = 1
GROUP BY p.id, p.period_name, e.id, e.employee_code, e.full_name
ORDER BY e.employee_code;   