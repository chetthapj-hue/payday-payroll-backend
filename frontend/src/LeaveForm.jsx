import { useState } from 'react';
import { api, bangkokToday, workHours, money } from './api';
export default function LeaveForm({ employees, onSaved }) {
    const [date, setDate] = useState(bangkokToday);
    const [employeeId, setEmployeeId] = useState('');
    const [type, setType] = useState('sick');
    const [paid, setPaid] = useState(false);
    const [conflict, setConflict] = useState(null);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    async function submit(e) {
        e.preventDefault(); if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const row = await api(employees ? '/leaves' : '/me/leaves', { method: 'POST', body: JSON.stringify({ work_date: date, type, paid, ...(conflict && confirmed ? { replace_work_token: conflict.replace_work_token } : {}), ...(employees ? { employee_id: Number(employeeId) } : {}) }) });
            setConflict(null); setConfirmed(false); setMessage('บันทึกวันลาแล้ว'); await onSaved(row);
        } catch (e) {
            setError(e.message);
            if (employees && e.code === 'LEAVE_CONFLICT') {
                try { setConflict(await api(`/attendance/day?employee_id=${employeeId}&date=${date}`)); setConfirmed(false); }
                catch (lookupError) { setError(lookupError.message); }
            }
        } finally { setBusy(false); }
    }
    return <section className="rounded-2xl bg-white p-6 space-y-4"><h2 className="font-semibold">ลาป่วย / ลากิจ</h2>
        <p>วันลาไม่นับเป็นวันทำงาน หากมี OT หรือรายการลงงานเอง ระบบจะแจ้งให้ตรวจสอบก่อน</p>
        <form onSubmit={submit}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            {employees && <label>พนักงานที่ลา<select required value={employeeId} onChange={e => { setEmployeeId(e.target.value); setConflict(null); setConfirmed(false); }}><option value="">เลือกพนักงาน</option>{employees.filter(e => e.is_active).map(e => <option key={e.id} value={e.id}>{e.employee_code} — {e.full_name}</option>)}</select></label>}
            <label>วันที่ลา<input required type="date" max={bangkokToday()} value={date} onChange={e => { setDate(e.target.value); setConflict(null); setConfirmed(false); }} /></label>
            <label>ประเภทวันลา<select value={type} onChange={e => setType(e.target.value)}><option value="sick">ลาป่วย</option><option value="personal">ลากิจ</option></select></label>
            <label>ค่าแรงวันลา<select value={String(paid)} onChange={e => setPaid(e.target.value === 'true')}><option value="false">ลาไม่ได้เงิน</option><option value="true">ลาได้เงิน</option></select><span className="text-sm">ไม่มีค่าอาหารทั้งสองแบบ</span></label>
            {conflict && <div className="sm:col-span-2 rounded-xl bg-amber-50 p-4"><p>รายการเดิม: OT รวม {workHours(conflict.row.overtime_minutes)} / OT 1 เท่า {workHours(conflict.row.overtime_1x_minutes)} / OT 2 เท่า {workHours(conflict.row.overtime_2x_minutes)} / OT 3 เท่า {workHours(conflict.row.overtime_3x_minutes)} · กะ {conflict.row.shift_type === 'night' ? 'กลางคืน' : 'กลางวัน'} · ค่าแรง {conflict.row.wage_multiplier} เท่า · ค่าอาหาร {money(conflict.row.meal_allowance)} บาท</p><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> ยืนยันแทนที่รายการนี้ด้วยวันลาและยกเลิก OT ที่แสดง โดยเก็บประวัติก่อน/หลัง รายงานที่บันทึกแล้วคงเดิม</label></div>}
            <button className="primary" disabled={Boolean(conflict && !confirmed)}>{conflict ? 'ยืนยันเปลี่ยนรายการเป็นวันลา' : 'บันทึกวันลา'}</button>
        </fieldset></form>
        {error && <p role="alert" className="text-red-700">{error}</p>}{message && <p role="status">{message}</p>}
    </section>;
}
