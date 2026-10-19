const test = require('node:test');
const assert = require('node:assert/strict');
const { startMemoryMonitor } = require('./memoryMonitor');

const MB = 1048576;

function setup(rssMb, limitMb) {
  const logs = [];
  const warns = [];
  let fn = null;
  let unrefCalled = false;
  const fakeTimer = { unref() { unrefCalled = true; } };
  const monitor = startMemoryMonitor({
    intervalMs: 1000,
    limitMb,
    logger: { log: (s) => logs.push(s), warn: (s) => warns.push(s) },
    setIntervalFn: (f) => { fn = f; return fakeTimer; },
    memoryUsage: () => ({ rss: rssMb * MB, heapUsed: 10 * MB, external: 2 * MB, arrayBuffers: 1 * MB })
  });
  return { monitor, logs, warns, run: () => fn(), unref: () => unrefCalled };
}

test('ghi log moi chu ky va unref timer', () => {
  const t = setup(100, 2048);
  assert.equal(t.unref(), true);
  t.run();
  assert.equal(t.logs.length, 1);
  assert.match(t.logs[0], /\[Memory\] rss=100MB heap=10MB external=2MB arrayBuffers=1MB/);
  assert.equal(t.warns.length, 0);
  t.monitor.stop();
});

test('canh bao khi rss > 75% tran', () => {
  const t = setup(1600, 2048);
  t.run();
  assert.equal(t.warns.length, 1);
  t.monitor.stop();
});

test('khong canh bao khi rss bang dung 75% tran', () => {
  const t = setup(1536, 2048);
  t.run();
  assert.equal(t.warns.length, 0);
  t.monitor.stop();
});
