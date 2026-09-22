'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const {
  parseSupplierReturnWorkbook,
  replaceSupplierReturnImport,
  getSupplierReturnImportStatus,
  parseCellDateKey
} = require('./supplierReturnImportService');

const HEADER = ['Chi nhánh', 'Mã trả hàng nhập', 'Thời gian', 'Mã hàng', 'Tên hàng', 'Trạng thái', 'Số lượng'];

function buildWorkbookBuffer(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('parseCellDateKey doc dung serial number Excel va chuoi dd/MM/yyyy, khong qua Date/timezone', () => {
  // Serial 46287.40712... tuong ung 22/09/2026 09:46:16 (gio treo tuong,
  // giong file KiotViet that) — phai ra dung ngay 2026-09-22 khong lech mui gio.
  assert.equal(parseCellDateKey(46287.407132291664), '2026-09-22');
  assert.equal(parseCellDateKey('22/09/2026 09:46:16'), '2026-09-22');
  assert.equal(parseCellDateKey('2026-09-22T09:46:16'), '2026-09-22');
  assert.equal(parseCellDateKey(''), null);
  assert.equal(parseCellDateKey('không phải ngày'), null);
});

test('parseSupplierReturnWorkbook doc dung 4 truong tu file that (round-trip qua xlsx that, khong chi doc code)', () => {
  const buffer = buildWorkbookBuffer([
    HEADER,
    ['Chi nhánh trung tâm', 'THN000845', new Date(Date.UTC(2026, 8, 22, 2, 46, 16)), 'MXT2L', 'Máy xay thịt', 'Đã trả hàng', 1440],
    ['Chi nhánh trung tâm', 'THN000844', new Date(Date.UTC(2026, 5, 1, 2, 30, 56)), 'OD4AM7', 'Chân kê máy giặt', 'Đã trả hàng', 3180]
  ]);

  const { rows, skipped, totalDataRows } = parseSupplierReturnWorkbook(buffer);

  assert.equal(totalDataRows, 2);
  assert.deepEqual(skipped, []);
  assert.deepEqual(rows, [
    { code: 'MXT2L', name: 'Máy xay thịt', dateKey: '2026-09-22', quantity: 1440 },
    { code: 'OD4AM7', name: 'Chân kê máy giặt', dateKey: '2026-06-01', quantity: 3180 }
  ]);
});

test('so luong dang chuoi co dau phay nhom van doc dung nho parseNullableNumber', () => {
  const buffer = buildWorkbookBuffer([
    HEADER,
    ['CN', 'THN001', '01/06/2026', 'SP001', 'Hàng A', 'Đã trả hàng', '1,234']
  ]);

  const { rows } = parseSupplierReturnWorkbook(buffer);

  assert.equal(rows[0].quantity, 1234);
});

test('bo qua dong thieu Ma hang, khong parse duoc Thoi gian, hoac khong parse duoc So luong — khong am tham quy ve 0', () => {
  const buffer = buildWorkbookBuffer([
    HEADER,
    ['CN', 'THN001', '01/06/2026', '', 'Thiếu mã hàng', 'Đã trả hàng', 5],
    ['CN', 'THN002', 'không phải ngày', 'SP002', 'Ngày lỗi', 'Đã trả hàng', 5],
    ['CN', 'THN003', '01/06/2026', 'SP003', 'Số lượng lỗi', 'Đã trả hàng', 'abc']
  ]);

  const { rows, skipped, totalDataRows } = parseSupplierReturnWorkbook(buffer);

  assert.equal(totalDataRows, 3);
  assert.equal(rows.length, 0);
  assert.deepEqual(skipped.map((s) => s.reason), ['Thiếu Mã hàng', 'Không đọc được Thời gian', 'Không đọc được Số lượng']);
});

test('dong Trang thai chua hoan tat bi bo qua khi co cot Trang thai', () => {
  const buffer = buildWorkbookBuffer([
    HEADER,
    ['CN', 'THN001', '01/06/2026', 'SP001', 'Hàng A', 'Đang xử lý', 5],
    ['CN', 'THN002', '01/06/2026', 'SP002', 'Hàng B', 'Đã trả hàng', 5]
  ]);

  const { rows, skipped } = parseSupplierReturnWorkbook(buffer);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'SP002');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, 'Trạng thái chưa hoàn tất');
});

test('thieu cot Trang thai van chay binh thuong, coi moi dong la hoan tat', () => {
  const buffer = buildWorkbookBuffer([
    ['Thời gian', 'Mã hàng', 'Số lượng'],
    ['01/06/2026', 'SP001', 5]
  ]);

  const { rows } = parseSupplierReturnWorkbook(buffer);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '');
});

test('thieu cot bat buoc thi bao loi ro rang, khong parse mo ho', () => {
  const buffer = buildWorkbookBuffer([
    ['Mã hàng', 'Số lượng'],
    ['SP001', 5]
  ]);

  assert.throws(
    () => parseSupplierReturnWorkbook(buffer),
    (err) => err.code === 'SUPPLIER_RETURN_IMPORT_MISSING_COLUMNS' && /Thời gian/.test(err.message)
  );
});

function makeFakePool(queryImpl) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : { rows: [] };
    },
    release() {}
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('replaceSupplierReturnImport chay trong 1 transaction: xoa cu roi UNNEST chen moi', async () => {
  const { calls, pool } = makeFakePool();
  const rows = [
    { code: 'SP001', name: 'Hàng A', dateKey: '2026-06-01', quantity: 5 },
    { code: 'SP002', name: 'Hàng B', dateKey: '2026-06-02', quantity: 10 }
  ];

  await replaceSupplierReturnImport({ pool, branch: 'hanoi', rows, sourceFile: 'file.xlsx', importedBy: 'thangnnv' });

  const sqls = calls.map((c) => c.sql.trim().split('\n')[0]);
  assert.deepEqual(sqls, ['BEGIN', 'DELETE FROM supplier_return_imports WHERE branch = $1', 'INSERT INTO supplier_return_imports', 'COMMIT']);
  assert.deepEqual(calls[1].params, ['hanoi']);
  assert.deepEqual(calls[2].params, [
    'hanoi',
    ['SP001', 'SP002'],
    ['Hàng A', 'Hàng B'],
    ['2026-06-01', '2026-06-02'],
    [5, 10],
    'thangnnv',
    'file.xlsx'
  ]);
});

test('replaceSupplierReturnImport rollback neu insert loi', async () => {
  const { calls, pool } = makeFakePool((sql) => {
    if (sql.trim().startsWith('INSERT')) throw new Error('constraint violation');
    return { rows: [] };
  });

  await assert.rejects(
    replaceSupplierReturnImport({ pool, branch: 'hanoi', rows: [{ code: 'SP001', name: '', dateKey: '2026-06-01', quantity: 1 }] }),
    /constraint violation/
  );
  assert.ok(calls.some((c) => c.sql.trim() === 'ROLLBACK'));
});

test('getSupplierReturnImportStatus tra ve trang thai import hien tai', async () => {
  const pool = {
    async query(sql, params) {
      assert.deepEqual(params, ['hanoi']);
      return {
        rows: [{
          row_count: 8718,
          earliest_date: '2026-06-01',
          latest_date: '2026-09-22',
          imported_at: new Date('2026-09-22T10:01:32Z'),
          imported_by: 'thangnnv',
          source_file: 'DanhSachChiTietTraHangNhap.xlsx'
        }]
      };
    }
  };

  const status = await getSupplierReturnImportStatus({ pool, branch: 'hanoi' });

  assert.deepEqual(status, {
    branch: 'hanoi',
    rowCount: 8718,
    earliestDate: '2026-06-01',
    latestDate: '2026-09-22',
    importedAt: new Date('2026-09-22T10:01:32Z'),
    importedBy: 'thangnnv',
    sourceFile: 'DanhSachChiTietTraHangNhap.xlsx'
  });
});
