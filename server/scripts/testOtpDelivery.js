// ==========================================
// KIEM TRA KET NOI GUI OTP THAT (Gmail SMTP) — doc cau hinh tu .env, gui thu
// 1 email chua ma OTP mau toi dia chi truyen vao. Dung de xac minh
// SMTP_USER/SMTP_APP_PASSWORD hoat dong dung truoc khi phu thuoc vao no
// trong luong "Quen mat khau".
//
// Cach dung:
//   node scripts/testOtpDelivery.js <email>
//   node scripts/testOtpDelivery.js thangnnv2003@gmail.com
// ==========================================
'use strict';
const emailSender = require('../notifications/emailSender');

async function main() {
  const [, , email] = process.argv;
  if (!email) {
    console.error('Cách dùng: node scripts/testOtpDelivery.js <email>');
    process.exit(1);
  }

  const testCode = '123456';
  const expiresInSeconds = 300;

  console.log(`\n--- Gửi thử Email OTP tới ${email} ---`);
  if (!emailSender.isConfigured()) {
    console.log('CHƯA cấu hình SMTP_USER/SMTP_APP_PASSWORD trong .env — bỏ qua.');
  } else {
    const res = await emailSender.sendOtpEmail({ to: email, code: testCode, expiresInSeconds });
    console.log(res.ok ? 'THÀNH CÔNG — kiểm tra hộp thư đến.' : `THẤT BẠI: ${res.error}`);
  }
}

main().catch(err => {
  console.error('Lỗi không mong đợi:', err);
  process.exit(1);
});
