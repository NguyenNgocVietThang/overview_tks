'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { seedCheckpoints, parseArgs, ENTITIES } = require('./seedCheckpoints');

function fakePool() {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
}

test('seedCheckpoints ghi 1 dong cho moi cap (branch, entity), dung fromIso', async () => {
  const pool = fakePool();
  const rows = await seedCheckpoints(pool, ['hanoi', 'saigon'], '2026-09-16T01:30:00.000Z', { log: () => {} });

  assert.equal(pool.calls.length, 2 * ENTITIES.length, 'phai co dung 1 query cho moi cap branch x entity');
  assert.equal(rows.length, 2 * ENTITIES.length);
  for (const call of pool.calls) {
    assert.match(call.sql, /INSERT INTO sync_checkpoints/);
    assert.match(call.sql, /ON CONFLICT \(branch, entity\) DO UPDATE/);
    assert.equal(call.params[2], '2026-09-16T01:30:00.000Z');
  }
  const hanoiEntities = pool.calls.filter((c) => c.params[0] === 'hanoi').map((c) => c.params[1]);
  assert.deepEqual(new Set(hanoiEntities), new Set(ENTITIES), 'phai cover dung toan bo entity duoc poll (fast + slow)');
});

test('seedCheckpoints dung LEAST() de khong lam TRE hon checkpoint da co san (chi lam sach hon)', async () => {
  const pool = fakePool();
  await seedCheckpoints(pool, ['hanoi'], '2026-09-16T01:30:00.000Z', { log: () => {} });
  const sql = pool.calls[0].sql.replace(/\s+/g, ' ');
  assert.match(sql, /LEAST\(COALESCE\(sync_checkpoints\.last_synced_at, EXCLUDED\.last_synced_at\), EXCLUDED\.last_synced_at\)/);
});

test('parseArgs doc dung --from', () => {
  assert.deepEqual(parseArgs(['--from=2026-09-16T01:30:00Z']), { from: '2026-09-16T01:30:00Z' });
  assert.deepEqual(parseArgs([]), {});
});
