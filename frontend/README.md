# PayDay Frontend สำหรับ deploy

**ให้แก้ React ที่ frontend/src/ ใน repo payday-payroll นี้** แล้ว commit ไปพร้อม Backend

โฟลเดอร์เดิม `~/Developer/payday-payroll-frontend` คงไว้เป็นสำเนาต้นฉบับ ไม่ได้ sync อัตโนมัติและไม่ได้ถูก Render build อ่าน ห้ามคัดลอก `.env`, `.git`, node_modules หรือ dist จากต้นฉบับเข้ามา

ดู [README หลัก](../README.md), [ตั้ง Render](../RENDER.md), [บัญชีและสิทธิ์](../server/AUTH.md), [ฟีเจอร์พนักงาน](../server/SELF_SERVICE.md)

จาก repo root:

```sh
npm run dev:frontend  # Vite proxy สำหรับพัฒนา
npm run lint
npm run build        # build ทั้ง checkout; Express เสิร์ฟ frontend/dist
npm start            # เรียก Express; Render ตั้ง NODE_ENV=production
```

Frontend ใช้ relative `/api` เท่านั้น ไม่ต้องตั้ง VITE_API_URL เมื่อใช้ production origin เดียว Historical TESTING.md และ AUTH_TESTING.md เป็นผลตรวจช่วงพัฒนาบน Mac ผลตรวจ deploy build ล่าสุดอยู่ใน [DEPLOY_TESTING.md](../DEPLOY_TESTING.md)
