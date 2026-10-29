const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('./filter-links');

// <select> gia: chi can value + options [{ value, disabled, hidden }].
function fakeSelect(value, values) {
  return { value, options: ['', ...values].map(v => ({ value: v, disabled: false, hidden: false })) };
}
const blocked = select => select.options.filter(o => o.disabled).map(o => o.value);

const rows = [
  { team: 'A', sale: 'An', days: '7' },
  { team: 'A', sale: 'Binh', days: '15' },
  { team: 'B', sale: 'Cuong', days: '7' }
];

test('mỗi ô lọc chỉ giữ giá trị còn dòng khi ghép với các ô KHÁC (bỏ chính nó)', () => {
  const team = fakeSelect('A', ['A', 'B']);
  const sale = fakeSelect('', ['An', 'Binh', 'Cuong']);
  const days = fakeSelect('', ['7', '15']);
  links.apply(rows, [
    { select: team, value: r => r.team }, { select: sale, value: r => r.sale }, { select: days, value: r => r.days }
  ]);
  assert.deepEqual(blocked(sale), ['Cuong'], 'Sale chỉ còn của team A');
  assert.deepEqual(blocked(days), [], 'Cả 7 và 15 ngày đều có ở team A');
  assert.deepEqual(blocked(team), [], 'Ô Team bỏ chính nó nên vẫn thấy cả B');
  assert.ok(sale.options.find(o => o.value === 'Cuong').hidden);
});

test('giá trị đang chọn không bao giờ bị khóa; "Tất cả" luôn dùng được', () => {
  const team = fakeSelect('B', ['A', 'B']);
  const sale = fakeSelect('An', ['An', 'Binh', 'Cuong']); // An thuộc team A nhưng đang chọn cùng team B
  links.apply(rows, [{ select: team, value: r => r.team }, { select: sale, value: r => r.sale }]);
  assert.deepEqual(blocked(sale), ['Binh'], 'An đang chọn nên giữ; Binh (team A) bị khóa; Cuong dùng được');
  assert.equal(sale.options[0].disabled, false);
});

test('neutral, norm, giá trị nhiều phần tử và điều kiện phụ (extra)', () => {
  const queue = fakeSelect('all', ['currentDebt', 'overdue']);
  const dept = fakeSelect('', ['Kho', 'Sale']);
  const data = [
    { queues: ['currentDebt'], dept: ' kho ' },
    { queues: ['currentDebt', 'overdue'], dept: 'SALE' },
    { queues: [], dept: 'Kho' }
  ];
  links.apply(data, [
    { select: queue, neutral: ['', 'all'], value: r => r.queues },
    { select: dept, value: r => r.dept, norm: v => String(v).trim().toLowerCase() }
  ], r => r.queues.length > 0);
  assert.deepEqual(blocked(queue), [], 'all = trung tính; ô Hàng chờ bỏ chính nó');
  queue.value = 'overdue';
  links.apply(data, [
    { select: queue, neutral: ['', 'all'], value: r => r.queues },
    { select: dept, value: r => r.dept, norm: v => String(v).trim().toLowerCase() }
  ], r => r.queues.length > 0);
  assert.deepEqual(blocked(dept), ['Kho'], 'chỉ dòng quá hạn là Sale; Kho bị khóa');
});

test('không có dòng hoặc thiếu select thì không lỗi', () => {
  links.apply(null, [{ select: fakeSelect('', ['x']), value: r => r.x }]);
  links.apply(rows, [{ select: null, value: r => r.team }]);
});
