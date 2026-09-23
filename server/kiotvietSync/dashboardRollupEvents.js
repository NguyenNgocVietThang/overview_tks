'use strict';

// EventEmitter dung chung giua dashboardRollupRefresh.js (noi phat su kien
// 'updated' moi lan rollup refresh xong, 5 phut/lan) va route SSE
// /api/dashboard/events trong routes.js (noi lang nghe de day tin hieu xuong
// trinh duyet). Tach rieng file de tranh vong lap require giua 2 noi tren.
const { EventEmitter } = require('events');

const dashboardRollupEvents = new EventEmitter();
// Nhieu tab trinh duyet cung mo -> nhieu SSE client dang ky 'updated' cung
// luc; nang gioi han mac dinh (10) de Node khong canh bao MaxListeners.
dashboardRollupEvents.setMaxListeners(0);

module.exports = { dashboardRollupEvents };
