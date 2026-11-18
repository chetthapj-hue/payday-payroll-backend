import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeekend, workTimePayload, metricValue, payMonthForWorkDate, overtimeForm, overtimePayload } from '../../frontend/src/api.js';

test('weekend forms submit selected multiplier and reset to normal on weekdays', () => {
 const form={work_date:'2025-10-18',shift_type:'day',wage_multiplier:'2',overtime_hours:'2',overtime_3x_hours:'0.5'};
 assert.equal(isWeekend(form.work_date),true);
 const body=workTimePayload(form);
 assert.equal(body.wage_multiplier,2); assert.equal(body.overtime_minutes,120); assert.equal(body.overtime_3x_minutes,30);
 assert.equal(workTimePayload({...form,work_date:'2025-10-20'}).wage_multiplier,1);
 assert.equal(payMonthForWorkDate('2025-10-16'),'2025-10');
 assert.equal(payMonthForWorkDate('2025-10-17'),'2025-11');
});
test('report metrics distinguish legacy missing values from zero', () => {
 assert.equal(metricValue(null,'hours'),'ไม่มีข้อมูลในรายงานเดิม');
 assert.equal(metricValue(0,'days'),'0 วัน');
 assert.equal(metricValue(120,'hours'),'2 ชม.');
 assert.equal(metricValue('150.00','money'),'150.00 บาท');
});

test('company holiday or weekend can submit three times wage; ordinary weekday resets to one',()=>{
 const form={work_date:'2025-10-20',shift_type:'day',wage_multiplier:'3',overtime_hours:'2',overtime_3x_hours:'0'};
 assert.equal(workTimePayload(form,{holidayDates:['2025-10-20']}).wage_multiplier,3);
 assert.equal(workTimePayload(form).wage_multiplier,1);
 assert.equal(workTimePayload({...form,work_date:'2025-10-18'}).wage_multiplier,3);
});


test('one OT hours input selects 1/1.5/2/3; legacy mixed rates round trip without conversion',()=>{
 for(const rate of ['1','1.5','2','3']) {
  const payload=overtimePayload({overtime_hours:'2',overtime_rate:rate});
  assert.equal(payload.overtime_minutes,120);
  for(const component of [1,2,3])assert.equal(payload[`overtime_${component}x_minutes`],rate===String(component)?120:0);
 }
 const mixed={overtime_minutes:120,overtime_1x_minutes:0,overtime_2x_minutes:0,overtime_3x_minutes:30};
 const form=overtimeForm(mixed);assert.equal(form.overtime_rate,'split');assert.deepEqual(overtimePayload(form),mixed);
 assert.throws(()=>overtimePayload({...form,overtime_3x_hours:'3'}),/ส่วนแบ่ง/);
});
