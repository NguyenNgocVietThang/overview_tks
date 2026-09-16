'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const { createDashboardPgReader, SHEET_NAMES, __headers__ } = require('./dashboardPgReader');

// pool gia: ghi lai TOAN BO cac lan goi query (theo dung thu tu TABS.map goi
// dong bo tung phan tu — xem readDashboardSheets) va tra ve dong tuy chinh
// theo tung tab qua `rowsBySheetName` (khop bang cach tim "-- tab: <ten>"
// trong dau chuoi SQL — moi cau SQL trong dashboardPgReader.js deu co comment
// nay, xem TABS).
function fakePool(rowsBySheetName = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const match = SHEET_NAMES.find(name => sql.includes(`-- tab: ${name}`));
      return { rows: rowsBySheetName[match] || [] };
    }
  };
}

test('readDashboardSheets tra dung 9 sheet, dung header (ten + thu tu) nhu Sheets that', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');

  assert.deepEqual(Object.keys(sheets).sort(), SHEET_NAMES.slice().sort());
  SHEET_NAMES.forEach(name => {
    assert.deepEqual(sheets[name][0], __headers__[name], `header cua "${name}" phai dung ten + thu tu`);
  });
});

test('readDashboardSheets truyen dung branch code Postgres (hanoi/saigon) cho ca 9 truy van', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });

  await reader.readDashboardSheets('Hà Nội');
  assert.equal(pool.calls.length, SHEET_NAMES.length);
  pool.calls.forEach(call => assert.deepEqual(call.params, ['hanoi']));

  pool.calls.length = 0;
  await reader.readDashboardSheets('Sài Gòn');
  assert.equal(pool.calls.length, SHEET_NAMES.length);
  pool.calls.forEach(call => assert.deepEqual(call.params, ['saigon']));
});

test('readDashboardSheets tu choi branch khong hop le, khong query Postgres', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  await assert.rejects(
    () => reader.readDashboardSheets('Không tồn tại'),
    err => err.statusCode === 400 && err.code === 'INVALID_BRANCH'
  );
  assert.equal(pool.calls.length, 0);
});

test('readDashboardSheets: Hang hoa map dung gia tri theo TEN COT (khong theo vi tri object tra ve)', async () => {
  const pool = fakePool({
    [CONFIG.SHEET_PRODUCTS]: [{
      ma_hang: 'SP-01', ten_hang: 'Sản phẩm một', nhom_hang: 'Đồ gỗ', loai_hang: 'Hàng hóa',
      gia_von: '', gia_ban: 150000, ton_kho: '', khach_dat: '', trang_thai: 'Đang kinh doanh',
      ngay_sua_cuoi: '10/08/2026 10:00', ma_nhom_hang: '5', vi_tri: '', id_hang_hoa: '99',
      id_gian_hang: '1', duoc_phep_ban: 'Có', ten_goc: 'Sản phẩm một', mo_ta: '',
      gia_tri_quy_doi: 1, co_thuoc_tinh: 'Không', dang_hoat_dong: 'Có',
      ngay_tao: '01/01/2026 08:00', ngay_cap_nhat: '10/08/2026 10:00', ma_loai_hang: '2'
    }]
  });
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');
  const header = sheets[CONFIG.SHEET_PRODUCTS][0];
  const row = sheets[CONFIG.SHEET_PRODUCTS][1];

  assert.equal(row[header.indexOf('Mã hàng')], 'SP-01');
  assert.equal(row[header.indexOf('Tên hàng')], 'Sản phẩm một');
  assert.equal(row[header.indexOf('Giá bán')], 150000);
  assert.equal(row[header.indexOf('Trạng thái')], 'Đang kinh doanh');
  assert.equal(row.length, header.length, 'moi dong phai co du so cot nhu header');
});

test('readDashboardSheets: Nhap hang (dang flatten) giu du moi dong mat hang tra ve tu query, khong gop/mat dong', async () => {
  // "Nhap hang" la 1 truy van LEFT JOIN purchases -> purchase_details, moi
  // dong ket qua = 1 mat hang cua 1 phieu nhap (giong buildPurchaseSheetRow_
  // cu). O day chi kiem tra tang doc (readDashboardSheets) khong lam mat/gop
  // dong nao Postgres tra ve — dung SQL JOIN duoc doi chieu rieng qua smoke
  // test tren du lieu that (xem bao cao cuoi).
  const pool = fakePool({
    [CONFIG.SHEET_PURCHASES]: [
      { chi_nhanh: 'CN1', ma_nhap_hang: 'PN-01', thoi_gian: '', thoi_gian_tao: '', ma_nha_cung_cap: 'NCC-01', ten_nha_cung_cap: 'A', nguoi_nhap: '', nguoi_tao: '', tong_tien_hang: 100, giam_gia_phieu_nhap: 0, can_tra_ncc: 100, tien_da_tra_ncc: 0, ghi_chu: '', tong_so_luong: 3, tong_so_mat_hang: 2, trang_thai: '', ma_hang: 'SP-01', ten_hang: 'A', don_gia: 10, giam_gia_pct: 0, giam_gia: 0, gia_nhap: 10, thanh_tien: 10, so_luong: 1 },
      { chi_nhanh: 'CN1', ma_nhap_hang: 'PN-01', thoi_gian: '', thoi_gian_tao: '', ma_nha_cung_cap: 'NCC-01', ten_nha_cung_cap: 'A', nguoi_nhap: '', nguoi_tao: '', tong_tien_hang: 100, giam_gia_phieu_nhap: 0, can_tra_ncc: 100, tien_da_tra_ncc: 0, ghi_chu: '', tong_so_luong: 3, tong_so_mat_hang: 2, trang_thai: '', ma_hang: 'SP-02', ten_hang: 'B', don_gia: 45, giam_gia_pct: 0, giam_gia: 0, gia_nhap: 45, thanh_tien: 90, so_luong: 2 }
    ]
  });
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');
  const rows = sheets[CONFIG.SHEET_PURCHASES].slice(1);
  const header = sheets[CONFIG.SHEET_PURCHASES][0];

  assert.equal(rows.length, 2, 'ca 2 dong mat hang cua cung 1 phieu nhap phai duoc giu nguyen, khong gop lai');
  assert.deepEqual(rows.map(r => r[header.indexOf('Mã hàng')]), ['SP-01', 'SP-02']);
  assert.deepEqual(rows.map(r => r[header.indexOf('Mã nhập hàng')]), ['PN-01', 'PN-01']);
});

test('readDashboardSheets: sheet khong co du lieu tra ve mang rong (chi con header)', async () => {
  const pool = fakePool({ [CONFIG.SHEET_INVOICES]: [] });
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');
  assert.deepEqual(sheets[CONFIG.SHEET_INVOICES], [__headers__[CONFIG.SHEET_INVOICES]]);
});

test('SHEET_NAMES khop dung 9 tab KiotViet, KHONG bao gom Bao cao ban hang (SHEET_CUSTOMER_REPORT) — co chu dich kich hoat fallback trong dashboardData.js', () => {
  assert.equal(SHEET_NAMES.length, 9);
  assert.ok(!SHEET_NAMES.includes(CONFIG.SHEET_CUSTOMER_REPORT));
  assert.deepEqual(SHEET_NAMES, [
    CONFIG.SHEET_CATEGORIES, CONFIG.SHEET_PRODUCTS, CONFIG.SHEET_INVOICES,
    CONFIG.SHEET_INVOICE_DETAILS, CONFIG.SHEET_ORDERS, CONFIG.SHEET_RETURNS,
    CONFIG.SHEET_CUSTOMERS, CONFIG.SHEET_SUPPLIERS, CONFIG.SHEET_PURCHASES
  ]);
});
