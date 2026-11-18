import OvertimeFields from './OvertimeFields';
import { useState } from 'react';
import { api, overtimePayload, overtimeForm, thaiDate } from './api';

export default function AttendanceActions({ log, employee = false, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(() => overtimeForm(log));
    const [type, setType] = useState(log.attendance_status === 'personal' ? 'personal' : 'sick');
    const [paid, setPaid] = useState(Boolean(log.leave_paid));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const prefix = employee ? '/me' : '';
    const isLeave = log.attendance_status && log.attendance_status !== 'work';
    async function save(e, cancel = false) {
        e.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
            let path, method, body;
            if (cancel) { path = `${prefix}/leaves/${log.id}`; method = 'DELETE'; }
            else if (isLeave) {
                path = `${prefix}/leaves`; method = 'POST';
                body = { employee_id: log.employee_id, work_date: log.work_date, type, paid };
            } else {
                path = `${prefix}/work-logs/${log.id}/overtime`; method = 'PATCH';
                body = overtimePayload(form);
            }
            const row = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
            setEditing(false); await onSaved(row);
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    return <div className="min-w-40 space-y-2">
        <button type="button" onClick={() => { if (!editing) { setForm(overtimeForm(log)); setType(log.attendance_status === 'personal' ? 'personal' : 'sick'); setPaid(Boolean(log.leave_paid)); } setEditing(v => !v); setError(''); }}>{isLeave ? 'แก้ไขวันลา' : 'แก้ไข OT'}</button>
        {editing && <form onSubmit={save} aria-label={`แก้ไข ${thaiDate(log.work_date)}`}><fieldset disabled={busy} className="space-y-2">
            {isLeave ? <label>ประเภทวันลา<select value={type} onChange={e => setType(e.target.value)}><option value="sick">ลาป่วย</option><option value="personal">ลากิจ</option></select></label> : <OvertimeFields form={form} onChange={e => setForm(current => ({ ...current, [e.target.name]: e.target.value }))} />}
            {!employee && <p className="text-sm">เปลี่ยนต้นทางเท่านั้น ยอดในรายงานที่บันทึกแล้วคงเดิม</p>}
            <button className="primary">บันทึกการแก้ไข</button>
            {isLeave && <label>ค่าแรงวันลา<select value={String(paid)} onChange={e => setPaid(e.target.value === 'true')}><option value="false">ลาไม่ได้เงิน</option><option value="true">ลาได้เงิน</option></select><span className="text-sm">ไม่มีค่าอาหารทั้งสองแบบ</span></label>}
            {isLeave && <button type="button" onClick={e => save(e, true)}>ยกเลิกวันลา</button>}
        </fieldset></form>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>;
}
