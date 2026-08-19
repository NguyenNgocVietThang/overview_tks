const path = require('path');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const CONFIG = require('./config');
const routes = require('./routes');

const app = express();

app.use(compression());
app.use(express.json());
app.use(cookieParser());

// API + auth routes TRUOC static (tranh express.static chop mat /api/*)
app.use(routes);

// Static files (html, css, js, images...)
app.use(express.static(path.join(__dirname, 'public')));

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
});
