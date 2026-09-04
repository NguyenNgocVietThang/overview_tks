// ==========================================
// SMS SENDER — Gui SMS that qua SpeedSMS REST API (speedsms.vn). Dung cho
// OTP quen mat khau (server/auth/otpService.js). KHONG bat buoc cau hinh:
// neu thieu SPEEDSMS_ACCESS_TOKEN, isConfigured() tra false va noi goi
// (otpService) tu fallback ve console.log (che do dev).
//
// Tai lieu: https://speedsms.vn/sms-api/ — POST /sms/send, xac thuc bang
// HTTP Basic Auth (access token lam username), sms_type=4 la "Notify" mac
// dinh khong can dang ky brandname, phu hop gui OTP.
// ==========================================
const CONFIG = require('../config');

const SPEEDSMS_ENDPOINT = 'https://api.speedsms.vn/index.php/sms/send';

function isConfigured() {
  return Boolean(CONFIG.SPEEDSMS_ACCESS_TOKEN);
}

function otpSmsContent(code, expiresInSeconds) {
  const minutes = Math.round(expiresInSeconds / 60);
  return `Ma OTP dat lai mat khau TOKOSI Dashboard: ${code} (hieu luc ${minutes} phut). Khong chia se ma nay cho bat ky ai.`;
}

/**
 * Gui SMS chua ma OTP toi 1 so dien thoai (dinh dang noi dia "0xxxxxxxxx",
 * xem localUserStore.normalizePhone). Tra { ok: true } neu SpeedSMS xac nhan
 * gui thanh cong, { ok: false, error } neu that bai (sai token, het tien,
 * so khong hop le, loi mang...).
 */
async function sendOtpSms({ to, code, expiresInSeconds }) {
  if (!isConfigured()) {
    return { ok: false, error: 'SMS_NOT_CONFIGURED' };
  }
  try {
    const basicAuth = Buffer.from(`${CONFIG.SPEEDSMS_ACCESS_TOKEN}:x`).toString('base64');
    const res = await fetch(SPEEDSMS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`
      },
      body: JSON.stringify({
        to: [to],
        content: otpSmsContent(code, expiresInSeconds),
        sms_type: CONFIG.SPEEDSMS_SMS_TYPE,
        sender: CONFIG.SPEEDSMS_SENDER || ''
      })
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.status !== 'success') {
      const errMsg = (body && (body.message || body.code)) || `HTTP ${res.status}`;
      console.error('[smsSender] Gui SMS OTP that bai:', errMsg);
      return { ok: false, error: String(errMsg) };
    }
    return { ok: true };
  } catch (err) {
    console.error('[smsSender] Loi ket noi SpeedSMS:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { isConfigured, sendOtpSms };
