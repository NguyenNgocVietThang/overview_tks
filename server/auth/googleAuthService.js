// ==========================================
// GOOGLE AUTH SERVICE — xac thuc ID token tu Google Identity Services (nut
// "Dang nhap bang Google" o server/public/login/index.html goi len).
// Dung google-auth-library, KHONG dung authorization-code flow/passport —
// GOOGLE_CLIENT_ID la audience duy nhat can kiem tra, khong can client secret.
// Khong bao gio import truc tiep tu route — di qua authRoutes.js.
// ==========================================
const { OAuth2Client } = require('google-auth-library');
const CONFIG = require('../config');

let client = null;
function getClient() {
  if (!client) client = new OAuth2Client(CONFIG.GOOGLE_CLIENT_ID);
  return client;
}

/**
 * Xac thuc ID token (JWT) Google tra ve tu trinh duyet. Throw neu token gia
 * mao/het han/audience sai (authRoutes.js bat loi nay va tra 401).
 * Tra ve thong tin toi thieu can cho dang nhap/tu dang ky — KHONG tra ve
 * toan bo payload de tranh ro ri thong tin khong can thiet.
 */
async function verifyGoogleIdToken(idToken) {
  if (!CONFIG.GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID chưa được cấu hình.');
  }
  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: CONFIG.GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload() || {};
  return {
    email: String(payload.email || '').trim(),
    emailVerified: payload.email_verified === true,
    name: String(payload.name || '').trim()
  };
}

module.exports = { verifyGoogleIdToken };
