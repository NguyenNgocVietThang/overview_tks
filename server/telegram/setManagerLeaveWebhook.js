'use strict';

const CONFIG = require('../config');
const { validateManagerTelegramConfig } = require('./managerLeaveRuntime');
const { createTelegramApi } = require('./telegramApi');

async function setManagerLeaveWebhook() {
  if (!validateManagerTelegramConfig(CONFIG)) throw new Error('Bật HR_MANAGER_TELEGRAM_ENABLED trước khi đăng ký webhook.');
  const telegram = createTelegramApi({ token: CONFIG.HR_MANAGER_TELEGRAM_BOT_TOKEN });
  const url = new URL('/api/telegram/manager-leave/webhook', CONFIG.HR_MANAGER_TELEGRAM_WEB_URL).href;
  await telegram.call('setWebhook', {
    url, secret_token: CONFIG.HR_MANAGER_TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'], drop_pending_updates: false,
    max_connections: 1
  });
  const info = await telegram.call('getWebhookInfo', {});
  if (info.url !== url) throw new Error('Telegram chưa xác nhận đúng URL webhook.');
  console.log(`Đã đăng ký webhook bot quản lý: ${url}`);
}

if (require.main === module) setManagerLeaveWebhook().catch(err => {
  console.error('Không đăng ký được webhook:', err.code || err.message);
  process.exitCode = 1;
});

module.exports = { setManagerLeaveWebhook };
