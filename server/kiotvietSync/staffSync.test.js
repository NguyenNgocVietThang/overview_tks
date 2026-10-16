'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { upsertStaffFromEntity } = require('./staffSync');
test('staff helper skips absent IDs and parameterizes the inferred staff record', async () => {
  const calls = [];
  const client = { query: async (...args) => calls.push(args) };
  await upsertStaffFromEntity(client, 'hanoi', null, 'Nobody');
  await upsertStaffFromEntity(client, 'hanoi', 7, "O'Neil");
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /ON CONFLICT \(branch, id\)/);
  assert.deepEqual(calls[0][1], ['hanoi', 7, "O'Neil"]);
});

// Moi hoa don/don hang/phieu thu chi deu goi upsert nay: truoc day ~240 dong
// `staff` bi UPDATE ~42.000 lan/34 ngay chi de dat lai last_seen_at.
test('staff helper chi UPDATE khi ten doi hoac last_seen_at da cu hon 1 ngay', async () => {
  const calls = [];
  await upsertStaffFromEntity({ query: async (...args) => calls.push(args) }, 'hanoi', 7, 'A');
  assert.match(calls[0][0], /WHERE staff\.name IS DISTINCT FROM COALESCE\(EXCLUDED\.name, staff\.name\)/);
  assert.match(calls[0][0], /OR staff\.last_seen_at < now\(\) - interval '1 day'/);
});
