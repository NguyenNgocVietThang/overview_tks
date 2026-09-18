'use strict';

// Dep dinh ky bang webhook_events_raw. Bang nay la log THO cua moi su kien
// webhook (khong phai du lieu nghiep vu - du lieu that da duoc ap dung vao
// orders/invoices/... boi webhookConsumer.js), khong co gia tri lau dai sau
// khi da xu ly. Supabase free tier chi 500MB - neu khong don, bang nay tang
// vo han theo thoi gian van hanh thuc te (moi su kien webhook 1 dong).

const DEFAULT_RETENTION_DAYS = 30;

async function cleanupOldWebhookEvents(pool, { retentionDays = DEFAULT_RETENTION_DAYS, log = console.log } = {}) {
  const result = await pool.query(
    `DELETE FROM webhook_events_raw WHERE received_at < now() - ($1 || ' days')::interval`,
    [String(Number(retentionDays) || DEFAULT_RETENTION_DAYS)]
  );
  if (result.rowCount) {
    log(`[webhookEventsCleanup] Da xoa ${result.rowCount} ban ghi webhook_events_raw cu hon ${retentionDays} ngay.`);
  }
  return result.rowCount;
}

function startWebhookEventsCleanupSchedule({
  pool, retentionDays = DEFAULT_RETENTION_DAYS, intervalMs = 24 * 60 * 60 * 1000,
  setIntervalFn = setInterval, log = console.log
} = {}) {
  return setIntervalFn(() => {
    cleanupOldWebhookEvents(pool, { retentionDays, log }).catch((error) => {
      log(`[webhookEventsCleanup] Loi khi don dep: ${error.message}`);
    });
  }, intervalMs);
}

module.exports = { cleanupOldWebhookEvents, startWebhookEventsCleanupSchedule, DEFAULT_RETENTION_DAYS };
