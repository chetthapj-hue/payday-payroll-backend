import { legacyOvertimeSummary, workHours, money } from './api';
export default function LegacyOvertimeNotice({ rows, workLogs = false }) {
    const legacy = legacyOvertimeSummary(rows, workLogs);
    if (!legacy.count) return null;
    return <p role="note" className="rounded-xl bg-amber-50 p-4 text-amber-900">
        พบข้อมูล OT อัตราเดิมอื่น {legacy.count} {workLogs ? 'รายการทำงาน' : 'รายการพนักงาน'}
        {legacy.minutes > 0 && <> รวม {workHours(legacy.minutes)}</>}
        {legacy.pay > 0 && <> / ยอด OT อัตราเดิม {money(legacy.pay)} บาท</>}
        {' '}ยังคงข้อมูลและยอดเดิมไว้ ไม่แปลงอัตรา รายละเอียดเฉพาะ 1.5/3.0 ที่แสดงจึงอาจไม่ครบยอด OT รวม ต้องตรวจทานก่อนจัดการรายการเหล่านี้
    </p>;
}
