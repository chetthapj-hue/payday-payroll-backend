# Deploy PayDay บน Render — Web Service เดียว

คู่มือนี้เป็นขั้นตอนที่เจ้าของโปรเจกต์ทำภายหลัง งานเตรียมนี้ไม่ได้ push, สร้างบริการ, deploy หรือย้ายข้อมูลจริง

## 1. เลือกโค้ดและ GitHub private repo

ใช้ repo `~/Developer/payday-payroll` ซึ่งมีทั้ง `server/` และ `frontend/` แก้ React ที่ **frontend/** ของ repo นี้ โฟลเดอร์ `~/Developer/payday-payroll-frontend` ยังอยู่ครบเป็นต้นฉบับเก่า และไม่ sync เข้ามาอัตโนมัติ

ตรวจ source ก่อน commit:

```sh
cd ~/Developer/payday-payroll
npm run check:git
git status --short
git ls-files
```

`.gitignore` ครอบคลุม .env ทุก package (ยกเว้น .env.example), node_modules, dist, private keys และชื่อไฟล์/โฟลเดอร์สำรองฐานข้อมูลที่ใช้ทั่วไป `check:git` ตรวจทั้ง tracked และ candidate files; ยังควร review diff ของคุณก่อน commit ไม่ใช้ `git add -f` กับไฟล์เหล่านี้ `server/schema.sql` และ `server/migrations/*.sql` เป็นโครงสร้างที่ต้อง commit ไม่ใช่ backup ข้อมูลจริง

หลัง review แล้ว จึงสร้าง commit ของคุณและสร้าง GitHub repository โดยเลือก **Private** (ไม่สร้าง README เริ่มต้นบน GitHub เพื่อหลีกเลี่ยงประวัติแยก) จากนั้นตั้ง remote และ push ด้วยตัวเอง ตัวอย่างสำหรับ repo ใหม่:

```sh
git add .
git diff --cached --stat
git diff --cached --name-only
git commit -m "Prepare PayDay single-service deployment"
# ถ้ายังไม่มี origin เท่านั้น ใช้ SSH URL ของ PRIVATE repo ที่คุณสร้าง
git remote add origin git@github.com:YOUR_ACCOUNT/payday-payroll.git
git push -u origin main
```

ถ้ามี branch/history/remote อยู่แล้วให้ใช้ของเดิม ไม่ต้อง reset, force push หรือสร้างประวัติทับ งานเตรียมนี้ไม่มี commit/push ให้และไม่มีการเปลี่ยน Git ของโฟลเดอร์ Frontend เดิม

## 2. สร้างฐานใหม่สำหรับทดลอง deploy

เมื่อพร้อมทำขั้นตอนบน Render จริง ให้สร้าง Render Postgres **ฐานใหม่** PostgreSQL **18** (schema เดิมทดสอบกับ 18) เลือก Region เดียวกับ Web Service แล้วใช้ **Internal Database URL** เป็น DATABASE_URL ของ Web Service เก็บ URL ไว้ใน Environment เท่านั้น ไม่ใส่ใน Git หรือ frontend

Render แยก internal URL สำหรับ service ใน region/account เดียวกัน กับ external URL สำหรับเครื่อง Mac รายละเอียดจาก [Render Postgres](https://render.com/docs/postgresql-creating-connecting) ขั้นตอนนี้ยังไม่เกี่ยวกับการย้าย payday_db จริงบน Mac

## 3. สร้าง Node Web Service จาก private repo

Render Dashboard → New → Web Service → เชื่อม GitHub และให้สิทธิ์เฉพาะ private repo ที่ต้องใช้ เลือก repo/branch ของคุณ กรอก:

| ช่อง | ค่า |
|---|---|
| Runtime / Language | Node |
| Root Directory | **เว้นว่าง** (repo root; ห้ามตั้ง server หรือ frontend) |
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Node version | `.node-version` ใน repo = `26.7.0` |
| Region | ตรงกับ Render Postgres ใหม่ |

Root ต้องรวมทั้งสองโฟลเดอร์ เพราะ [ไฟล์นอก Root Directory ไม่อยู่ใน build/runtime](https://render.com/docs/monorepo-support) Build script ติดตั้ง server ตาม lockfile ติดตั้ง frontend พร้อม devDependencies แล้วรัน Vite ไม่อ่านโฟลเดอร์ Mac หรือเรียก Vite dev server ใน production

[Render Web Services](https://render.com/docs/web-services) ต้องฟัง `0.0.0.0` และ PORT ที่ Render ส่งให้ โค้ดทำเช่นนั้นเมื่อ NODE_ENV=production; ไม่ต้องเปิดพอร์ต 5173 หรือแยก Static Site

## 4. Environment Variables ของ Web Service

| Key | Value |
|---|---|
| NODE_ENV | `production` |
| DATABASE_URL | Internal Database URL ของ **ฐานใหม่** ที่เลือก |
| TRUST_PROXY | `1` |
| COOKIE_SECURE | `true` |

ไม่ต้องกำหนด PORT เอง Render ใส่ให้ runtime; `.node-version` ระบุ Node แล้ว หากเคยตั้ง NODE_VERSION ไว้ใน Dashboard ให้ตรง `26.7.0` หรือเอาค่าที่ override ออก ดู [ลำดับการเลือก Node](https://render.com/docs/node-version)

`.env.example` ที่ root เป็นตัวอย่างสำหรับ Render ส่วน `server/.env.example` เป็นค่า local HTTP ไม่ใช่ secrets จริง อย่า copy server/.env ของ Mac ขึ้น Git หรือ Render

ระบบ session เดิมใช้ token สุ่มและเก็บ hash ใน PostgreSQL ไม่มี SESSION_SECRET แบบค่าคงที่ที่ต้องเพิ่ม Frontend ไม่ต้องมี VITE_API_URL, DATABASE_URL หรือรหัสผ่านใด ๆ ให้ fetch relative `/api` ต่อไป

Render จัดการ certificate และ [redirect HTTP → HTTPS](https://render.com/docs/tls) อยู่แล้ว Express รับ HTTP ภายในหลัง proxy; TRUST_PROXY=1 ทำให้รับรู้ HTTPS และ COOKIE_SECURE=true บังคับ Secure เพิ่มด้วย Cookie ยังคง HttpOnly / SameSite=Lax ใช้ origin เดียวกับ React และ CSRF token/header เดิม ไม่เปิด CORS ข้าม origin

## 5. สร้างตาราง migrate และสร้าง admin — แยกจาก start

หลัง build/start ครั้งแรก `/api/health` ตรวจเพียง process Express ไม่ต้องล็อกอินและไม่ตรวจ schema ทำให้เปิด Shell เพื่อตั้งฐานใหม่ได้ การ start **ไม่** สร้างตาราง/migrate/admin

บน Web Service ที่มี Shell ให้เปิด Render Dashboard → Shell จาก repo root แล้วรันตามลำดับด้วยตัวเอง:

```sh
npm run db:init
npm run migrate
npm run create-admin -- --username myadmin
```

- `db:init`: เฉพาะฐานใหม่ว่าง สร้าง baseline schema เดิม ถ้ามีตาราง public อยู่แล้วจะปฏิเสธโดยไม่เขียนทับข้อมูล
- `migrate`: เพิ่ม snapshot/auth/สถานะตาม migration เดิม รันซ้ำได้ รักษาข้อมูล
- `create-admin`: ใช้สร้าง admin คนแรกเท่านั้น ถ้ามีแล้วปฏิเสธ ถามรหัสผ่านแบบซ่อน 4–128 ตัวอักษร ไม่มีรหัสเริ่มต้นฝังในโค้ด

ไม่ใส่สามคำสั่งนี้ใน Build Command หรือ Start Command ฐานที่ตั้ง schema แล้วใน deploy ครั้งถัดไปใช้แค่ `npm run migrate` เมื่อมี migration ใหม่ ไม่รัน db:init หรือ create-admin ซ้ำ

**หากใช้ Free Web Service:** [Free ไม่มี Dashboard Shell/SSH](https://render.com/docs/ssh) ให้รันคำสั่งตั้งฐานใหม่จาก Mac โดยชี้ External Database URL ของฐาน Render ใหม่แทน (ไม่ใช่ Internal URL และไม่ใช่ payday_db ของ Mac) External connection ต้องใช้ TLS ตาม Render เช่น URL ที่มี sslmode=require:

```zsh
cd ~/Developer/payday-payroll
# zsh: วาง URL ของฐานใหม่แบบไม่แสดงตัวอักษร และไม่เก็บใน history
read -rs 'DATABASE_URL?External Database URL ของฐาน Render ใหม่: '
echo
export DATABASE_URL
npm run db:init
npm run migrate
npm run create-admin -- --username myadmin
unset DATABASE_URL
```

Environment จะ override ค่า DATABASE_URL ใน server/.env ของ Mac ไม่มีการเปลี่ยนไฟล์ .env นั้น `db:init` จะปฏิเสธฐานที่ไม่ว่างช่วยกันการเลือกฐานผิด ถ้าไม่แน่ใจชื่อฐานให้ตรวจใน Render ก่อนเริ่ม ขั้นตอนทั้งหมดข้างต้นเป็นคำสั่งแยกและต้องรันกับฐานใหม่เท่านั้นในรอบทดลอง

## 6. ตรวจหลังตั้งฐาน

เปิด HTTPS URL ที่ Render แสดงให้บริการ เช่น `https://YOUR-SERVICE.onrender.com`:

1. หน้าเข้าสู่ระบบต้องโหลด เลือกผู้ดูแลและใช้บัญชีที่ตั้งเอง
2. เพิ่มพนักงาน/สร้างบัญชีทดสอบ และลอง employee ตามคู่มือเดิม
3. รีเฟรช URL ย่อย เช่น `/employee/history` ต้องยังเปิด React ได้ (แอปยังใช้เมนูภายในเหมือนเดิม ไม่มีการเพิ่ม router ใหม่ในงานนี้)
4. `/api/health` ตอบ 200; `/api/does-not-exist` ตอบ JSON 404 ไม่ใช่ HTML ของ React
5. เมื่อล็อกอิน admin `/api/health/db` ตรวจฐานได้ ส่วน API ข้อมูลที่ไม่ล็อกอินต้อง 401 และ employee เรียก admin API ต้อง 403
6. DevTools → Cookies ต้องมี payday_sid แบบ Secure, HttpOnly, SameSite=Lax; การบันทึกผ่านฟอร์มส่ง CSRF เดิมได้ ออกจากระบบแล้ว cookie เดิมใช้เรียกข้อมูลไม่ได้

## 7. ผลทดสอบและขอบเขต

ดู [DEPLOY_TESTING.md](DEPLOY_TESTING.md) มีคำสั่งที่รันจริงทั้ง build จาก root, ฐานใหม่, HTTP origin เดียว และ HTTPS proxy ในเครื่อง ยังไม่ได้ทดสอบ Render จริงหรือ Linux container และยังไม่ย้ายข้อมูลจริง ค่าใช้จ่าย/สิทธิ์ Shell/ข้อจำกัดบริการให้ยืนยันจาก Dashboard ตอนเลือกแผน
