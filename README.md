# PayDay — React + Express ใน Web Service เดียว

โค้ดสำหรับ deploy อยู่ใน repo นี้ทั้งชุด Express เสิร์ฟ React ที่ build แล้วและ `/api` ภายใต้ origin เดียว ใช้ session cookie / CSRF / สิทธิ์ admin และ employee เดิม ดูขั้นตอนตั้ง Render ใน [RENDER.md](RENDER.md) และผลตรวจจริงใน [DEPLOY_TESTING.md](DEPLOY_TESTING.md)

## โครงสร้างและโฟลเดอร์ที่ต้องแก้หลังจากนี้

```text
payday-payroll/
  package.json / package-lock.json   # คำสั่ง build/start จาก root
  .node-version                     # Node 26.7.0 ที่ใช้ทดสอบ
  frontend/                         # React/Vite ต้นทางสำหรับ deploy
    src/ public/ package*.json
    dist/                           # build สร้างให้ ไม่ commit
  server/                           # Express/API, auth, SQL และ migrations
    index.js frontend.js db.js
    init-db.js migrate.js create-admin.js
    schema.sql migrations/ tests/
  scripts/                          # ตรวจ Git และ HTTPS proxy เฉพาะ QA ในเครื่อง
```

**แก้ Frontend ที่ `payday-payroll/frontend/` หลังจากนี้** เพื่อให้การแก้ไปกับ commit/deploy เช่นเปิด `~/Developer/payday-payroll/frontend/src/App.jsx` ใน IDE ส่วน `~/Developer/payday-payroll-frontend` ยังอยู่ครบพร้อม Git และงานเดิม เป็นสำเนาเก่าบน Mac **การแก้ในโฟลเดอร์เก่าจะไม่ขึ้น deploy อัตโนมัติ** ไม่มี symlink หรือ path ไปโฟลเดอร์เก่าใน build อย่าแก้สองชุดพร้อมกัน หากมีงานใหม่ในชุดเก่าให้ review/copy เฉพาะ source/config/lockfile ที่ต้องการเข้ามาใน `frontend/` ก่อน commit ห้ามคัดลอก `.env`, `.git`, `node_modules` หรือ `dist`

ก่อนงานนี้ Git ทั้งสองชุดยังไม่มี commit; ไม่ได้ reset, ลบงาน, สร้าง commit หรือ push ในงานเตรียมนี้

## พัฒนาในเครื่อง (สองพอร์ตเหมือนเดิม)

```sh
cd ~/Developer/payday-payroll
npm ci --prefix server
npm ci --prefix frontend --include=dev
# ตั้ง DATABASE_URL ใน server/.env ของเครื่อง (ไฟล์นี้ถูก ignore)
npm run dev:server
# อีก terminal จาก repo root
npm run dev:frontend
```

Vite proxy `/api` ไป `http://127.0.0.1:3000` ตามเดิม `PAYDAY_API_TARGET` ใช้เปลี่ยนปลายทางเฉพาะ dev/test ได้ Frontend ใช้ relative `/api` เสมอ ไม่เก็บ DATABASE_URL หรือ session secrets ใน Frontend

## Production build ในเครื่อง (Express origin เดียว)

```sh
npm run build
# ใช้ฐานทดสอบแยก ตั้ง DATABASE_URL ใน environment ก่อนรัน
NODE_ENV=production PORT=3100 TRUST_PROXY=0 COOKIE_SECURE=false npm start
```

เปิด `http://127.0.0.1:3100` Express ฟัง `0.0.0.0` ใน production และใช้ PORT ที่ส่งมา เสิร์ฟ `frontend/dist` โดยอิงตำแหน่งไฟล์ ไม่อิง current working directory รีเฟรช URL ย่อย เช่น `/employee/history` ได้ API ที่ไม่พบตอบ JSON 404 ไม่ส่ง HTML หน้า React ไฟล์ assets ที่ไม่พบตอบ 404

สำหรับ HTTP ในเครื่องตั้ง COOKIE_SECURE=false; Render HTTPS ตั้ง true และ TRUST_PROXY=1 ตาม [คู่มือ](RENDER.md) การ start ไม่ติดตั้ง dependencies ไม่ build ไม่สร้างตาราง ไม่ migrate และไม่สร้าง admin ให้เอง

## ฐานใหม่และผู้ดูแลคนแรก (คำสั่งแยก)

ตั้ง DATABASE_URL ให้ชี้ **ฐานใหม่ที่ว่าง** แล้วรันจาก root:

```sh
npm run db:init
npm run migrate
npm run create-admin -- --username myadmin
```

`db:init` ใช้ schema เดิมและปฏิเสธฐานที่มีตารางแล้ว; ฐานที่มี schema อยู่ใช้เพียง migrate ซึ่งรักษาข้อมูลเดิม สร้าง admin โดยถามรหัสผ่านแบบซ่อน ไม่มีรหัสเริ่มต้น ไม่ต้องใส่รหัสผ่านใน command line ใช้ PostgreSQL 18 ตาม schema ที่ตรวจและทดสอบแล้ว

## ตรวจและทดสอบ

```sh
npm run lint
npm run build
npm run check:git
# TEST_DATABASE_URL ต้องชี้ payday*_test* แยกจากฐานจริง
npm test
```

`npm run test:browser` เรียก Chrome tests เดิม ใช้ TEST_DATABASE_URL และ PLAYWRIGHT_MODULE ตาม [server/AUTH.md](server/AUTH.md) เปลี่ยน PAYDAY_TEST_BASE_URL เป็น Express production URL ได้ และเพิ่ม PAYDAY_HTTPS_TEST_BASE_URL เพื่อทดสอบ HTTPS ด้วย [ขั้นตอนทดสอบ](DEPLOY_TESTING.md) runner ล้างข้อมูลเฉพาะฐานทดสอบ ห้ามใช้ฐานจริง

คู่มือฟีเจอร์: [บัญชี/สิทธิ์](server/AUTH.md), [ลงเวลาตนเอง/ยอดสะสม](server/SELF_SERVICE.md), [MVP/สูตร](server/README.md)

ฟีเจอร์แก้ OT, ลาป่วย/ลากิจได้เงินหรือไม่ได้เงิน และงานวันธรรมดาอัตโนมัติ (ปิดเริ่มต้น): [คู่มือและขั้นตอนเปิดใช้](server/ATTENDANCE.md)
