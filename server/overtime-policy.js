const fail = (status,message,code) => Object.assign(new Error(message),{status,code});
export function hasLegacyOvertime(row) {
 return (row.overtime_1x_minutes ?? 0)>0 || (row.overtime_2x_minutes ?? 0)>0;
}
export function validateOvertimeRates(input) {
 for(const key of ['overtime_1x_minutes','overtime_2x_minutes']) {
  if(input?.[key]!==undefined && input[key]!==0) throw fail(400,'OT อนุญาตเฉพาะ 1.5 และ 3.0 เท่า','INVALID_OT_RATE');
 }
 if(input?.overtime_rate!==undefined) {
  const rate=input.overtime_rate;
  if(!['number','string'].includes(typeof rate) || ![1.5,3].includes(Number(rate))) throw fail(400,'OT อนุญาตเฉพาะ 1.5 และ 3.0 เท่า','INVALID_OT_RATE');
  if((Number(rate)===3 && input.overtime_3x_minutes!==input.overtime_minutes) || (Number(rate)===1.5 && input.overtime_3x_minutes!==0))
   throw fail(400,'ส่วนแบ่ง OT ไม่ตรงกับอัตราที่เลือก','INVALID_OT_RATE');
 }
}
