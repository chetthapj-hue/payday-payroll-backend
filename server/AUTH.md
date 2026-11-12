# บัญชีและสิทธิ์ PayDay

## ตั้งค่า admin คนแรก

ข้อมูลเชื่อมต่อฐานข้อมูลยังอยู่ใน `server/.env` เท่านั้น ไม่มีบัญชีหรือรหัสผ่านเริ่มต้นในแอป Migration ไม่เผยแพร่งวดเก่าและไม่สร้างบัญชีให้เอง

```sh
cd ~/Developer/payday-payroll/server
npm ci
npm run migrate
npm run create-admin -- --username myadmin
npm start
```

คำสั่ง create-admin ถามรหัสผ่านและยืนยันโดยไม่แสดงตัวอักษร ใช้ 4–128 ตัวอักษร ชื่อ admin ใช้อักษรอังกฤษ ตัวเลข `.` `_` `-` จำนวน 3–80 ตัว หากมี admin แล้วคำสั่งนี้ปฏิเสธการสร้างซ้ำ ไม่เขียนทับรหัสเดิม สำหรับ automation รับ JSON `{ "username": "...", "password": "..." }` ผ่าน stdin เท่านั้น ไม่ส่งรหัสผ่านเป็น argument

เปิด Frontend อีก terminal:

```sh
cd ~/Developer/payday-payroll-frontend
npm run dev -- --host 127.0.0.1
```

เปิด URL Local ของ Vite เลือก **ผู้ดูแลระบบ** แล้วเข้าสู่ระบบด้วยบัญชีที่ตั้งเอง

## เปิดบัญชีให้พนักงาน

1. เข้าเมนู **พนักงาน** เพิ่มพนักงานตามปกติ หรือใช้พนักงานเดิม
2. ส่วน **บัญชีเข้าสู่ระบบพนักงาน** เลือกพนักงาน ตั้งรหัสผ่านชั่วคราว 4–128 ตัวอักษร แล้วกด **สร้างบัญชีพนักงาน**
3. แจ้งรหัสผ่านชั่วคราวให้เจ้าของบัญชีโดยตรง พนักงานเลือกประเภทบัญชี **พนักงาน** ใช้รหัสพนักงานปัจจุบันและรหัสผ่านชั่วคราว
4. พนักงานต้องตั้งรหัสผ่านใหม่ที่ต่างจากเดิมก่อนเปิดข้อมูล แม้เรียก API ตรงก็ถูกปฏิเสธจนเปลี่ยนรหัส
5. ลืมรหัส: เลือกพนักงาน ตั้งรหัสผ่านชั่วคราวใหม่ กด **รีเซ็ตรหัสผ่าน / เปิดบัญชีอีกครั้ง** ปุ่มนี้เปิดบัญชีที่เคยปิดกลับด้วย บังคับเปลี่ยนรหัสและยกเลิก session เดิมทุกอุปกรณ์
6. กด **ปิดบัญชีพนักงาน** เพื่อปฏิเสธการเข้าสู่ระบบและยกเลิก session เดิมทั้งหมด

บัญชีผูกด้วย employee_id ซึ่ง unique ไม่ผูกด้วยข้อความรหัสพนักงาน เมื่อ admin แก้รหัสพนักงานให้ใช้รหัสใหม่เข้าสู่ระบบ รายงานเก่ายังแสดง snapshot รหัส/ชื่อเดิมตามงวด

## พนักงานใช้งาน

- **ประวัติการทำงาน** เลือกเดือนเพื่อดูเฉพาะวันที่ กะ ชั่วโมงปกติ ชั่วโมง OT รวม/OT 3 และค่าอาหารของตัวเอง
- **เงินเดือนของฉัน** เลือกงวดที่เผยแพร่แล้ว ดูวันจ่าย ค่าจ้าง OT 1.5/3 ค่าอาหาร ค่ากะ และรายได้รวม
- ปุ่ม **เปลี่ยนรหัสผ่าน** เปลี่ยนรหัสของตัวเองและหมุน session ใหม่ โดยยกเลิก session เดิมทุกอุปกรณ์
- **ออกจากระบบ** ลบ session ที่ใช้อยู่ฝั่งฐานข้อมูลและล้าง cookie

## เผยแพร่เงินเดือน

admin คำนวณ → ตรวจยอด → บันทึกงวด → กด **เผยแพร่งวด** งวดที่เพียงบันทึกยังไม่แสดงแก่พนักงาน งวดเก่าทั้งหมดเริ่มต้นเป็นยังไม่เผยแพร่ ปุ่มเผยแพร่ทำซ้ำได้โดยไม่เปลี่ยนเวลาที่เผยแพร่ครั้งแรก

ยอดของพนักงานอ่านจาก payroll_items ที่บันทึกแล้ว ไม่คำนวณใหม่จาก employees/work_logs ส่วนรายงาน admin ยังคงเปิดงวดที่ยังไม่เผยแพร่ได้

## การบังคับสิทธิ์

| API | สิทธิ์ |
|---|---|
| GET /api/health | สาธารณะ: สถานะบริการเท่านั้น |
| POST /api/auth/login | สาธารณะ, จำกัดการลองรหัสผิด |
| GET /api/auth/session | session ที่ยังใช้งานได้ |
| POST /api/auth/password, /api/auth/logout | เจ้าของ session รวมช่วงรอเปลี่ยนรหัสชั่วคราว |
| GET /api/me/work-logs?month=YYYY-MM | employee ที่เปลี่ยนรหัสแล้ว, เจ้าของจาก session เท่านั้น |
| GET /api/me/payroll, /api/me/payroll/:periodId | employee ที่เปลี่ยนรหัสแล้ว, เฉพาะรายการตนเองในงวดที่เผยแพร่ |
| /api/employees, /api/employees/:id, /api/work-logs, /api/payroll/* | admin เท่านั้นทุก method |
| GET /api/accounts, GET /api/health/db | admin เท่านั้น |
| POST /api/employees/:id/account | admin สร้างบัญชีพนักงาน |
| POST /api/employees/:id/reset-password, /api/employees/:id/disable-account | admin เท่านั้น |
| POST /api/payroll/periods/:id/publish | admin, งวดต้องบันทึกแล้ว |

การส่ง employee_id/account_id มาในคำขอของพนักงานไม่สามารถเปลี่ยนเจ้าของข้อมูลหรือรหัสผ่านของคนอื่นได้ API me/payroll/:id ใช้ id ของ **งวด** และยังกรอง employee_id จาก session เสมอ ถ้าไม่มีรายการของตนเองตอบ 404 API admin ตอบ 401 หากไม่ล็อกอิน และ 403 หากเป็น employee (ตรวจที่ Backend)

## Session และรหัสผ่าน

- รหัสผ่าน hash ด้วย async scrypt (N=32768, r=8, p=1, derived key 64 bytes) และ salt สุ่มรายรหัส ใช้ timingSafeEqual ตรวจ hash
- Cookie payday_sid เป็น opaque token สุ่ม 256 บิต ฐานข้อมูลเก็บเฉพาะ SHA-256 ของ token ไม่เก็บ cookie token ต้นฉบับ
- Cookie HttpOnly, SameSite=Lax, Path=/, อายุ 8 ชั่วโมง ตรวจ is_active และวันหมดอายุทุกคำขอ
- ตั้ง Secure อัตโนมัติเมื่อ req.secure เป็นจริง สำหรับ HTTPS หลัง reverse proxy ให้ตั้ง TRUST_PROXY=1 เฉพาะกรณีมี trusted proxy หนึ่งชั้น หรือ COOKIE_SECURE=true เพื่อบังคับ Secure ห้ามตั้ง COOKIE_SECURE=true ใน dev HTTP เพราะเบราว์เซอร์อาจไม่ส่ง cookie
- คำขอเขียนต้องมี X-PayDay-Request: 1 และ session ที่ล็อกอินแล้วต้องมี X-CSRF-Token ที่ได้จาก login/session ไม่เปิด CORS ข้าม origin ให้ Frontend ใช้ /api ผ่าน proxy ที่ origin เดียวกัน
- ทุกคำตอบ /api ตั้ง Cache-Control: no-store ไม่เก็บ session หรือรหัสผ่านใน localStorage
- Login ผิดครบ 10 ครั้งต่อชื่อผู้ใช้/ประเภทบัญชี/IP ภายใน 15 นาที จะปฏิเสธครั้งถัดไปเป็น 429 จนหมดช่วง
- Migration 002 เพิ่ม auth_accounts, auth_sessions, auth_login_attempts และ payroll_periods.published_at โดยไม่แก้ยอดหรือข้อมูลเดิม

## รันทดสอบ

ฐานทดสอบต้องชื่อ payday*_test* ตั้ง TEST_DATABASE_URL ของเครื่อง ไม่ใช้ payday_db

```sh
cd ~/Developer/payday-payroll/server
export TEST_DATABASE_URL='postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/payday_auth_test'
node tests/setup-test-db.js  # ฐานใหม่ครั้งแรกเท่านั้น, ต้องมี CREATE DATABASE
npm test
```

Chrome end-to-end ใช้ backend/frontend ฐานทดสอบตาม README แล้วรัน **runner** นี้ (runner ล้างข้อมูลในฐานทดสอบที่ระบุ สุ่มรหัส admin ผ่าน stdin และตรวจ bootstrap ซ้ำถูกปฏิเสธ):

```sh
npm install --prefix /tmp/payday-browser --no-package-lock playwright-core
cd ~/Developer/payday-payroll/server
PLAYWRIGHT_MODULE=/tmp/payday-browser/node_modules/playwright-core/index.mjs node tests/run-browser-tests.js
```

ต้องเปิด Backend ด้วย DATABASE_URL=$TEST_DATABASE_URL PORT=3001 และ Frontend ด้วย PAYDAY_API_TARGET=http://127.0.0.1:3001 ที่พอร์ต 5174 ตาม README; เปลี่ยน URL ได้ด้วย PAYDAY_TEST_BASE_URL และ Chrome binary ด้วย CHROME_PATH รหัสทดสอบสุ่มไม่ถูกพิมพ์ออกมาและไม่ใช้กับฐานจริง

## ลบ/ปิดสถานะพนักงาน

Migration 003 เพิ่ม employees.is_active ค่าเริ่มต้น true โดยรักษาข้อมูลเดิม API เหล่านี้อยู่หลัง admin guard:

- GET /api/employees/:id/deletion-check ตรวจบัญชี/ประวัติ/รายการเงินเดือน
- DELETE /api/employees/:id ลบเฉพาะผู้ไม่มีข้อมูลเกี่ยวข้อง ตรวจซ้ำและล็อก parent row ภายใน transaction; ถ้ามีข้อมูลตอบ 409 EMPLOYEE_HAS_HISTORY
- POST /api/employees/:id/deactivate ปิดสถานะและบัญชี พร้อมลบ session ใน transaction เดียว โดยไม่แก้ประวัติหรือ snapshot เงินเดือน
- GET /api/work-logs?employee_id=...&month=YYYY-MM ค้นประวัติได้รวมผู้ที่ปิดสถานะ

ผู้ที่ปิดสถานะจะล็อกอิน ใช้ session เดิม สร้างบัญชีหรือรีเซ็ตเพื่อเปิดบัญชี และลงเวลางานใหม่ไม่ได้ ทั้งตรวจที่ Backend และกรองตัวเลือกลงเวลาหน้าเว็บ ส่วนรายการพนักงาน admin ยังคงแสดงผู้ปิดสถานะเพื่อค้นประวัติได้ รายงานงวดเดิมและสูตรเงินเดือนคงเดิม

## พนักงานลงเวลาและยอดสะสม

รุ่นปัจจุบัน employee ที่เปลี่ยนรหัสแล้วลงเวลาตนเองได้ผ่าน POST `/api/me/work-logs` (owner จาก session, วันนี้/ย้อนหลังตามวันไทยเท่านั้น) และดู GET `/api/me/accrued-income?month=YYYY-MM` ซึ่งใช้ calculate ตัวเดียวกับ Admin และคืนเฉพาะข้อมูลตนเอง รายละเอียดสูตร วิธีลอง และการทดสอบอยู่ใน [SELF_SERVICE.md](SELF_SERVICE.md) หน้าเงินเดือนที่เผยแพร่แล้วยังคงอ่าน snapshot เดิม ไม่ใช่ยอดสด
