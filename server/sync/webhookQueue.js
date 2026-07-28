// ==========================================
// WEBHOOK QUEUE — nhan ngay lap tuc, xu ly bat dong bo
// Thay the CacheService + time-based trigger cua GAS bang mang trong bo nho
// + setInterval, vi Render giu 1 tien trinh song lien tuc (khong nhu GAS).
// ==========================================
const { updateProductsFromWebhook, updateInvoicesFromWebhook, updateCustomersFromWebhook } = require('./updateHandlers');

const queue = [];
let processing = false;

/**
 * BUOC 1: Nhan webhook, day vao hang doi trong bo nho, tra loi NGAY LAP TUC.
 */
function enqueue(rawBody) {
  queue.push(rawBody);
}

/**
 * BUOC 2: Xu ly hang doi - doc tat ca payload dang cho, ghi vao Sheet TUAN TU.
 */
async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;
  const batch = queue.splice(0, queue.length);
  console.log(`Bat dau xu ly ${batch.length} payload dang cho trong hang doi.`);

  for (const rawBody of batch) {
    try {
      const payload = JSON.parse(rawBody);
      let notifications = [];
      if (Array.isArray(payload.Notifications)) notifications = payload.Notifications;
      else if (Array.isArray(payload.notifications)) notifications = payload.notifications;
      else if (payload.Action || payload.action) notifications = [payload];

      for (const noti of notifications) {
        const action = (noti.Action || noti.action || '').toLowerCase();
        const items = noti.Data || noti.data || [];
        if (!items || items.length === 0) continue;

        if (action.includes('product') || action.includes('stock')) {
          await updateProductsFromWebhook(items);
        } else if (action.includes('invoice') || action.includes('order')) {
          await updateInvoicesFromWebhook(items);
        } else if (action.includes('customer')) {
          await updateCustomersFromWebhook(items);
        } else {
          console.log('Action khong xac dinh, bo qua: ' + action);
        }
      }
    } catch (err) {
      console.log('Loi parse/xu ly payload: ' + err.toString());
    }
  }

  console.log(`Hoan tat xu ly hang doi. Da xu ly: ${batch.length} / Con lai: ${queue.length}`);
  processing = false;
}

/**
 * Thiet lap chay processQueue() moi 60 giay, tuong duong trigger 1 phut trong GAS.
 */
function startQueueProcessing(intervalMs = 60000) {
  return setInterval(() => {
    processQueue().catch(err => console.error('Loi xu ly hang doi:', err));
  }, intervalMs);
}

module.exports = { enqueue, processQueue, startQueueProcessing };
