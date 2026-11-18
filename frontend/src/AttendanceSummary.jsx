import { workHours } from './api';
export default function AttendanceSummary({ logs }) {
    const count = status => logs.filter(l => (l.attendance_status || 'work') === status).length;
    return <p className="rounded-xl bg-white p-4">รวมรายการที่แสดง: ทำงาน {count('work')} วัน · ลาป่วย {count('sick')} วัน · ลากิจ {count('personal')} วัน · OT {workHours(logs.reduce((sum, l) => sum + l.overtime_minutes, 0))}</p>;
}
