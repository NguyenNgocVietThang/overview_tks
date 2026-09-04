const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const CONFIG = require('./config');
const routes = require('./routes');
const { startHrTelegramBot, isTelegramBotRuntimeEnabled } = require('./telegram/hrTelegramBot');
const { main: runKiotVietSyncEngine, isKiotVietSyncRuntimeEnabled } = require('./kiotvietSync/runSyncEngine');

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled rejection at:', promise, 'reason:', reason);
});

const app = express();

// App chay sau reverse proxy (Firebase App Hosting/Cloud Run, co the co
// Cloudflare phia truoc) — khong set trust proxy thi req.ip luon la IP cua
// proxy (giong het nhau cho MOI request), khien rate-limit theo IP trong
// authRoutes.js (forgotPasswordRateLimit) gop chung toan bo nguoi dung vao
// 1 bucket va khoa nham ca site chi sau vai chuc request.
app.set('trust proxy', 1);

app.use(compression());
// Mac dinh express.json() gioi han 100kb — khong du cho payload xuat Excel
// ket qua kiem tra dut hang (hang tram dong, moi dong kem chi tiet cac dot dut hang).
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Ngan Cloudflare/Render cache response API — du lieu bao cao phai luon lay tu
// Google Sheets moi nhat, khong duoc phep tra ban cache cu tu edge/CDN.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// API + auth routes TRUOC static (tranh express.static chop mat /api/*)
app.use(routes);

// Static files (html, css, js, images...)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}vendor${path.sep}`)) {
      // Vendor lib (chart.umd.min.js, three.min.js) hiem khi doi thu cong
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 ngay
    } else if (/\.(js|css)$/.test(filePath)) {
      // /shared/*, /js/* — luon revalidate de cap nhat UI tuc thi khi sua code
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/\.jfif$/i.test(filePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/\.(png|jpg|jpeg|svg|webp|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 ngay
    }
    // HTML: khong set — giu mac dinh (ETag revalidate), vi day la entry point
    // can luon lay ban moi nhat khi co deploy.
  }
}));

// ── 404 handlers ─────────────────────────────────────────────────────────────
// Phai dat SAU routes va static de chi bat nhung request khong khop gi ca.

// [1] /api/* — tra ve JSON 404 (khong bao gio tra HTML cho API client)
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Endpoint không tồn tại.',
    path: req.originalUrl,
    status: 404
  });
});

// [2] Tat ca route con lai — tra ve trang 404.html voi HTTP status 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Express Error]', err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    return res.status(status).json({
      error: err.message || 'Lỗi máy chủ nội bộ.',
      status
    });
  }
  res.status(status).send(`<h1>${status} Error</h1><p>${err.message || 'Internal Server Error'}</p>`);
});
// ─────────────────────────────────────────────────────────────────────────────

app.listen(CONFIG.PORT, () => {
  console.log(`TOKOSI dashboard server dang chay tren port ${CONFIG.PORT}`);

  // Bot Telegram xin nghi phep — chi khoi dong khi da cau hinh du, khong lam
  // crash server neu thieu (giong cach module Van chuyen xu ly VC_SPREADSHEET_ID).
  if (isTelegramBotRuntimeEnabled() && CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.HR_SPREADSHEET_ID) {
    startHrTelegramBot();
  } else if (!isTelegramBotRuntimeEnabled()) {
    console.warn('[HR Telegram Bot] Đã tắt ở runtime này — đặt TELEGRAM_BOT_ENABLED=true để bật ngoài Render.');
  } else {
    console.warn('[HR Telegram Bot] Chưa cấu hình TELEGRAM_BOT_TOKEN/HR_SPREADSHEET_ID — bot không khởi động.');
  }

  // KiotViet -> Postgres sync engine (server/kiotvietSync/) — chay ngay trong
  // process web server nay de tan dung Render Web Service free tier (khong co
  // Background Worker mien phi). Tu bat khi RENDER=true, tat o local tru khi
  // dat KIOTVIET_SYNC_ENABLED=true (tranh chay song song 2 noi cung goi API
  // KiotViet). Xem PlanDB-Phase1-Spec.md.
  if (isKiotVietSyncRuntimeEnabled()) {
    runKiotVietSyncEngine().catch((err) => {
      console.error('[KiotViet Sync] Lỗi khởi động sync engine:', err.message);
    });
  } else {
    console.warn('[KiotViet Sync] Đang tắt ở runtime này — đặt KIOTVIET_SYNC_ENABLED=true để bật ngoài Render.');
  }
});
