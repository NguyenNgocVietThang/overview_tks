// ==========================================
// KIEM TRA KET NOI GUI OTP THAT (Gmail SMTP + SpeedSMS) — doc cau hinh tu
// .env, gui thu 1 email va/hoac 1 SMS chua ma OTP mau toi dia chi truyen
// vao. Dung de xac minh SMTP_USER/SMTP_APP_PASSWORD/SPEEDSMS_ACCESS_TOKEN
// hoat dong dung truoc khi phu thuoc vao no trong luong "Quen mat khau".
//
// Cach dung:
//   node scripts/testOtpDelivery.js <email> <so-dien-thoai>
//   node scripts/testOtpDelivery.js thangnnv2003@gmail.com 0974089295
// ==========================================
'use strict';
const emailSender = require('../notifications/emailSender');
const smsSender = require('../notifications/smsSender');

async function main() {
  const [, , email, phone] = process.argv;
  if (!email && !phone) {
    console.error('Cách dùng: node scripts/testOtpDelivery.js <email> <so-dien-thoai>');
    process.exit(1);
  }

  const testCode = '123456';
  const expiresInSeconds = 300;

  if (email) {
    console.log(`\n--- Gửi thử Email OTP tới ${email} ---`);
    if (!emailSender.isConfigured()) {
      console.log('CHƯA cấu hình SMTP_USER/SMTP_APP_PASSWORD trong .env — bỏ qua.');
    } else {
      const res = await emailSender.sendOtpEmail({ to: email, code: testCode, expiresInSeconds });
      console.log(res.ok ? 'THÀNH CÔNG — kiểm tra hộp thư đến.' : `THẤT BẠI: ${res.error}`);
    }
  }

  if (phone) {
    console.log(`\n--- Gửi thử SMS OTP tới ${phone} ---`);
    if (!smsSender.isConfigured()) {
      console.log('CHƯA cấu hình SPEEDSMS_ACCESS_TOKEN trong .env — bỏ qua.');
    } else {
      const res = await smsSender.sendOtpSms({ to: phone, code: testCode, expiresInSeconds });
      console.log(res.ok ? 'THÀNH CÔNG — kiểm tra điện thoại.' : `THẤT BẠI: ${res.error}`);
    }
  }
}

main().catch(err => {
  console.error('Lỗi không mong đợi:', err);
  process.exit(1);
});
