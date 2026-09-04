// ==========================================
// EMAIL SENDER — Gui email that qua Gmail SMTP (nodemailer). Dung cho
// OTP quen mat khau (server/auth/otpService.js). KHONG bat buoc cau hinh:
// neu thieu SMTP_USER/SMTP_APP_PASSWORD, isConfigured() tra false va noi
// goi (otpService) tu fallback ve console.log (che do dev).
// ==========================================
const nodemailer = require('nodemailer');
const CONFIG = require('../config');

let cachedTransporter = null;

function isConfigured() {
  return Boolean(CONFIG.SMTP_USER && CONFIG.SMTP_APP_PASSWORD);
}

function getTransporter() {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: CONFIG.SMTP_HOST,
      port: CONFIG.SMTP_PORT,
      secure: CONFIG.SMTP_PORT === 465,
      auth: {
        user: CONFIG.SMTP_USER,
        pass: CONFIG.SMTP_APP_PASSWORD
      }
    });
  }
  return cachedTransporter;
}

function otpEmailHtml(code, expiresInSeconds) {
  const minutes = Math.round(expiresInSeconds / 60);
  return `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;color:#111;">Mã xác nhận đặt lại mật khẩu</h2>
      <p style="color:#444;font-size:14px;line-height:1.5;">
        Sử dụng mã bên dưới để đặt lại mật khẩu trên TOKOSI Dashboard. Mã có hiệu lực trong ${minutes} phút.
      </p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;
                  background:#f3f4f6;border-radius:10px;padding:16px;margin:16px 0;color:#111;">
        ${code}
      </div>
      <p style="color:#888;font-size:12px;line-height:1.5;">
        Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.
      </p>
    </div>
  `;
}

/**
 * Gui email chua ma OTP. Tra { ok: true } neu gui thanh cong, { ok: false,
 * error } neu that bai (sai cau hinh SMTP, mang loi, dia chi khong hop le...).
 */
async function sendOtpEmail({ to, code, expiresInSeconds }) {
  if (!isConfigured()) {
    return { ok: false, error: 'EMAIL_NOT_CONFIGURED' };
  }
  try {
    await getTransporter().sendMail({
      from: `"${CONFIG.SMTP_FROM_NAME}" <${CONFIG.SMTP_USER}>`,
      to,
      subject: `Mã OTP đặt lại mật khẩu: ${code}`,
      html: otpEmailHtml(code, expiresInSeconds)
    });
    return { ok: true };
  } catch (err) {
    console.error('[emailSender] Gui email OTP that bai:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { isConfigured, sendOtpEmail };
