'use strict';
// Su kien realtime cho trang /transfers/ (SSE). Chi mang id/version/status: client tu tai lai
// du lieu qua API (da kiem quyen) — khong day STK/ten khach qua kenh nay.
// Phat trong tien trinh: du cho 1 instance Render; chay nhieu instance thi can kenh chung (pg NOTIFY).

const { EventEmitter } = require('events');

const transferEvents = new EventEmitter();
transferEvents.setMaxListeners(200);

function broadcastTransferEvent(type, row) {
  if (!type || !row) return;
  transferEvents.emit('transfer-event', {
    type,
    id: row.id,
    version: row.version,
    status: row.status,
    saleTelegramId: row.saleTelegramId,
    timestamp: new Date().toISOString()
  });
}

module.exports = { transferEvents, broadcastTransferEvent };
