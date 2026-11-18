# OT, วันลา และวันทำงานอัตโนมัติ

สถานะงาน: โค้ดและ migration เตรียมไว้ใน checkout เท่านั้น ยังไม่ commit/push/deploy หรือ migrate production และยังไม่ได้สร้าง scheduler จริง วันเปิดฟีเจอร์และกะของพนักงานยังไม่กำหนด จึงปิด job เริ่มต้นทั้งในฐานและ environment

## สิ่งที่ตรวจจากระบบจริง

Build จาก root ใช้ `frontend/` ใน repo นี้ Express เสิร์ฟ `frontend/dist` ไม่อ่าน repo `payday-payroll-frontend` ที่อยู่ข้างนอก Working tree ก่อนเริ่มงานสะอาด ไม่พบ AGENTS.md ใน repo/เส้นทาง parent และ migration ล่าสุดก่อนงานคือ 004 ไม่ได้เชื่อม Render เพื่อยืนยันแผนบริการหรือประวัติ migration ที่รันจริง

รายงานเดิมใช้ snapshot ใน payroll_items และไม่มี API เปิดงวด/แก้ไข snapshot งานนี้ไม่เพิ่มการเขียนทับ snapshot แอดมินแก้ต้นทางได้ แต่หากต้องปรับยอดในรายงานที่บันทึกแล้วต้องกำหนดกระบวนการแก้งวดแยกต่างหาก พนักงานแก้ OT/วันลา/ยกเลิกวันลาไม่ได้เมื่อวันนั้นอยู่ในรอบค่าจ้าง **หรือ** รอบ OT ของงวดที่บันทึก/เผยแพร่แล้ว รวมงวดเก่าที่มี payroll_items แม้ saved_at ไม่ครบ

หากงวดเก่าไม่มีวันที่รอบ OT การตรวจสิทธิ์และ job จะป้องกันเดือนก่อนเดือนจ่ายตามรอบเดิม (ใช้เดือน end_date หากไม่มี payment_date) โดยไม่เขียนเติมวันที่หรือคำนวณยอด snapshot ใหม่

พบ schema.sql เดิมมีชื่อ constraint ชนกันตอนสร้างฐานใหม่ จึงตั้งชื่อ constraint ของ wage_multiplier ให้ชัดเจน เปลี่ยนเฉพาะ bootstrap schema ไม่แก้ migrations 001–004 หรือ constraint บนฐานเดิม

## กติกาที่ผู้ใช้ยืนยัน

- ลาป่วย/ลากิจ เลือกได้เงินหรือไม่ได้เงินได้โดยพนักงานเอง ไม่มีค่าอาหารและค่ากะวันลา
- ลาได้เงิน: รายวันได้ค่าแรงฐาน 1 วัน รายเดือนคงเงินเดือน
- ลาไม่ได้เงิน: รายวันไม่ได้เงินวันนั้น รายเดือนหักเงินเดือน / 30 ต่อวัน (ยอดฐานรายเดือนไม่ต่ำกว่า 0)
- ค่าอาหารและค่ากะของวันทำงานคงเดิม: 83 บาท เพิ่มอีก 83 บาทเมื่อ OT รวม >= 60 นาที; กะกลางคืน 150 บาท
- รอบค่าจ้าง/อาหาร/กะ 17–16 และ OT เดือนปฏิทินก่อน จ่าย 25 เดือนถัดไปคงเดิม สองแรงเพิ่มเฉพาะฐานค่าจ้างรายวัน OT ยังคำนวณจากค่าแรงฐานปกติ
- วันหยุดบริษัท/นักขัตฤกษ์เว้นงานอัตโนมัติ ให้ลงเอง แอดมินเพิ่ม/แก้ชื่อ/ลบวันหยุดได้
- ค่าแรงปกติเลือก 1/2/3 เท่าได้ในเสาร์–อาทิตย์หรือวันหยุดบริษัทที่กำหนด รายเดือนคงอัตราฐานเดิม ตัวคูณนี้ไม่เพิ่มฐานคำนวณ OT
- OT ใหม่ใช้ช่องชั่วโมงเดียวกับตัวเลือก 1 / 1.5 / 2 / 3 เท่า อัตราที่เลือกใช้กับ OT ทั้งหมดของวันนั้น รายการเก่าที่ผสมอัตราจะเข้าโหมดหลายอัตราและรักษาส่วนแบ่งเดิม ไม่มีการแปลงย้อนหลัง
- วันเปิดฟีเจอร์และกะอัตโนมัติยังไม่กำหนด ห้ามเดาจากกะล่าสุด วันเริ่ม/สิ้นสุดการจ้างต้องกรอกข้อมูลจริงรายคน

## การใช้หน้าจอ

ประวัติการทำงานมี **แก้ไข OT** กรอกชั่วโมงและเลือกอัตรา 1/1.5/2/3 แปลงและเก็บเป็นนาทีเต็ม ส่วนที่ไม่ใช่ 1/2/3 ยังคงเป็น 1.5 แบบเดิม Backend ตรวจ OT รวม 0–16 ชม., ส่วนแบ่ง 1+2+3 ไม่เกิน OT รวม และตรวจเจ้าของจาก session การแก้ปรับค่าอาหารตามเกณฑ์ปัจจุบันเฉพาะรายการที่แก้ ไม่คำนวณค่าอาหารเก่าทั้งฐานใหม่

พนักงานมี **ลงวันลา** เลือกวันที่ ประเภท และได้เงิน/ไม่ได้เงิน วันลารับวันที่ไม่เกินวันนี้ไทยและอยู่ในช่วงจ้างจริง แอดมินลงลาแทนได้ในหน้าบันทึกการทำงาน เปลี่ยนวันทำงานอัตโนมัติที่ไม่มี OT เป็นลาในแถวเดิม ไม่สร้างวันซ้ำ แก้ประเภท/การได้เงินและยกเลิกลาได้จากประวัติ

ถ้าชนงานที่ลงเองหรือมี OT พนักงานจะได้ conflict แอดมินเห็นรายการเดิมและต้องกดยืนยันแทนที่ก่อน Backend ตรวจ confirmation token จากค่ารายการจริง หากมีคนแก้ระหว่างนั้นให้ตรวจใหม่ ไม่มีการเขียนทับเงียบ ๆ ยกเลิกลาที่เปลี่ยนจากงานจะคืนงาน/กะ/OT/ตัวคูณ/ค่าอาหารเดิม ลาที่สร้างขึ้นโดยไม่มีงานเดิมจะลบเฉพาะแถววันลานั้นและเก็บ audit ไว้ ถ้า job เปิดอยู่จะตามเติมวันทำงานที่เข้าเงื่อนไขในการรันครั้งถัดไป

แอดมินมีเมนู **วันทำงาน / วันหยุด** ตั้งช่วงจ้าง กะ ปฏิทินวันหยุด วันเปิดฟีเจอร์ และสวิตช์ job ต้องยืนยันว่าตรวจปฏิทินครบถึงวันที่ใด เมื่อเกินวันนั้น job จะหยุดพร้อม error เพื่อไม่เดาว่าวันที่ยังไม่ตรวจเป็นวันทำงาน

จำนวนวันทำงานจริงไม่รวมลา แสดงลาป่วย/ลากิจและ OT แยกกันในประวัติและยอดคำนวณใหม่ ประวัติแอดมินรวมเฉพาะ 100 รายการที่แสดง; พนักงานรวมเดือนที่เลือก ส่วน payroll ใช้ช่วงค่าจ้าง/OT คนละช่วงอย่างเดิม รายงานเก่าที่ไม่มี metrics ใหม่แสดงว่าไม่มีข้อมูล ไม่เติมจากข้อมูลสด

## Migration และ deploy (ขั้นตอนสำหรับภายหลัง ยังไม่ได้รันจริง)

1. Review checkout นี้ก่อนนำขึ้น branch ที่ Render ใช้ รักษา env/ข้อมูลเดิม ตั้ง `PAYDAY_AUTO_ATTENDANCE=false` และยังไม่เปิดสวิตช์ในฐาน
2. ใช้ staging/ฐานทดสอบรัน build, migrate และ tests ก่อน production
3. เมื่อโค้ดอยู่ใน runtime ที่จะ deploy แล้ว รันจาก repo root โดยใช้ DATABASE_URL ที่ตั้งใน environment ฝั่ง server อยู่แล้ว:

   ```sh
   npm ci --prefix server
   npm run migrate
   ```

   migrate.js เดิมรัน SQL ทุกไฟล์ตามชื่อซ้ำได้ รวม 005 และ 006 ใหม่ ไม่ใช้ db:init, schema.sql, seed, reset หรือ SQL ทดลองกับฐานเดิม 005 เพิ่มคอลัมน์/ตาราง ส่วน 006 เพิ่ม OT 1/2 และแทนที่เฉพาะ CHECK ของตัวคูณด้วยเงื่อนไข 1/2/3 พร้อม trigger ตรวจเสาร์อาทิตย์/ปฏิทินบริษัท ไม่ลบตารางหรือข้อมูล ไม่เปลี่ยนยอด/ชื่อใน snapshot และไม่ตั้งวันเริ่มหรือกะให้พนักงาน
4. Render Web Service: Root Directory ว่าง (root ของ repo), Build Command `npm run build`, Start Command `npm start`, Node ตาม .node-version, NODE_ENV=production, TRUST_PROXY=1, COOKIE_SECURE=true ตาม RENDER.md ให้ migration เสร็จก่อนรับ request ของโค้ดใหม่ หากแผนไม่มี Shell ให้รัน migration จากเครื่องที่มี checkout นี้โดยตั้ง DATABASE_URL อย่างปลอดภัย ไม่พิมพ์ URL หรือใส่ใน command arguments
5. ตรวจ login, ประวัติ, OT/วันลาและรายงานเก่า ขณะ job ยังปิด ยืนยันว่า snapshot เดิมเท่าเดิม

ไม่ต้องเปิดฟีเจอร์อัตโนมัติเพียงเพราะ deploy สำเร็จ วันลาใช้งานหลัง migrate และกำหนดช่วงจ้างจริงได้ตามนโยบายที่ยืนยันแล้ว

## Scheduler บน Render

อ้างอิงเอกสารทางการที่ตรวจ 2026-11-18: [Cron Jobs](https://render.com/docs/cronjobs), [Free service limitations](https://render.com/docs/free) Free web service พักหลังไม่มี inbound traffic 15 นาที จึงไม่มี setInterval ใน web process และไม่ใช้การเปิดหน้าเว็บเรียกงาน Cron service แยกมีค่าใช้จ่ายและรันได้แม้ web process พัก; ยังไม่ได้สร้างบริการหรือยืนยันแพ็กเกจจริงของบัญชี

เตรียม Render Cron Job แยก ใช้ repo/branch เดียวกันและ root ว่าง:

| ค่า | ตั้งเป็น |
| --- | --- |
| Build Command | `npm ci --prefix server` |
| Command | `npm run attendance:run` |
| Schedule | `10 * * * *` (ทุกชั่วโมงนาทีที่ 10; Render ใช้ UTC) |
| DATABASE_URL | ฐานเดียวกับ web จาก environment ที่ปลอดภัย ใช้ internal connection หากตั้งอยู่ใน region เดียวกัน |
| PAYDAY_AUTO_ATTENDANCE | `false` จนตรวจพร้อม แล้วจึง `true` เฉพาะ cron runtime |

แต่ละรันคำนวณวันที่ Asia/Bangkok เอง และออกจาก process เมื่อเสร็จ ไม่ต้องตั้ง TZ ของเครื่องให้ตรง Job ตามเก็บตั้งแต่วันเปิดฟีเจอร์ถึงวันนี้ รวมวันที่ service หยุด แต่ไม่เติมก่อนเริ่มฟีเจอร์/เริ่มจ้าง หลังสิ้นสุดจ้าง วันเสาร์อาทิตย์ วันหยุดบริษัท หรือวันที่มีผลต่องวดปิดทั้งสองรอบ

เปิดใช้ภายหลัง:

1. กำหนดช่วงจ้างจริง/กะรายคน และปฏิทินวันหยุดในเมนูแอดมิน
2. กำหนดวันเปิดฟีเจอร์ให้ชัด (ครั้งแรกเป็นวันนี้หรืออนาคต ห้ามย้อนหลัง; เมื่อกำหนดแล้วเปลี่ยนไม่ได้) และยืนยันปฏิทินวันหยุดล่วงหน้า
3. เปิดสวิตช์จากเมนูแอดมิน และตั้ง PAYDAY_AUTO_ATTENDANCE=true ใน Cron Job ต้องเปิดทั้งคู่จึงเขียนข้อมูล
4. ใช้ Trigger Run ใน Render หรือรัน `npm run attendance:run` ใน runtime เดียวกัน แล้วตรวจผล

ปิด: ปิดสวิตช์ในหน้าจอ **หรือ** ตั้ง PAYDAY_AUTO_ATTENDANCE=false ใน Cron Job แล้วหยุด cron หากไม่ต้องการให้บันทึกการรัน การปิดไม่ลบงานที่สร้างไปแล้วและจะมีผลกับรันถัดไป (รันที่กำลังทำอยู่จะจบ transaction เดิมก่อน) กลับมาเปิดจะตามเก็บช่วงที่ขาดโดยไม่แตะงวดปิด

ปิดสวิตช์ในฐานผ่าน CLI ได้ด้วย เมื่อกำหนด DATABASE_URL ใน environment อย่างปลอดภัยแล้ว:

```sh
printf '%s\n' '{"auto_enabled":false}' | npm run attendance:configure
```

CLI รับ JSON ทาง stdin และใช้ validation/transaction เดียวกับหน้าจอ ไม่แสดงข้อมูลเชื่อมต่อ

ตรวจผล: Render Runs/logs จะแสดง JSON ที่ไม่มี URL/รหัสผ่าน/hash เช่น outcome=ok, through_date, inserted และ missing_employee_setup; inserted=0 ในการรันซ้ำถือว่าปกติ หน้าจอแอดมินแสดงรันล่าสุด อ่านย้อนหลังได้ที่ GET /api/attendance/status (admin) และตาราง attendance_job_runs ถ้า outcome=incomplete_employee_setup แสดงจำนวนพนักงานที่ยังไม่ได้กรอกวันเริ่ม/กะ และ CLI ออก code 1; รายที่พร้อมยังสร้างงานแล้ว ถ้า error ทั้ง transaction rollback และ CLI ออก code 1 โดยไม่พิมพ์ driver error ตรวจ migration, การเชื่อมต่อ และวันสิ้นสุดการตรวจปฏิทินก่อนรันใหม่

Unique(employee_id,work_date) ที่มีอยู่ + ON CONFLICT DO NOTHING ป้องกันซ้ำ Advisory transaction lock เดียวกับ payroll/save และทุกเส้นทางลงงาน/แก้ OT/ลา/job ป้องกันการชนและตรวจงวดปิดอย่างสอดคล้อง แม้มีหลาย instance/job หลายชุด Source=auto/manual/leave แยกความหมายชัด ไม่มีการเดาหรือเติม OT

Audit ของ OT/วันลา/job อยู่ attendance_audit เก็บ account id, role, เวลา และค่าที่อนุญาตก่อน/หลังเท่านั้น แอดมินอ่าน GET /api/work-logs/:id/audit ไม่เก็บ request body ทั้งก้อนหรือข้อมูล auth/session

## ทดสอบ

TEST_DATABASE_URL ต้องเป็นฐานทดสอบ payday*_test* แยกจริง ห้ามใช้ URL production ตัว setup ปฏิเสธฐานที่มีอยู่แล้วและสร้างเฉพาะฐานใหม่:

```sh
# ตั้ง TEST_DATABASE_URL ใน environment อย่างปลอดภัยก่อน
node server/tests/setup-test-db.js   # เฉพาะครั้งแรกของฐานทดสอบใหม่
npm test
npm run lint
npm run build
npm run check:git
```

ชุดทดสอบตรวจสิทธิ์/CSRF/เจ้าของ, validation OT, ค่าอาหาร 59/60 นาที, audit/rollback, หน้าต่างค่าจ้างและ OT/16–17/สิ้นเดือน, paid/unpaid leave, แปลง/ยกเลิก/ไม่ซ้ำ/conflict confirmation, job ซ้ำ/หลาย connection/ชน manual/leave/payroll save, วันเริ่ม-สิ้นสุดจ้าง/วันหยุด/พนักงานปิดสถานะ, Bangkok midnight, สองแรงไม่เพิ่มฐาน OT และ migration/snapshot เดิมไม่เปลี่ยน

ทดสอบ Chrome บน Express production build (ทดสอบคนละขั้นกับ deploy จริง):

```sh
# Terminal 1: DATABASE_URL ต้องเป็นฐานทดสอบเดียวกับ TEST_DATABASE_URL เท่านั้น
DATABASE_URL="$TEST_DATABASE_URL" NODE_ENV=production TRUST_PROXY=0 COOKIE_SECURE=false PORT=3119 npm start
# Terminal 2: ใช้ playwright-core ที่ติดตั้งใน /tmp ตามคู่มือทดสอบเดิม
PAYDAY_TEST_BASE_URL=http://127.0.0.1:3119 PLAYWRIGHT_MODULE=/tmp/payday-browser/node_modules/playwright-core/index.mjs npm run test:browser:attendance
```

Browser runner ล้างเฉพาะ fixture ในฐานทดสอบและตรวจฐานของ backend ก่อน browser writes ผลรูปอยู่ /tmp/payday-browser/attendance.png ไม่มีการเก็บ session หรือรหัสผ่านลง screenshot/log

ชุด Chrome เดิมปรับให้ใช้ตัวเลือกอัตรา OT และคอลัมน์ประวัติใหม่ ส่วน fixture หลายอัตราเดิมยังสร้างผ่าน API เพื่อยืนยันสูตรเดิม และเปลี่ยนวันที่ทดสอบที่เคยอยู่ในอนาคตให้เป็นอดีตตามข้อห้ามลงงานล่วงหน้า

ผลตรวจในงานนี้: ชุดทดสอบ Node ผ่าน 58 รายการ; lint, production build และ check:git ผ่าน; Chrome ทั้ง 5 ชุดผ่านบน Express production build/ฐานทดสอบ PostgreSQL 18 ชั่วคราว รวม desktop/mobile, auth, employee lifecycle, self-service และ attendance ไม่มี page error ไม่ได้รันทดสอบบน Render หรือ production database
