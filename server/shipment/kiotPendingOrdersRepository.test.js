'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createKiotPendingOrdersRepository, LIFECYCLE_TO_DB_BRANCH, DB_TO_LIFECYCLE_BRANCH, __test__
} = require('./kiotPendingOrdersRepository');

const { allocateSellable } = __test__;

// ---------------------------------------------------------------------------
// HAM THUAN allocateSellable — dung dung vi du cua nguoi dung (2026-10-01):
// don co mat hang A SL 500, B SL 70; ton Kiot A=40, B=800; A dang van chuyen 160
// => gia tri co ban = 200 mat hang A + 70 mat hang B.
// ---------------------------------------------------------------------------

function line(orderKey, productKey, quantity, unitPrice) {
  return { orderKey, productKey, quantity, amount: quantity * unitPrice };
}

test('allocateSellable: vi du cua nguoi dung — A: min(500, 40+160)=200, B: min(70, 800)=70', () => {
  const lines = [line('o1', 'a', 500, 1000), line('o1', 'b', 70, 5000)];
  const onHand = { a: 40, b: 800 };
  const inTransit = { a: 160 };
  const parts = allocateSellable(lines, l => (onHand[l.productKey] || 0) + (inTransit[l.productKey] || 0));
  assert.equal(parts[0].sellableQty, 200);
  assert.equal(parts[0].sellableAmount, 200 * 1000);
  assert.equal(parts[1].sellableQty, 70);
  assert.equal(parts[1].sellableAmount, 70 * 5000);
  assert.equal(parts[0].sellableAmount + parts[1].sellableAmount, 200 * 1000 + 70 * 5000);
});

test('allocateSellable: ton du thi co ban toan bo, khong vuot SL dat; ton am hoac 0 thi 0', () => {
  const lines = [line('o1', 'a', 10, 100), line('o1', 'b', 10, 100), line('o1', 'c', 10, 100)];
  const stock = { a: 999, b: -5, c: 0 };
  const parts = allocateSellable(lines, l => stock[l.productKey]);
  assert.deepEqual(parts.map(p => p.sellableQty), [10, 0, 0]);
  assert.deepEqual(parts.map(p => p.sellableAmount), [1000, 0, 0]);
});

test('allocateSellable: ton am nhung co hang dang van chuyen thi tinh theo (ton + van chuyen) neu duong', () => {
  const parts = allocateSellable([line('o1', 'a', 100, 10)], () => -20 + 50);
  assert.equal(parts[0].sellableQty, 30);
});

test('allocateSellable: cung 1 san pham o nhieu dong cua 1 don chi tinh ton 1 LAN (chia ti le)', () => {
  // Ton cap 60 cho tong 100 (40 + 60) => ti le 0,6 chia deu 2 dong.
  const lines = [line('o1', 'a', 40, 10), line('o1', 'a', 60, 20)];
  const parts = allocateSellable(lines, () => 60);
  assert.ok(Math.abs(parts[0].sellableQty - 24) < 1e-9);
  assert.ok(Math.abs(parts[1].sellableQty - 36) < 1e-9);
  assert.ok(Math.abs(parts[0].sellableQty + parts[1].sellableQty - 60) < 1e-9, 'tong dung bang ton cap');
  assert.ok(Math.abs(parts[0].sellableAmount - 240) < 1e-9);
  assert.ok(Math.abs(parts[1].sellableAmount - 720) < 1e-9);
});

test('allocateSellable: hai DON khac nhau cung san pham khong tru ton cua nhau (khong tru phieu tam khac)', () => {
  const parts = allocateSellable([line('o1', 'a', 10, 1), line('o2', 'a', 10, 1)], () => 10);
  assert.deepEqual(parts.map(p => p.sellableQty), [10, 10]);
});

test('allocateSellable: dong thue VAT* va dong khong co ma bi bo (null), khong anh huong dong khac', () => {
  const lines = [line('o1', 'vatda44', 1, 160000), line('o1', '', 5, 100), line('o1', 'a', 5, 100)];
  const parts = allocateSellable(lines, () => 5);
  assert.deepEqual(parts[0], { sellableQty: null, sellableAmount: null });
  assert.deepEqual(parts[1], { sellableQty: null, sellableAmount: null });
  assert.equal(parts[2].sellableAmount, 500);
});

test('allocateSellable: so luong le (hang ban theo can) va SL 0', () => {
  const parts = allocateSellable([line('o1', 'a', 2.5, 100), line('o1', 'b', 0, 100)], l => (l.productKey === 'a' ? 1.25 : 99));
  assert.equal(parts[0].sellableQty, 1.25);
  assert.equal(parts[0].sellableAmount, 125);
  assert.equal(parts[1].sellableQty, 0);
});

// ---------------------------------------------------------------------------
// Doc DB (pool gia)
// ---------------------------------------------------------------------------

const OR = (extra) => ({
  branch: 'hanoi', order_id: '1', code: 'DH000001', total: 1000000,
  order_date_text: '30/09/2026 10:15', order_date_key: '2026-09-30T10:15:00',
  customer_name: 'KH A', sale_name: 'Nguyễn Văn A', product_code: 'A', quantity: 500, amount: 500000,
  ...extra
});

/** Pool gia: nhan ra 3 loai truy van theo noi dung SQL; dem so lan goi. */
function createFakePool({ orderRows = [], onHand = {}, failOrders = false } = {}) {
  const calls = { orders: 0, onHand: [] };
  return {
    calls,
    async query(sql, params) {
      if (sql.includes('FROM orders o') && sql.includes('LEFT JOIN order_details')) {
        calls.orders++;
        if (failOrders) throw new Error('db down');
        return { rows: orderRows };
      }
      if (sql.includes('FROM products p') && sql.includes('jsonb_array_elements')) {
        calls.onHand.push(params);
        const branchStock = onHand[params[0]] || {};
        return { rows: params[1].filter(code => code in branchStock).map(code => ({ code, on_hand: branchStock[code] })) };
      }
      throw new Error('truy van la: ' + sql.slice(0, 60));
    }
  };
}

function repoFor(pool, extra = {}) {
  let clock = 1_000_000;
  const repo = createKiotPendingOrdersRepository({
    pool,
    now: () => clock,
    ttlMs: 60_000,
    staleMs: 600_000,
    readInTransit: async () => new Map([['a', 160]]),
    ...extra
  });
  return { repo, advance: ms => { clock += ms; } };
}

test('readPendingOrders: gia tri co ban theo dung vi du, ton theo dung co so cua don, don sap moi nhat truoc', async () => {
  const pool = createFakePool({
    orderRows: [
      // Don HN: A SL 500 don gia 1000 (ton HN 40 + van chuyen 160 = 200); B SL 70 don gia 5000 (ton 800)
      OR({ order_id: '1', code: 'DH000001', product_code: 'A', quantity: 500, amount: 500000 }),
      OR({ order_id: '1', code: 'DH000001', product_code: 'B', quantity: 70, amount: 350000 }),
      // Dong thue VAT cua don HN khong tinh vao gia tri co ban
      OR({ order_id: '1', code: 'DH000001', product_code: 'VATDA44', quantity: 1, amount: 160000 }),
      // Don SG cung ma hang A nhung ton SG = 0 (chi co hang dang van chuyen 160 cho moi co so)
      OR({ branch: 'saigon', order_id: '9', code: 'DH000001', order_date_text: '01/10/2026 08:00', order_date_key: '2026-10-01T08:00:00',
        product_code: 'A', quantity: 100, amount: 100000, sale_name: 'Lê Thị B' })
    ],
    onHand: { hanoi: { A: 40, B: 800, VATDA44: 0 }, saigon: { A: 0 } }
  });
  const { repo } = repoFor(pool);
  const result = await repo.readPendingOrders();

  assert.equal(result.ok, true);
  assert.equal(result.orders.length, 2);
  // Moi nhat truoc: don SG (01/10) dung truoc don HN (30/09) — cung ma DH000001 nhung khac co so.
  assert.deepEqual(result.orders.map(o => [o.branch, o.code]), [['SG', 'DH000001'], ['HN', 'DH000001']]);
  const hn = result.orders.find(o => o.branch === 'HN');
  assert.equal(hn.sellableValue, 200 * 1000 + 70 * 5000, 'A: 200 x 1000 + B: 70 x 5000, khong gom VAT');
  assert.equal(hn.total, 1000000);
  assert.equal(hn.customerName, 'KH A');
  assert.equal(hn.saleName, 'Nguyễn Văn A');
  assert.equal(hn.orderDate, '30/09/2026 10:15');
  const sg = result.orders.find(o => o.branch === 'SG');
  assert.equal(sg.sellableValue, 100 * 1000, 'SG: ton 0 + van chuyen 160 >= 100 => co ban het');
  // Ton doc rieng theo tung co so (moi co so 1 truy van, chi cac ma co trong dong don).
  assert.deepEqual(
    pool.calls.onHand.map(p => [p[0], [...p[1]].sort()]).sort(),
    [['hanoi', ['A', 'B', 'VATDA44']], ['saigon', ['A']]]
  );
});

test('readPendingOrders: don khong co dong hang van xuat hien (gia tri co ban = 0)', async () => {
  const { repo } = repoFor(createFakePool({ orderRows: [OR({ product_code: '', quantity: 0, amount: 0 })] }));
  const result = await repo.readPendingOrders();
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].sellableValue, 0);
});

test('readPendingOrders: cache TTL 60s (khong doc DB lai), het han thi doc lai; single-flight khi goi dong thoi', async () => {
  const pool = createFakePool({ orderRows: [OR()], onHand: { hanoi: { A: 1 } } });
  const { repo, advance } = repoFor(pool);

  const [first, second] = await Promise.all([repo.readPendingOrders(), repo.readPendingOrders()]);
  assert.equal(pool.calls.orders, 1, 'single-flight: 2 loi goi dong thoi chi 1 lan doc DB');
  assert.equal(first, second);

  advance(30_000);
  await repo.readPendingOrders();
  assert.equal(pool.calls.orders, 1, 'con han cache');

  advance(31_000);
  await repo.readPendingOrders();
  assert.equal(pool.calls.orders, 2, 'het han TTL thi doc lai');

  repo.invalidate();
  await repo.readPendingOrders();
  assert.equal(pool.calls.orders, 3, 'invalidate buoc doc lai');
});

test('readPendingOrders: FAIL-SOFT — loi DB khong nem; co ban cu <= 10 phut thi tra ban cu danh dau stale', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const flaky = { fail: false };
    const pool = {
      ...createFakePool({ orderRows: [OR()], onHand: { hanoi: { A: 1 } } }),
      async query(sql, params) {
        if (flaky.fail) throw new Error('db down');
        return createFakePool({ orderRows: [OR()], onHand: { hanoi: { A: 1 } } }).query(sql, params);
      }
    };
    const { repo, advance } = repoFor(pool);
    const fresh = await repo.readPendingOrders();
    assert.equal(fresh.ok, true);

    flaky.fail = true;
    advance(120_000); // het TTL, con trong 10 phut
    const stale = await repo.readPendingOrders();
    assert.equal(stale.ok, true);
    assert.equal(stale.stale, true);
    assert.equal(stale.orders.length, 1);

    advance(600_000); // qua 10 phut
    const failed = await repo.readPendingOrders();
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.orders, []);
  } finally {
    console.warn = originalWarn;
  }
});

test('readPendingOrders: chua co cache ma DB loi -> {ok:false, orders:[]} khong nem', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { repo } = repoFor(createFakePool({ failOrders: true }));
    const result = await repo.readPendingOrders();
    assert.equal(result.ok, false);
    assert.deepEqual(result.orders, []);
  } finally {
    console.warn = originalWarn;
  }
});

test('truy van Phieu tam: loc statusValue NGUYEN VAN (trung index mot phan 0028), ngay doc bang AT TIME ZONE UTC, cat ID Telegram', () => {
  const sql = __test__.PENDING_ORDERS_SQL;
  assert.match(sql, /WHERE o\.raw->>'statusValue' = 'Phiếu tạm'/);
  assert.match(sql, /o\.order_date AT TIME ZONE 'UTC'/);
  assert.match(sql, /regexp_replace\(COALESCE\(NULLIF\(o\.raw->>'soldByName', ''\), s\.name, ''\)/);
  assert.doesNotMatch(sql, /\$\d/, 'khong tham so hoa — hang so de planner khop index mot phan');
});

test('anh xa co so Vong doi (HN/SG) <-> DB (hanoi/saigon)', () => {
  assert.deepEqual({ ...LIFECYCLE_TO_DB_BRANCH }, { HN: 'hanoi', SG: 'saigon' });
  assert.deepEqual({ ...DB_TO_LIFECYCLE_BRANCH }, { hanoi: 'HN', saigon: 'SG' });
});

// ---------------------------------------------------------------------------
// readOrderDetail
// ---------------------------------------------------------------------------

function detailFixture(status, lines) {
  return {
    kind: 'order', code: 'DH000001', date: '30/09/2026 10:15', customerName: 'KH A', customerCode: 'KH1', seller: 'Nguyễn Văn A',
    warehouse: 'Chi nhánh trung tâm', status, total: 855000, discount: 0, paid: 0, note: '', lines,
    lineCount: lines.length, totalQuantity: lines.reduce((s, l) => s + l.quantity, 0)
  };
}

const L = (productCode, quantity, price) => ({
  productCode, productName: 'Hang ' + productCode, quantity, price, discount: 0, amount: quantity * price, note: ''
});

test('readOrderDetail: don Phieu tam co ton thuc + dang van chuyen + so co ban tung dong, VAT khong co ton', async () => {
  const pool = createFakePool({ onHand: { hanoi: { A: 40, B: 800, VATDA44: 0 } } });
  const lines = [L('A', 500, 1000), L('B', 70, 5000), L('VATDA44', 1, 160000)];
  const calls = [];
  const { repo } = repoFor(pool, {
    fetchOrderDetail: async args => { calls.push(args); return detailFixture('Phiếu tạm', lines); }
  });
  const detail = await repo.readOrderDetail({ branch: 'HN', code: 'DH000001' });

  assert.equal(calls[0].branchCode, 'hanoi');
  assert.equal(calls[0].code, 'DH000001');
  assert.equal(detail.phieuTam, true);
  assert.equal(detail.branch, 'HN');
  const [a, b, vat] = detail.lines;
  assert.deepEqual([a.onHand, a.inTransit, a.sellableQty, a.sellableAmount], [40, 160, 200, 200000]);
  assert.deepEqual([b.onHand, b.inTransit, b.sellableQty, b.sellableAmount], [800, 0, 70, 350000]);
  assert.deepEqual([vat.isService, vat.onHand, vat.inTransit, vat.sellableQty, vat.sellableAmount], [true, null, null, null, null]);
  assert.equal(detail.sellableValue, 550000);
  assert.equal(detail.total, 855000, 'giu nguyen tong don cua Kiot (gom ca VAT)');
});

test('readOrderDetail: don KHONG con Phieu tam (vd Hoan thanh) thi cot ton/co ban la null, khong doc ton', async () => {
  const pool = createFakePool({ onHand: { hanoi: { A: 40 } } });
  const { repo } = repoFor(pool, { fetchOrderDetail: async () => detailFixture('Hoàn thành', [L('A', 5, 1000)]) });
  const detail = await repo.readOrderDetail({ branch: 'HN', code: 'DH000001' });
  assert.equal(detail.phieuTam, false);
  assert.equal(detail.sellableValue, null);
  assert.deepEqual([detail.lines[0].onHand, detail.lines[0].inTransit, detail.lines[0].sellableQty], [null, null, null]);
  assert.equal(pool.calls.onHand.length, 0);
});

test('readOrderDetail: co so khong hop le -> 400; khong tim thay don -> 404 kem ma ORDER_NOT_FOUND', async () => {
  const { repo } = repoFor(createFakePool(), {
    fetchOrderDetail: async () => { const e = new Error('Không tìm thấy đơn đặt hàng này.'); e.statusCode = 404; throw e; }
  });
  await assert.rejects(repo.readOrderDetail({ branch: 'XX', code: 'DH1' }), { statusCode: 400, code: 'INVALID_BRANCH' });
  await assert.rejects(repo.readOrderDetail({ branch: 'SG', code: 'DH1' }), { statusCode: 404, code: 'ORDER_NOT_FOUND' });
});

test('readOrderDetail: truyen dung co so SG -> saigon', async () => {
  const calls = [];
  const { repo } = repoFor(createFakePool({ onHand: { saigon: { A: 1 } } }), {
    fetchOrderDetail: async args => { calls.push(args); return detailFixture('Phiếu tạm', [L('A', 2, 10)]); }
  });
  const detail = await repo.readOrderDetail({ branch: 'SG', code: 'DH5' });
  assert.equal(calls[0].branchCode, 'saigon');
  // ton SG 1 + van chuyen 160 (cung 1 so cho moi co so) >= 2 => co ban het
  assert.equal(detail.lines[0].sellableQty, 2);
});
