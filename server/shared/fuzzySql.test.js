'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { fuzzySqlParts, VN_FROM, VN_TO } = require('./fuzzySql');
const fuzzy = require('./fuzzySearch');

test('bảng bỏ dấu SQL khớp hàm fold của JS', () => {
  assert.equal([...VN_FROM].length, [...VN_TO].length);
  [...VN_FROM].forEach((ch, i) => assert.equal(fuzzy.fold(ch), VN_TO[i], ch));
});

test('fuzzySqlParts: rỗng -> null; 1 từ dùng lại tham số; nhiều từ thêm tham số cụm', () => {
  const add = (params) => (v) => { params.push(v); return `$${params.length}`; };
  assert.equal(fuzzySqlParts('t', '   ', add([])), null);
  const one = []; fuzzySqlParts('t', 'Đạt', add(one));
  assert.deepEqual(one, ['dat']);
  const many = []; const parts = fuzzySqlParts('t', 'Nguyễn Văn Đạt', add(many));
  assert.deepEqual(many, ['nguyen', 'van', 'dat', 'nguyen van dat']);
  assert.match(parts.where, />=2/);
});

test('chạy thật trên Postgres: cùng kết quả với luật JS', async () => {
  const db = new PGlite();
  const texts = ['Nguyễn Văn Đạt', 'Lê Văn Nam', 'Trần Thị Hoa', 'Hà Nội Văn Phòng', null];
  const run = async (q) => {
    const params = [];
    const p = fuzzySqlParts('t', q, (v) => { params.push(v); return `$${params.length}`; });
    const { rows } = await db.query(`SELECT i FROM (SELECT * FROM unnest($${params.length + 1}::text[]) WITH ORDINALITY AS x(t,i)) s(t,i) WHERE ${p.where} ORDER BY ${p.score} DESC, i`, [...params, texts]);
    return rows.map((r) => Number(r.i) - 1);
  };
  for (const q of ['van', 'NGUYEN VAN', 'van dat', 'van zzz', 'hoa thi tran', 'ha noi van']) {
    const expected = fuzzy.filter(texts.map((t, i) => ({ t, i })), q, (x) => x.t).map((x) => x.i);
    assert.deepEqual(await run(q), expected, q);
  }
});
