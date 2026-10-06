'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFilters,
  buildWhere,
  validateCheckpoint,
} = require('./cashbookFilters');
const now = new Date('2026-10-06T03:00:00Z');
test('mặc định cả chứng từ/trạng thái và năm theo VN', () => {
  const f = parseFilters({}, now);
  assert.equal(f.from, '2025-12-31T17:00:00.000Z');
  assert.equal(f.to, '2026-12-31T16:59:59.999Z');
  assert.deepEqual(f.docTypes, ['receipt', 'payment']);
  assert.deepEqual(f.statuses, ['paid', 'cancelled']);
});
test('preset theo ngày VN, tuần thứ hai và tháng/năm', () => {
  const cases = {
    today: ['2026-10-05T17:00:00.000Z', '2026-10-06T16:59:59.999Z'],
    yesterday: ['2026-10-04T17:00:00.000Z', '2026-10-05T16:59:59.999Z'],
    thisWeek: ['2026-10-04T17:00:00.000Z', '2026-10-11T16:59:59.999Z'],
    thisMonth: ['2026-09-30T17:00:00.000Z', '2026-10-31T16:59:59.999Z'],
    lastMonth: ['2026-08-31T17:00:00.000Z', '2026-09-30T16:59:59.999Z'],
  };
  for (const [preset, [from, to]] of Object.entries(cases)) {
    const f = parseFilters({ preset }, now);
    assert.equal(f.from, from);
    assert.equal(f.to, to);
  }
  assert.equal(
    parseFilters({ preset: 'today' }, new Date('2026-10-05T17:00:00Z')).from,
    '2026-10-05T17:00:00.000Z',
  );
});
test('list rỗng khác omitted và -1 là tài khoản lịch sử', () => {
  const f = parseFilters(
    {
      fund: '-1',
      groups: '',
      creators: '',
      staff: '',
      docTypes: '',
      statuses: '',
    },
    now,
  );
  assert.deepEqual(f.fund, ['-1']);
  assert.deepEqual(f.groups, []);
  assert.match(buildWhere(f).sql, /FALSE/);
});
test('mọi query lạ và ngày/số malformed trả400', () => {
  for (const q of [
    { branch: 'hanoi' },
    { fund: '-2' },
    { fund: '1 OR 1=1' },
    { statuses: 'unknown' },
    { preset: 'abc' },
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-07', to: '2026-10-06' },
    { page: '1junk' },
    { pageSize: '201' },
    { accounting: 'maybe' },
    { groups: 'name:' },
    { at: '2026-10-07T00:00:00Z' },
    { at: '2026-02-30T00:00:00Z' },
    { partnerType: 'customer' },
    { docTypes: ['receipt'] },
  ])
    assert.throws(
      () => parseFilters(q, now),
      (e) => e.statusCode === 400,
      JSON.stringify(q),
    );
});
test('tên nhóm và tìm đối tác là tham số, không thành SQL', () => {
  const needle = "x' OR TRUE --";
  const f = parseFilters(
    {
      groups: `name:${encodeURIComponent(needle)}`,
      partnerQ: needle,
      partnerPhone: '123%',
    },
    now,
  );
  const w = buildWhere(f);
  assert.ok(!w.sql.includes(needle));
  assert.ok(w.params.includes(needle));
  assert.ok(w.params.includes('%123\\%%'));
});
test('tìm mã phiếu và ghi chú là tham số ILIKE đã escape', () => {
  const f = parseFilters({ code: ' PT_1 ', note: "a' OR TRUE --" }, now);
  assert.equal(f.code, 'PT_1');
  const w = buildWhere(f);
  assert.match(w.sql, /c\.code ILIKE \$\d+/);
  assert.match(w.sql, /c\.description ILIKE \$\d+/);
  assert.ok(!w.sql.includes('OR TRUE'));
  assert.ok(w.params.includes('%PT\\_1%'));
  assert.ok(w.params.includes("%a' OR TRUE --%"));
  assert.deepEqual(buildWhere(parseFilters({}, now)).params.length, 4);
  assert.throws(() => parseFilters({ code: 'x'.repeat(201) }, now), /quá dài/);
});
test('ngày custom inclusive VN; timestamp preview chính xác', () => {
  const f = parseFilters(
    { from: '2026-10-01', to: '2026-10-02', at: '2026-10-02T10:30:01+07:00' },
    now,
  );
  assert.equal(f.to, '2026-10-02T16:59:59.999Z');
  assert.equal(f.at, '2026-10-02T03:30:01.000Z');
});
test('checkpoint validates single fund, money, date and note', () => {
  for (const body of [
    { fund: 'all', checkpointAt: now.toISOString(), balance: 1 },
    { fund: 'cash', checkpointAt: '2026-10-07T00:00:00Z', balance: 1 },
    { fund: 'cash', checkpointAt: now.toISOString(), balance: '1abc' },
    { fund: 'cash', checkpointAt: '2026-02-30T00:00:00Z', balance: 1 },
    { fund: 'cash', checkpointAt: now.toISOString(), balance: null },
    { fund: 'cash', checkpointAt: now.toISOString(), balance: Infinity },
  ])
    assert.throws(
      () => validateCheckpoint(body, now),
      (e) => e.statusCode === 400,
    );
  assert.equal(
    validateCheckpoint(
      {
        fund: '-1',
        checkpointAt: now.toISOString(),
        balance: '-12.50',
        note: 'x',
      },
      now,
    ).balance,
    -12.5,
  );
});
test('null, array body, unknown body fields rejected400', () => {
  for (const body of [
    null,
    [],
    {
      fund: 'cash',
      checkpointAt: now.toISOString(),
      balance: 1,
      nonsense: true,
    },
  ])
    assert.throws(
      () => validateCheckpoint(body, now),
      (e) => e.statusCode === 400,
    );
});
