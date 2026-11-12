# ผลทดสอบการเตรียม Render — 12 พฤศจิกายน 2569

## สภาพก่อนแก้และขอบเขต

- อ่าน git status/package.json/lockfile/README ของทั้งสองโฟลเดอร์ และ server/index.js / vite.config.js ก่อนแก้
- Frontend เดิมมี Git branch main ที่ยังไม่มี commit ไฟล์โปรเจกต์เป็น untracked; ตอนตรวจครั้งแรก Backend ยังไม่มี repository หลังเตรียม Git ที่ backend อยู่บน main และยังไม่มี commit ไม่ reset/ลบงานหรือ push
- คัดลอก source/config/public/lockfile ของ Frontend ไป frontend/ ใน repo backend ไม่ copy .env, .git, node_modules, dist รักษา src/config/lockfile ต้นฉบับไว้ครบ
- Node ที่ใช้จริง v26.7.0, npm 11.19.0, PostgreSQL 18; .node-version ตั้งตามเวอร์ชันที่ทดสอบ
- ใช้ฐานใหม่ payday_render_test_20261112 ทุกการทดสอบ ไม่เขียนข้อมูลทดสอบหรือ migrate payday_db จริงในงานนี้

## คำสั่งที่รันจริงจาก root

```sh
NODE_ENV=production npm run build
npm run lint
npm run db:init
npm run db:init  # รอบสองต้องปฏิเสธฐานไม่ว่าง
npm run migrate
npm run migrate # ซ้ำได้
npm test
npm run check:git
```

คำสั่งเกี่ยวกับฐานใช้ DATABASE_URL / TEST_DATABASE_URL ของ payday_render_test_20261112 ส่งผ่าน environment ไม่ใส่ URL/รหัสจริงในคำสั่งหรือเอกสาร Build แยกติดตั้งจาก server/package-lock.json และ frontend/package-lock.json แล้ว Vite build สำเร็จโดยไม่ใช้ dependency/path ของโฟลเดอร์ Mac ต้นฉบับ ยังไม่รัน build บน Linux/Render จริง แต่ lockfile มี optional native packages ของ Linux อยู่ด้วย

- lint ผ่าน
- build ผ่าน
- Backend tests ผ่าน 31/31 (เดิม 28 + API404/static SPA/missing build 3)
- db:init ฐานว่างสำเร็จ รอบสอง exit 1 พร้อมปฏิเสธฐานไม่ว่าง; migration สองรอบสำเร็จ
- API ที่ไม่พบเป็น JSON 404 ทั้ง anonymous/admin/employee รวม POST; API ที่มีจริงยัง 401/403 ตามสิทธิ์
- Static test ตรวจ /, nested routes, JS assets, no-store HTML, missing assets/API/.env เป็น 404 และ production ที่ไม่มี build ปฏิเสธ startup อย่างชัดเจน

npm ci แสดงคำเตือน 4 moderate vulnerabilities จาก dependency tree Frontend เดิม เวอร์ชัน/lockfile เดิมคงไว้ ไม่ใช้ audit fix --force; การขอดูรายละเอียด npm audit เพิ่มเติมติด DNS ของ registry ใน environment นี้ จึงไม่สรุปว่า audit ผ่าน Runtime server npm ci รายงาน 0 vulnerabilities ในรอบ build

## Express production origin เดียว

รันจาก root ด้วย env ของฐานทดสอบ:

```sh
NODE_ENV=production PORT=3100 TRUST_PROXY=1 COOKIE_SECURE=false npm start
```

ได้ listener http://0.0.0.0:3100 จริง ไม่ใช้ Vite ในการเสิร์ฟหน้าเว็บ HTTP dev/QA ใช้ COOKIE_SECURE=false เท่านั้น HTTPS ได้ Secure จาก req.secure ของ trusted proxy และ Render ให้ตั้ง true ตาม RENDER.md

Smoke HTTP: /api/health 200, /reports/period/42 200 (React shell), /api/missing 404

## HTTPS ในเครื่องและ Chrome

สร้าง certificate/key เฉพาะทดสอบใน /tmp/payday-render-tls/ ไม่อยู่ใน repo:

```sh
mkdir -p /tmp/payday-render-tls
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/payday-render-tls/key.pem -out /tmp/payday-render-tls/cert.pem \
  -days 2 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
TLS_CERT_FILE=/tmp/payday-render-tls/cert.pem TLS_KEY_FILE=/tmp/payday-render-tls/key.pem \
  HTTPS_PORT=3443 UPSTREAM_PORT=3100 node scripts/local-https-proxy.mjs
```

อีก terminal กำหนด TEST_DATABASE_URL ของฐานแยกและรัน:

```sh
PAYDAY_TEST_BASE_URL=http://127.0.0.1:3100 \
PAYDAY_HTTPS_TEST_BASE_URL=https://127.0.0.1:3443 \
PLAYWRIGHT_MODULE=/tmp/payday-browser/node_modules/playwright-core/index.mjs \
npm run test:browser
```

runner ล้างเฉพาะฐานทดสอบ สร้าง admin ด้วยรหัสสุ่มผ่าน stdin และรัน tests ที่มีอยู่บน production assets; Chrome HTTPS QA ยอมรับ self-signed certificate เฉพาะ test context ไม่ปิด TLS verification ทั้ง Node หรือระบบ ไม่ต้องนำ key/cert นี้ไป Render

ผล Chrome ฉบับสุดท้ายและ audit ของไฟล์ Git บันทึกเพิ่มเติมหลังรันครบด้านล่าง

## ผลตรวจสุดท้าย

- Chrome ทั้งห้าชุดผ่าน: MVP, auth, lifecycle, self-service (รันบน Express production assets ทุกชุด) และ production HTTPS เพิ่มเติม
- HTTPS จริงในเครื่องผ่าน self-signed test proxy: React assets ไม่มี @vite/client, deep link /reports/period/123 เปิดและล็อกอินได้, unknown API/missing assets/.env เป็น 404, login admin/employee และบันทึกผ่าน origin เดียวกันสำเร็จ
- Cookie ผ่าน HTTPS มี Secure + HttpOnly + SameSite=Lax, ฟอร์มที่มี CSRF เขียนได้ คำขอไม่มี token ถูกปฏิเสธ 403, employee เรียก admin API ได้ 403 และ cookie ก่อน logout ใช้ต่อได้เพียง 401
- ทดสอบ root command `npm run create-admin -- --username bootstrap-admin` โดยส่งรหัสสุ่มผ่าน stdin บนฐานทดสอบ: ครั้งแรกสำเร็จ รอบสองปฏิเสธ ไม่มีรหัสเริ่มต้นหรือรหัสทดสอบใน Git
- `npm run check:git` ผ่าน ตรวจทั้ง index และ untracked candidates พร้อม git check-ignore ยืนยัน server/.env, frontend/.env, .env และตัวอย่าง backup ถูก ignore; git ls-files ไม่มีไฟล์ติดตามและยังไม่มี commit ใน repo ใหม่
- เปรียบเทียบไฟล์ src/public/package.json/package-lock.json/vite.config.js/eslint.config.js/index.html ของ Frontend ต้นฉบับกับ frontend/ แบบ byte-for-byte ผ่าน ต้นฉบับไม่ได้ถูกย้ายหรือลบ
- ยังไม่มีการ commit/push GitHub, สร้าง Render service, deploy หรือย้ายฐานจริง และไม่ได้หยุด/รีสตาร์ต Backend เดิมพอร์ต 3000 ของผู้ใช้
