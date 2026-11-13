SELECT
    p.period_name AS "งวดเงินเดือน",
    p.payment_date AS "วันจ่าย",
    i.employee_code_snapshot AS "รหัสพนักงานของพวกมึงไง",
    i.full_name_snapshot AS "ชื่อไอ้เด็กเชี่ย",
    i.pay_type_used AS "ประเภทค่าจ้าง",
    i.pay_rate_used AS "อัตราค่าจ้างที่ใช้",
    COALESCE(i.recorded_days::text, 'ไม่มีข้อมูลในรายงานเดิม') AS "จำนวนวันทำงาน",
    COALESCE(ROUND(i.overtime_total_minutes / 60.0, 2)::text, 'ไม่มีข้อมูลในรายงานเดิม') AS "ชั่วโมง OT รวม",
    COALESCE(ROUND(i.overtime_15_minutes / 60.0, 2)::text, 'ไม่มีข้อมูลในรายงานเดิม') AS "ชั่วโมง OT 1.5 เท่า",
    COALESCE(ROUND(i.overtime_3_minutes / 60.0, 2)::text, 'ไม่มีข้อมูลในรายงานเดิม') AS "ชั่วโมง OT 3 เท่า",
    COALESCE(i.overtime_total_pay, i.overtime_15_pay + i.overtime_3_pay) AS "เงิน OT รวม",
    i.base_pay AS "ค่าแรงพื้นฐาน",
    i.overtime_15_pay AS "โอที 1.5",
    i.overtime_3_pay AS "โอที 3",
    i.meal_pay AS "ค่าข้าว",
    i.shift_pay AS "ค่ากะ",
    i.gross_pay AS "รายได้รวม"
FROM public.payroll_items AS i
JOIN public.payroll_periods AS p
    ON p.id = i.payroll_period_id
WHERE i.payroll_period_id = 1 AND p.saved_at IS NOT NULL
ORDER BY i.employee_code_snapshot;
