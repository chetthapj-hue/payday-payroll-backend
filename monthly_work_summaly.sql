INSERT INTO public.work_logs (
    employee_id,
    work_date,
    regular_minutes,
    meal_allowance
)
VALUES (1, DATE '2026-11-11', 480, 40.00)
RETURNING work_date, regular_minutes, overtime_minutes, meal_allowance;