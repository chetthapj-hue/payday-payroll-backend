export default function OvertimeFields({ form, onChange }) {
    return <>
        <label>OT รวม<span className="flex items-center gap-2"><input aria-label="OT รวม" required type="number" min="0" max="16" step="any" name="overtime_hours" value={form.overtime_hours} onChange={onChange} /><span>ชม.</span></span></label>
        <label>อัตรา OT<select aria-label="อัตรา OT" name="overtime_rate" value={form.overtime_rate} onChange={onChange}>
            {form.overtime_rate === 'split' && <option value="split">หลายอัตรา (รายการเดิม)</option>}
            {[1, 1.5, 2, 3].map(rate => <option key={rate} value={String(rate)}>{rate} เท่า</option>)}
        </select><span className="text-sm text-slate-500">อัตราที่เลือกใช้กับชั่วโมง OT ทั้งหมด โดยใช้ค่าแรงฐานปกติ</span></label>
        {form.overtime_rate === 'split' && <>
            {[['1x', '1'], ['2x', '2'], ['3x', '3']].map(([key, label]) => <label key={key}>OT {label} เท่า (ชม.)<input aria-label={`OT ${label} เท่า (ชม.)`} required type="number" min="0" max={form.overtime_hours} step="any" name={`overtime_${key}_hours`} value={form[`overtime_${key}_hours`]} onChange={onChange} /></label>)}
            <p className="text-sm">ส่วนที่เหลือเป็น OT 1.5 เท่า รายการนี้เก็บหลายอัตราไว้เดิม หากเปลี่ยนตัวเลือก อัตราใหม่จะใช้กับ OT ทั้งหมด</p>
        </>}
    </>;
}
