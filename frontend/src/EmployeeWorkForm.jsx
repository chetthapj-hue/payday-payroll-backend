import { workingMealAllowance } from '../../shared/meal-allowance.js';
import OvertimeFields from './OvertimeFields';
import { useEffect, useState } from 'react';
import { api, isWeekend, bangkokToday, money, workHours, workTimePayload } from './api';

export default function EmployeeWorkForm({ onCreated }) {
    const [form, setForm] = useState(() => ({ work_date: bangkokToday(), shift_type: 'day', wage_multiplier: '1', overtime_rate: '1.5', overtime_hours: '0', overtime_3x_hours: '0' }));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [holidayDates, setHolidayDates] = useState([]);
    useEffect(() => {
        const c = new AbortController();
        api('/me/attendance-policy', { signal: c.signal }).then(s => setHolidayDates(s.holiday_dates)).catch(e => { if (!c.signal.aborted) setError(e.message); });
        return () => c.abort();
    }, []);
    const today = bangkokToday();
    const change = e => setForm(current => ({ ...current, [e.target.name]: e.target.value, ...(e.target.name === 'work_date' ? { wage_multiplier: '1' } : {}) }));
    async function submit(e) {
        e.preventDefault(); if (saving) return;
        setError(''); setSuccess('');
        let body;
        try {
            if (form.work_date > bangkokToday()) throw new Error('ไม่สามารถลงเวลาวันในอนาคตได้ (วันที่ประเทศไทย)');
            body = workTimePayload(form, { holidayDates });
        } catch (error) { return setError(error.message); }
        setSaving(true);
        try {
            const row = await api('/me/work-logs', { method: 'POST', body: JSON.stringify(body) });
            onCreated(row);
            setSuccess('ลงเวลาสำเร็จ ประวัติและยอดสะสมอัปเดตแล้ว');
        } catch (error) { setError(error.message); }
        finally { setSaving(false); }
    }
    return <section aria-labelledby="self-work-heading" className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 id="self-work-heading" className="mb-4 text-lg font-semibold">ลงเวลาทำงาน</h2>
        <p className="mb-4 text-sm text-slate-600">บันทึกสำหรับบัญชีของคุณเท่านั้น เลือกวันนี้หรือย้อนหลังตามวันที่ประเทศไทย</p>
        <form onSubmit={submit}><fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
            <label>วันที่ทำงาน<input aria-label="วันที่ทำงาน" required type="date" name="work_date" max={today} value={form.work_date} onChange={change} /></label>
            {(isWeekend(form.work_date) || holidayDates.includes(form.work_date)) && <label>ค่าแรงเสาร์–อาทิตย์ / วันหยุด<select name="wage_multiplier" value={form.wage_multiplier} onChange={change}><option value="1">ค่าแรงปกติ (1 เท่า)</option><option value="2">ค่าแรง 2 เท่า</option><option value="3">ค่าแรง 3 เท่า</option></select><span className="text-sm text-slate-500">ใช้กับค่าจ้างปกติรายวัน รายเดือนคงอัตราเดิม</span></label>}
            <label>เวลาปกติ<input aria-label="เวลาปกติ" readOnly value={workHours(480)} /><span className="text-sm text-slate-500">เวลาปกติเต็มวัน 8 ชม.</span></label>
            <label>กะ<select aria-label="กะ" name="shift_type" value={form.shift_type} onChange={change}><option value="day">กลางวัน</option><option value="night">กลางคืน (ค่ากะ 150 บาท)</option></select></label>
            <OvertimeFields form={form} onChange={change} />
            <p>ค่าอาหาร: <strong>{money(workingMealAllowance(Math.round(Number(form.overtime_hours) * 60)))} บาท</strong><br /><span className="text-sm text-slate-500">ฐาน 83 บาท + เพิ่ม 83 บาทเมื่อ OT รวมตั้งแต่ 0.5 ชม. (30 นาที) เก็บรวมครั้งเดียว</span></p>
            <p className="text-sm text-slate-500 sm:col-span-2">กรอกทศนิยมได้ เช่น 1.5 ชม. หรือ 0.25 ชม. ปัดเป็นนาทีเต็มที่ใกล้ที่สุดก่อนบันทึก</p>
            <button className="primary sm:col-span-2">{saving ? 'กำลังบันทึก…' : 'บันทึกเวลาของฉัน'}</button>
        </fieldset></form>
        {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
        {success && <p role="status" className="mt-4 text-green-700">{success}</p>}
    </section>;
}
