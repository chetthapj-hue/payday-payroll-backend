// Shared by API writes, payroll's bound SQL values, and both production forms.
export const OT_MEAL_MINUTES = 30;
export const NORMAL_MEAL_BAHT = 83;
export const OT_MEAL_BAHT = 83;
export function workingMealAllowance(overtimeMinutes) {
    return NORMAL_MEAL_BAHT + (overtimeMinutes >= OT_MEAL_MINUTES ? OT_MEAL_BAHT : 0);
}
export const MEAL_POLICY_NOTICE = 'ค่าอาหาร OT เพิ่ม 83 บาทต่อวันเมื่อ OT รวมตั้งแต่ 0.5 ชั่วโมง (30 นาที) เพียงครั้งเดียว รายการเดิมในงวดเปิดอาจมีค่าอาหารเพิ่มขึ้นเมื่อคำนวณใหม่ โดยไม่เปลี่ยนยอดรายงานที่บันทึกแล้ว';
