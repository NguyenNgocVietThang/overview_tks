'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCustomerInvoiceLinesRepository, __sql__ } = require('./customerInvoiceLinesRepository');

function row(overrides = {}) {
  return {
    window_start: '2026-05-17', window_end: '2026-08-14', computed_at: new Date('2026-08-14T17:10:00Z'),
    branch: 'hanoi', customer_name: 'Khách A', item_code: 'SP-01', item_name: 'Sản phẩm một',
    quantity: '2', revenue: '200', date_key: '10/08/2026',
    ...overrides
  };
}

test('tra null khi bang chua tung duoc dung (khong co dong state)', async () => {
  const repository = createCustomerInvoiceLinesRepository({ pool: { query: async () => ({ rows: [] }) } });
  assert.equal(await repository.readCustomerInvoiceLines({ branchCodes: ['hanoi'], customerCode: 'KH-A' }), null);
});

test('truyen ma co so va ma khach thanh tham so, khong noi chuoi vao SQL', async () => {
  const calls = [];
  const repository = createCustomerInvoiceLinesRepository({
    pool: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [row()] }; } }
  });
  await repository.readCustomerInvoiceLines({ branchCodes: ['hanoi', 'saigon'], customerCode: "KH'; DROP TABLE x;--" });
  assert.equal(calls[0].sql, __sql__.READ_SQL);
  assert.deepEqual(calls[0].params, [['hanoi', 'saigon'], "KH'; DROP TABLE x;--"]);
});

test('khach khong co dong nao trong cua so: ket qua that su rong, khong phai "chua dung bang"', async () => {
  const repository = createCustomerInvoiceLinesRepository({
    pool: { query: async () => ({ rows: [row({ branch: null, customer_name: null, item_code: null, item_name: null, quantity: null, revenue: null, date_key: null })] }) }
  });
  const snapshot = await repository.readCustomerInvoiceLines({ branchCodes: ['hanoi', 'saigon'], customerCode: 'KH-A' });
  assert.deepEqual(snapshot.window, { start: '2026-05-17', end: '2026-08-14' });
  assert.deepEqual(snapshot.linesByBranch, { hanoi: [], saigon: [] });
});

test('gom dong theo co so, giu thu tu tu SQL va ten truong cho luong tinh bao cao', async () => {
  const repository = createCustomerInvoiceLinesRepository({
    pool: {
      query: async () => ({
        rows: [
          row({ item_code: 'SP-01', date_key: '12/08/2026' }),
          row({ item_code: 'SP-02', date_key: '10/08/2026', quantity: '1', revenue: '50' }),
          row({ branch: 'saigon', item_code: 'SP-09', customer_name: 'Khách A SG' })
        ]
      })
    }
  });
  const snapshot = await repository.readCustomerInvoiceLines({ branchCodes: ['hanoi', 'saigon'], customerCode: 'KH-A' });

  assert.deepEqual(snapshot.linesByBranch.hanoi.map(line => line.itemCode), ['SP-01', 'SP-02']);
  assert.deepEqual(snapshot.linesByBranch.saigon.map(line => line.itemCode), ['SP-09']);
  assert.deepEqual(snapshot.linesByBranch.hanoi[1], {
    dateKey: '10/08/2026', customerName: 'Khách A', itemCode: 'SP-02', itemName: 'Sản phẩm một', quantity: '1', revenue: '50'
  });
  assert.deepEqual(snapshot.computedAt, new Date('2026-08-14T17:10:00Z'));
});

test('cau SQL doc dong state cung luc voi dong hang de cua so luon khop du lieu', () => {
  assert.match(__sql__.READ_SQL, /FROM customer_invoice_lines_state s\s+LEFT JOIN customer_invoice_lines_90d l/);
  assert.match(__sql__.READ_SQL, /l\.branch = ANY\(\$1::text\[\]\) AND l\.customer_code = \$2/);
  assert.match(__sql__.READ_SQL, /ORDER BY l\.branch, l\.invoice_id DESC, l\.line_no/);
});

test('khach gop theo ten: truyen ma khach RIENG tung co so (unnest 2 mang song song), khong dung ma chung', async () => {
  const calls = [];
  const repository = createCustomerInvoiceLinesRepository({
    pool: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [row(), row({ branch: 'saigon', item_code: 'SP-09' })] }; } }
  });
  const snapshot = await repository.readCustomerInvoiceLines({
    branchCodes: ['hanoi', 'saigon'],
    customerCode: 'KH-1',
    customerCodesByBranch: { hanoi: 'KH-1', saigon: 'KH-9' }
  });
  assert.equal(calls[0].sql, __sql__.READ_BY_BRANCH_CODES_SQL);
  assert.deepEqual(calls[0].params, [['hanoi', 'saigon'], ['KH-1', 'KH-9']]);
  assert.match(__sql__.READ_BY_BRANCH_CODES_SQL, /\(l\.branch, l\.customer_code\) IN \(SELECT \* FROM unnest\(\$1::text\[\], \$2::text\[\]\)\)/);
  assert.deepEqual(snapshot.linesByBranch.saigon.map(line => line.itemCode), ['SP-09']);
});

test('chi co ma o mot co so: chi ghep co so do; khong co ma nao thi quay ve ma chung', async () => {
  const calls = [];
  const repository = createCustomerInvoiceLinesRepository({
    pool: { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [row()] }; } }
  });
  await repository.readCustomerInvoiceLines({ branchCodes: ['hanoi', 'saigon'], customerCode: 'KH-1', customerCodesByBranch: { saigon: 'KH-9' } });
  assert.deepEqual(calls[0].params, [['saigon'], ['KH-9']]);
  await repository.readCustomerInvoiceLines({ branchCodes: ['hanoi', 'saigon'], customerCode: 'KH-1', customerCodesByBranch: {} });
  assert.equal(calls[1].sql, __sql__.READ_SQL);
  assert.deepEqual(calls[1].params, [['hanoi', 'saigon'], 'KH-1']);
});
