// ==========================================
// KIOTVIET WEBHOOK ROUTES — endpoint nhan Webhook tu KiotViet (Giai doan 0).
//
// Mount trong server/routes.js:
//   const kiotvietWebhookRoutes = require('./kiotviet/kiotvietWebhookRoutes');
//   router.use(kiotvietWebhookRoutes);
//
// STUB TAM THOI (Giai doan 0): chi tra HTTP 200 ngay lap tuc, KHONG xac dinh
// gian hang, KHONG ghi Postgres, KHONG queue xu ly nen. Muc dich duy nhat la
// co san 1 URL public de dang ky Webhook tren KiotViet ngay bay gio, tranh
// phai cho toi khi engine that duoc code o Giai doan 2. Giai doan 2 se thay
// logic that vao route nay — xem
// docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md muc 5.
//
// Khong dung requireAuth/resolveBranch o day: nguoi goi la KiotViet, khong
// phai nguoi dung da dang nhap, khong co cookie/session.
// ==========================================
'use strict';

const express = require('express');
const router = express.Router();

router.post('/api/kiotviet/webhook', (req, res) => {
  res.status(200).json({ received: true });
});

module.exports = router;
