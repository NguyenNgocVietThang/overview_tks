const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const CONFIG = require('./config');
const routes = require('./routes');
const { startHrTelegramBot, isTelegramBotRuntimeEnabled } = require('./telegram/hrTelegramBot');

const app = express();

app.use(compression());
app.use(express.json());
app.use(cookieParser());

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
    } else if (/\.(png|jpg|jpeg|svg|webp|ico)$/.test(filePath)) {
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
});
