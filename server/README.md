สำหรับ deploy origin เดียว ให้ใช้ [README ของ repo](../README.md) และ [คู่มือ Render](../RENDER.md); Frontend ที่ต้องแก้หลังจากนี้อยู่ใน `frontend/` ของ repo นี้ คู่มือด้านล่างเป็น workflow พัฒนาในเครื่องเดิม

# PayDay local MVP

คู่มือบัญชี/สร้าง admin คนแรก/สิทธิ์ API: [AUTH.md](AUTH.md)

Node.js + Express + PostgreSQL. ทดสอบบน Node 26 และ PostgreSQL 18 ใช้ข้อมูลเชื่อมต่อจาก `.env` เฉพาะ Backend ห้ามนำ `.env` ไปไว้ใน Frontend

## เริ่มใช้งานกับฐานเดิม

```sh
cd ~/Developer/payday-payroll/server
npm ci
# หากยังไม่มี .env ให้คัดลอก .env.example เป็น .env และใส่บัญชี PostgreSQL ของเครื่อง
npm run migrate
npm run create-admin -- --username myadmin  # ครั้งแรกเท่านั้น ถามรหัสผ่านแบบซ่อน
npm start
```

API อยู่ที่ http://127.0.0.1:3000 ตรวจ `/api/health` และ `/api/health/db`
สำหรับฐานใหม่ที่ยังไม่มีตาราง ให้สร้างฐาน `payday_db` แล้วใช้ `psql` กับฐานนั้นรัน `server/schema.sql` ก่อน migrate **ห้ามรัน schema.sql ทับฐานเดิม** ไฟล์นี้ส่งออกเฉพาะ schema ไม่มีข้อมูลบุคคล

## สูตรที่ใช้อยู่

- ใช้ `save_period_payroll.sql` และ `period_allowances.sql` เป็นแหล่งสูตร ฉบับ API อยู่ใน `server/payroll.js`
- เดือนจ่าย YYYY-MM: ค่าจ้าง/อาหาร/กะ ตั้งแต่วันที่ 17 เดือนก่อนถึง 16 เดือนจ่าย รวมทั้งสองวัน; OT วันที่ 1–วันสุดท้ายเดือนก่อน; จ่ายวันที่ 25
- รายวัน: อัตรา × จำนวนบันทึกวันเต็ม 480 นาที รายเดือน: จ่ายเต็มอัตรา ไม่หักวันขาด ตาม SQL เดิม
- อัตราต่อชั่วโมง: รายวัน ÷ 8 หรือรายเดือน ÷ 30 ÷ 8; OT 1.5 ใช้นาที OT รวมลบ OT 3; OT 3 ใช้นาที OT 3
- ปัด OT แต่ละส่วนเป็นทศนิยมสองตำแหน่งใน PostgreSQL ก่อนรวมเป็น gross_pay
- API เวลาเดิมเก็บค่าอาหาร 83 บาท หรือ 166 บาทเมื่อ OT รวม >= 60 นาที รวมส่วนเพิ่มไว้แล้ว จึง SUM meal_allowance ในรอบค่าจ้าง โดยไม่บวก 83 อีกครั้ง และไม่คำนวณค่าอาหารเก่าย้อนหลัง (เช่นรายการ 40 บาท)
- กะกลางคืน 150 บาทต่อบันทึกในรอบค่าจ้าง กลางวัน 0
- `monthly_allowances.sql` รุ่นเก่าใช้รอบเดียวสำหรับ OT; MVP ใช้ช่วง OT แยกตามไฟล์ `period_allowances.sql` / `save_period_payroll.sql` และโจทย์ปัจจุบัน
- สูตรเดิมยังไม่กำหนดรายวันไม่เต็ม 480 นาที หรือค่าเริ่มต้นกะ/OT ที่เป็น NULL: API ไม่รับวันไม่เต็มและการคำนวณจะปฏิเสธรายการเก่าที่กำกวมพร้อมระบุ ID ต้องยืนยันกติกาก่อนเพิ่มการรองรับ

## รายงานที่บันทึก

Migration เพิ่ม snapshot ชื่อ/รหัส และ saved_at ในตารางเดิม ไม่ลบ/เปลี่ยนยอดจ่าย บันทึกใหม่ผ่าน transaction พร้อมล็อกต้นทางและตรวจ preview_token หากข้อมูลเปลี่ยนหลังดูยอดจะตอบ 409 ให้คำนวณใหม่ กดบันทึกซ้ำหรือพร้อมกันคืนรายงานเดิม ไม่เขียนทับรายการที่บันทึกแล้ว รวมทั้งงวดที่นำเข้าจากข้อมูลเก่า

Migration ตรึงชื่อของรายการเก่าจากข้อมูลพนักงาน **ณ วัน migrate** ไม่สามารถกู้ชื่อก่อนหน้านั้นได้ ส่วนยอด/ประเภท/อัตราจ้างที่เคยบันทึกยังเป็นค่าเดิม

ไฟล์ SQL เก่าที่ hardcode `id = 1` เป็นตัวอย่างสูตร/งานทดลอง อย่ารัน `save_period_payroll.sql`, `add_overtime_period.sql`, `monthly_work_summaly.sql` ในงานประจำ เพราะบางไฟล์เขียนข้อมูล/แก้ช่วงงวดโดยตรง ให้คำนวณและบันทึกผ่าน API/หน้าเว็บ MVP เท่านั้น `payroll_report.sql` ปรับให้อ่าน snapshot แล้ว

## API

- GET/POST `/api/employees`; GET/PUT `/api/employees/:id` (API เดิม)
- GET/POST `/api/work-logs` (API เดิม; รายการล่าสุด 100 แถว)
- GET `/api/payroll/preview?month=2026-11` → period, rows, preview_token หรือ saved report
- POST `/api/payroll/save` body `{ "month": "2026-11", "preview_token": "ค่าจาก preview" }`
- GET `/api/payroll/periods`; GET `/api/payroll/periods/:id`

## ทดสอบแยกฐานจริง

กำหนด `TEST_DATABASE_URL` ด้วยบัญชี PostgreSQL ของเครื่อง ชื่อฐานต้องตรง `payday*_test*` เช่น `payday_mvp_test` ตัวตั้งฐานจะสร้างฐานใหม่เท่านั้นและไม่เขียนทับฐานที่มีอยู่ ชุดทดสอบจะล้างเฉพาะตารางในฐานทดสอบนี้

```sh
cd ~/Developer/payday-payroll/server
export TEST_DATABASE_URL='postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/payday_mvp_test'
node tests/setup-test-db.js  # ครั้งแรกเท่านั้น ต้องมีสิทธิ์ CREATE DATABASE
npm test
```

สำหรับ Chrome end-to-end ให้รัน `npm test` ก่อนเพื่อเริ่มข้อมูลทดสอบใหม่ แล้วเปิดสอง terminal:

```sh
# Backend ทดสอบ
DATABASE_URL="$TEST_DATABASE_URL" PORT=3001 npm start
# Frontend ทดสอบ
cd ~/Developer/payday-payroll-frontend
PAYDAY_API_TARGET=http://127.0.0.1:3001 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

ใช้ Google Chrome ที่ติดตั้งแล้ว และติดตั้ง Playwright แยกชั่วคราว ไม่เพิ่ม dependencies แอป:

```sh
npm install --prefix /tmp/payday-browser --no-package-lock playwright-core
cd ~/Developer/payday-payroll/server
PLAYWRIGHT_MODULE=/tmp/payday-browser/node_modules/playwright-core/index.mjs node tests/run-browser-tests.js
```

run-browser-tests.js ตรวจฐานทดสอบ สร้าง admin ทดสอบผ่าน CLI และรัน browser.mjs กับ auth-browser.mjs ซึ่งตรวจ `/api/health/db` ว่าเป็นฐานทดสอบก่อนเริ่ม ใช้ URL เริ่มต้น http://127.0.0.1:5174 เปลี่ยนได้ด้วย `PAYDAY_TEST_BASE_URL` และ `CHROME_PATH` เก็บ screenshots ที่ `/tmp/payday-browser/` runner ล้างข้อมูลเฉพาะฐานทดสอบและสร้าง fixture ใหม่ทุกรอบ
