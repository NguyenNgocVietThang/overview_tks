// ==========================================
// HR LEAVE EVENTS — EventEmitter singleton cho real-time updates.
// Phat su kien khi co don moi hoac khi Quan ly doi trang thai phe duyet.
// ==========================================
'use strict';

const { EventEmitter } = require('events');

const leaveEvents = new EventEmitter();
// Tang gioi han listener de ho tro nhieu client ket noi dong thoi
leaveEvents.setMaxListeners(200);

const LEAVE_EVENT_TYPES = Object.freeze({
  STATUS_CHANGED: 'LEAVE_STATUS_CHANGED',
  CREATED: 'LEAVE_REQUEST_CREATED'
});

/**
 * Phat su kien thay doi du lieu don nghi phep toi tat ca SSE clients
 * @param {string} type - 'LEAVE_STATUS_CHANGED' hoac 'LEAVE_REQUEST_CREATED'
 * @param {Object} data - Ban ghi don nghi phep duoc tao/cap nhat
 */
function broadcastLeaveEvent(type, data) {
  if (!type || !data) return;
  leaveEvents.emit('leave-event', {
    type,
    data,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  leaveEvents,
  LEAVE_EVENT_TYPES,
  broadcastLeaveEvent
};
