// ==========================================
// HR LEAVE EVENTS — EventEmitter singleton cho real-time updates.
// Phat su kien khi co don moi hoac khi Quan ly doi trang thai phe duyet.
// ==========================================
'use strict';

const { EventEmitter } = require('events');
const { BRANCHES } = require('../branch/branches');

const leaveEvents = new EventEmitter();
// Tang gioi han listener de ho tro nhieu client ket noi dong thoi
leaveEvents.setMaxListeners(200);

const LEAVE_EVENT_TYPES = Object.freeze({
  STATUS_CHANGED: 'LEAVE_STATUS_CHANGED',
  CREATED: 'LEAVE_REQUEST_CREATED'
});

/**
 * Phat su kien thay doi du lieu don nghi phep toi tat ca SSE clients.
 * `branch` di kem trong payload de moi client CHI nhan su kien cua co so minh
 * dang xem — neu khong, don nghi phep cua Sai Gon se hien realtime tren man
 * hinh nguoi dung Ha Noi.
 * @param {string} type - 'LEAVE_STATUS_CHANGED' hoac 'LEAVE_REQUEST_CREATED'
 * @param {Object} data - Ban ghi don nghi phep duoc tao/cap nhat
 * @param {string} [branch] - Co so cua ban ghi ('Hà Nội' | 'Sài Gòn')
 */
function broadcastLeaveEvent(type, data, branch) {
  if (!type || !data) return;
  leaveEvents.emit('leave-event', {
    type,
    data,
    branch: branch || BRANCHES.HANOI,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  leaveEvents,
  LEAVE_EVENT_TYPES,
  broadcastLeaveEvent
};
