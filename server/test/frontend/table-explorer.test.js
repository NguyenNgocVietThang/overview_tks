'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTableSearchText,
  parseTableCodes,
  filterTableItems,
  findTableItemPage
} = require('../../public/js/table-explorer');

test('normalizeTableSearchText bỏ dấu, hạ chữ và gom khoảng trắng', () => {
  assert.equal(normalizeTableSearchText('  CHỔI   Lau Nhà  '), 'choi lau nha');
  assert.equal(normalizeTableSearchText('Đèn LED'), 'den led');
});

test('parseTableCodes nhận mọi dấu phân cách, bỏ trùng và giữ số 0 đầu', () => {
  assert.deepEqual(
    parseTableCodes('SP001, sp002;\n00123 SP001'),
    ['SP001', 'sp002', '00123']
  );
});

test('tìm thông thường giữ tất cả dòng chứa cụm từ trên toàn bộ tập', () => {
  const items = [
    { code: 'SP001', name: 'Chổi lau nhà lớn' },
    { code: 'SP002', name: 'Chổi lau nhà nhỏ' },
    { code: 'SP003', name: 'Nước lau sàn' }
  ];
  const config = {
    searchText: item => `${item.code} ${item.name}`,
    code: item => item.code
  };

  const result = filterTableItems(items, config, { mode: 'normal', query: 'choi lau nha' });

  assert.deepEqual(result.items.map(item => item.code), ['SP001', 'SP002']);
  assert.deepEqual(result.requestedCodes, []);
  assert.deepEqual(result.missingCodes, []);
});

test('tìm nhiều mã khớp chính xác, giữ thứ tự dữ liệu và báo mã thiếu', () => {
  const items = [
    { code: 'SP001', name: 'Chổi lớn' },
    { code: 'sp002', name: 'Chổi nhỏ' },
    { code: '00123', name: 'Mã có số 0 đầu' }
  ];
  const config = {
    searchText: item => `${item.code} ${item.name}`,
    code: item => item.code
  };

  const result = filterTableItems(items, config, { mode: 'codes', query: 'SP002 SP404 00123' });

  assert.deepEqual(result.items.map(item => item.code), ['sp002', '00123']);
  assert.deepEqual(result.requestedCodes, ['SP002', 'SP404', '00123']);
  assert.deepEqual(result.missingCodes, ['SP404']);
});

test('từ khóa rỗng trả nguyên tập và tìm trang dùng định danh ổn định', () => {
  const items = Array.from({ length: 205 }, (_, index) => ({ code: `SP${String(index + 1).padStart(3, '0')}` }));
  const result = filterTableItems(items, { searchText: item => item.code }, { mode: 'normal', query: '   ' });

  assert.equal(result.items, items);
  assert.deepEqual(findTableItemPage(items, 'SP120', item => item.code, 100), { index: 119, page: 2 });
  assert.equal(findTableItemPage(items, 'SP999', item => item.code, 100), null);
});
