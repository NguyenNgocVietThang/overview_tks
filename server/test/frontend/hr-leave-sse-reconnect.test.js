'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('SSE initial connection and reconnection reload committed leave snapshot', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/humanresources/index.html'), 'utf8');
  const start = html.indexOf('let leaveEventSource = null;');
  const end = html.indexOf('// ---------- Init ----------', start);
  let stream;
  const calls = [];
  const context = { window: {}, EventSource: class {
    constructor() { stream = this; }
    close() {}
  }, loadLeaveRequests: silent => calls.push(silent), console };
  context.window.EventSource = context.EventSource;
  vm.runInNewContext(html.slice(start, end), context);
  context.setupLeaveRealtimeStream();
  assert.equal(typeof stream.onopen, 'function');
  stream.onopen();
  stream.onopen();
  assert.deepEqual(calls, [true, true]);
});
