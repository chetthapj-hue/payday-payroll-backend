let csrfToken = '';
export function setAuthSession(session) { csrfToken = session?.csrf_token || ''; }
export async function api(path, options = {}) {
    let response;
    try {
        response = await fetch(`/api${path}`, {
            ...options,
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-PayDay-Request': '1',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
                ...options.headers,
            },
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('เชื่อมต่อ Backend ไม่ได้ กรุณาตรวจสอบว่าเปิดที่พอร์ต 3000 แล้ว', { cause: error });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 && path !== '/auth/login' && path !== '/auth/session') {
            setAuthSession(null);
            window.dispatchEvent(new Event('payday-session-expired'));
        }
        const error = new Error(result.message || 'ทำรายการไม่สำเร็จ กรุณาตรวจสอบ Backend');
        error.status = response.status; error.code = result.code;
        throw error;
    }
    return result.data;
}
export const money = value => new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number(value));
export const thaiDate = value => value ? new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`)) : 'ไม่ระบุ';
export function currentMonth() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export const workHours = minutes => `${new Intl.NumberFormat('th-TH', {
    maximumFractionDigits: 2,
}).format(Number(minutes) / 60)} ชม.`;

export function hoursToMinutes(hours) {
    if (!['string', 'number'].includes(typeof hours) || String(hours).trim() === '' ||
        !Number.isFinite(Number(hours)) || Number(hours) < 0 ||
        !Number.isSafeInteger(Math.round(Number(hours) * 60))) {
        throw new Error('กรุณากรอกชั่วโมงเป็นตัวเลขที่ถูกต้องและไม่ติดลบ');
    }
    return Math.round(Number(hours) * 60);
}

export function bangkokToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
export function payMonthForWorkDate(date) {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1 + (day >= 17 ? 1 : 0), 1)).toISOString().slice(0, 7);
}
export function overtimePayload(form) {
    const overtime_minutes = hoursToMinutes(form.overtime_hours);
    if (Number(form.overtime_hours) > 16) throw new Error('เวลาปกติและ OT รวมต้องไม่เกิน 24 ชม. ต่อวัน');
    const single = form.overtime_rate && form.overtime_rate !== 'split';
    if (single && !['1.5', '3', '3.0'].includes(String(form.overtime_rate))) throw new Error('OT อนุญาตเฉพาะ 1.5 และ 3.0 เท่า');
    if (Number(form.overtime_1x_hours ?? 0) !== 0 || Number(form.overtime_2x_hours ?? 0) !== 0) throw new Error('รายการเดิมมี OT อัตราอื่น ต้องตรวจทานก่อนแก้ไข');
    const overtime_3x_minutes = single ? (Number(form.overtime_rate) === 3 ? overtime_minutes : 0) : hoursToMinutes(form.overtime_3x_hours ?? 0);
    if (!single && Number(form.overtime_3x_hours ?? 0) > Number(form.overtime_hours)) throw new Error('OT 3 เท่าต้องไม่เกิน OT รวม');
    if (overtime_3x_minutes > overtime_minutes) throw new Error('OT 3 เท่าต้องไม่เกิน OT รวม');
    return { overtime_minutes, overtime_1x_minutes: 0, overtime_2x_minutes: 0, overtime_3x_minutes,
        ...(single ? { overtime_rate: Number(form.overtime_rate) } : {}) };
}
export function overtimeForm(log) {
    const total = log.overtime_minutes, triple = log.overtime_3x_minutes ?? 0;
    return { overtime_hours: String(total / 60), overtime_rate: triple > 0 && triple < total ? 'split' : triple > 0 ? '3' : '1.5',
        overtime_1x_hours: String((log.overtime_1x_minutes ?? 0) / 60), overtime_2x_hours: String((log.overtime_2x_minutes ?? 0) / 60), overtime_3x_hours: String(triple / 60) };
}
export function workTimePayload(form, { holidayDates = [] } = {}) {
    return { wage_multiplier: (isWeekend(form.work_date) || holidayDates.includes(form.work_date)) ? Number(form.wage_multiplier ?? 1) : 1,
        work_date: form.work_date, regular_minutes: 480, ...overtimePayload(form), shift_type: form.shift_type };
}

// Date inputs are Thai calendar dates; use UTC only to read their weekday without host timezone shifts.
export const isWeekend = date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
export const payrollMetrics = [
    ['recorded_days', 'จำนวนวันทำงาน', 'days'],
    ['sick_days', 'วันลาป่วย', 'days'],
    ['personal_days', 'วันลากิจ', 'days'],
    ['overtime_total_minutes', 'ชั่วโมง OT รวม', 'hours'],
    ['overtime_15_minutes', 'ชั่วโมง OT 1.5 เท่า', 'hours'],
    ['overtime_3_minutes', 'ชั่วโมง OT 3.0 เท่า', 'hours'],
    ['overtime_total_pay', 'เงิน OT รวม', 'money'],
];
export function metricValue(value, type) {
    if (value == null) return 'ไม่มีข้อมูลในรายงานเดิม';
    if (type === 'hours') return workHours(value);
    if (type === 'days') return `${value} วัน`;
    return `${money(value)} บาท`;
}

export const attendanceLabel = log => log.attendance_status === 'sick' ? `ลาป่วย (${log.leave_paid ? 'ได้เงิน' : 'ไม่ได้เงิน'})` : log.attendance_status === 'personal' ? `ลากิจ (${log.leave_paid ? 'ได้เงิน' : 'ไม่ได้เงิน'})` : log.source === 'auto' ? 'ทำงาน (อัตโนมัติ)' : 'ทำงาน';


// Keep legacy amounts readable without relabeling their hours as 1.5x.
export function workLogOvertime15Minutes(log) {
    return log.overtime_minutes - (log.overtime_3x_minutes ?? 0) - (log.overtime_1x_minutes ?? 0) - (log.overtime_2x_minutes ?? 0);
}
export function legacyOvertimeSummary(rows, workLogs = false) {
    return rows.reduce((summary, row) => {
        const direct = workLogs ? Number(row.overtime_1x_minutes ?? 0) + Number(row.overtime_2x_minutes ?? 0)
            : Number(row.overtime_1_minutes ?? 0) + Number(row.overtime_2_minutes ?? 0);
        const difference = !workLogs && [row.overtime_total_minutes, row.overtime_15_minutes, row.overtime_3_minutes].every(v => v != null)
            ? Math.max(0, Number(row.overtime_total_minutes) - Number(row.overtime_15_minutes) - Number(row.overtime_3_minutes)) : 0;
        const minutes = Math.max(direct, difference);
        const pay = Number(row.overtime_1_pay ?? 0) + Number(row.overtime_2_pay ?? 0);
        if (minutes > 0 || pay > 0) { summary.count++; summary.minutes += minutes; summary.pay += pay; }
        return summary;
    }, { count: 0, minutes: 0, pay: 0 });
}
