import { useEffect, useState } from 'react';
import { api, bangkokToday, thaiDate } from './api';
export default function AttendanceSetup({ employees, onEmployeeSaved }) {
    const [status, setStatus] = useState(null);
    const [employeeId, setEmployeeId] = useState('');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [shift, setShift] = useState('');
    const [holiday, setHoliday] = useState('');
    const [label, setLabel] = useState('');
    const [reviewed, setReviewed] = useState('');
    const [launch, setLaunch] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    useEffect(() => {
        const c = new AbortController();
        api('/attendance/status', { signal: c.signal }).then(s => { setStatus(s); setReviewed(s.settings.holiday_reviewed_through || ''); setLaunch(s.settings.start_date || ''); }).catch(e => { if (!c.signal.aborted) setError(e.message); });
        return () => c.abort();
    }, []);
    function choose(value) {
        setEmployeeId(value);
        const e = employees.find(e => String(e.id) === value);
        setStart(e?.employment_start_date || ''); setEnd(e?.employment_end_date || ''); setShift(e?.auto_shift_type || '');
    }
    async function perform(fn) {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try { await fn(); setStatus(await api('/attendance/status')); setNotice('บันทึกแล้ว'); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    async function saveEmployee(e) {
        e.preventDefault();
        await perform(async () => {
            const row = await api(`/employees/${employeeId}/attendance`, { method: 'PUT', body: JSON.stringify({ employment_start_date: start, employment_end_date: end || null, auto_shift_type: shift || null }) });
            onEmployeeSaved({ ...employees.find(e => String(e.id) === employeeId), ...row });
        });
    }
    return <section className="rounded-2xl bg-white p-6 space-y-5"><h2 className="text-lg font-semibold">วันทำงานอัตโนมัติและวันหยุด</h2>
        {status && <><p>งานอัตโนมัติ: {status.settings.auto_enabled ? 'อนุญาตให้ scheduler ทำงาน (ต้องเปิดสวิตช์ของ scheduler ด้วย)' : 'ปิดอยู่'} · วันเริ่มใช้: {thaiDate(status.settings.start_date)}</p>
            <p>พนักงานเลือกลาได้เงิน/ไม่ได้เงินได้ ไม่มีค่าอาหารวันลา ลาไม่ได้เงินของรายเดือนหักเงินเดือน ÷ 30 ต่อวัน วันหยุดในปฏิทินให้ลงเวลาทำงานเอง</p></>}
        <form onSubmit={saveEmployee}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <label>ตั้งค่าการจ้างของพนักงาน<select required value={employeeId} onChange={e => choose(e.target.value)}><option value="">เลือกพนักงาน</option>{employees.map(e => <option key={e.id} value={e.id}>{e.employee_code} — {e.full_name}</option>)}</select></label>
            <label>วันเริ่มงานจริง<input required type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
            <label>วันสิ้นสุดการจ้าง (ถ้ามี)<input type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} /></label>
            <label>กะสำหรับงานอัตโนมัติ<select value={shift} onChange={e => setShift(e.target.value)}><option value="">ยังไม่กำหนด (ไม่สร้างงานอัตโนมัติ)</option><option value="day">กลางวัน</option><option value="night">กลางคืน</option></select></label>
            <button className="primary">บันทึกช่วงการจ้างและกะ</button>
        </fieldset></form>
        <form onSubmit={e => { e.preventDefault(); perform(() => api(`/attendance/holidays/${holiday}`, { method: 'PUT', body: JSON.stringify({ label }) })); }}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <label>วันที่หยุดของบริษัท<input required type="date" value={holiday} onChange={e => setHoliday(e.target.value)} /></label>
            <label>ชื่อวันหยุด<input required maxLength="200" value={label} onChange={e => setLabel(e.target.value)} /></label><button className="primary">เพิ่ม / แก้ไขวันหยุด</button>
        </fieldset></form>
        {status?.holidays.map(h => <p key={h.holiday_date}>{thaiDate(h.holiday_date)} — {h.label} <button disabled={busy} onClick={() => { setHoliday(h.holiday_date); setLabel(h.label); }}>แก้ไขวันหยุดนี้</button> <button disabled={busy} onClick={() => perform(() => api(`/attendance/holidays/${h.holiday_date}`, { method: 'DELETE' }))}>ลบวันหยุดนี้</button></p>)}
        <form onSubmit={e => { e.preventDefault(); perform(() => api('/attendance/settings', { method: 'PUT', body: JSON.stringify({ start_date: launch || null, holiday_mode: 'skip', holiday_reviewed_through: reviewed || null }) })); }}><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <label>วันเปิดฟีเจอร์ (กำหนดแล้วเปลี่ยนไม่ได้)<input type="date" min={bangkokToday()} disabled={Boolean(status?.settings.start_date)} value={launch} onChange={e => setLaunch(e.target.value)} /></label>
            <label>ตรวจรายการวันหยุดครบถึงวันที่<input required type="date" value={reviewed} onChange={e => setReviewed(e.target.value)} /></label><button className="primary">ยืนยันวันเริ่มและปฏิทินวันหยุด</button>
        </fieldset></form>
        {status && <button disabled={busy} onClick={() => perform(() => api('/attendance/settings', { method: 'PUT', body: JSON.stringify({ auto_enabled: !status.settings.auto_enabled }) }))}>{status.settings.auto_enabled ? 'ปิดงานอัตโนมัติ' : 'เปิดงานอัตโนมัติหลังยืนยันกติกาครบ'}</button>}
        {status?.runs.length > 0 && <p>รันล่าสุด: {new Date(status.runs[0].ran_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} · {status.runs[0].outcome} · เพิ่ม {status.runs[0].inserted} รายการ · พนักงานที่ยังตั้งค่าไม่ครบ {status.runs[0].missing_employee_setup} คน</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>;
}
