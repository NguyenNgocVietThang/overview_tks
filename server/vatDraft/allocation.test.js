'use strict';

// Port tests/test_invoice_allocation.py (vat-draft-app): phan bo nguon cho "Xu ly hoa don".
// Ket qua (nguon, SL) phai giong het app Python.

const test = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('./vatDraftConfig');
const {
  allocateInvoiceSources,
  buildUnifiedColumns,
  buildUnifiedDisplayRows,
  GIA_NHAP_COLUMN,
  formatQty
} = require('./allocation');

const config = { ...baseConfig, sourceTiebreakPriority: ['Vận chuyển', 'MAY', 'CAO'] };

function stock(rowIndex, nguon, maVat, tenKt, dvt, ton, { tenVat = 'TEN VAT MAU', giaBan = 10000, thueVat = 0.08 } = {}) {
  return {
    rowIndex, nguon, maKiotDaiDien: '', tenKiotDaiDien: '', maVatKiot: maVat, tenVatKiot: tenVat,
    tenKeToan: tenKt, donViTinh: dvt, tonDauNgay: ton, giaBan, thueVat, thueNk: null, tongThueMat: null,
    tongDangNhap: 0, tonCoTheNhap: ton,
    maVatKiotNorm: maVat.trim().toLowerCase(), tenKeToanNorm: tenKt.trim().toLowerCase(), donViTinhNorm: dvt.trim().toLowerCase()
  };
}

function mapping(rowIndex, maSp, tenSp, maVat, tenTruocVat = '') {
  return { rowIndex, maSp, tenSp, maVatKiot: maVat, tenTruocVat, maSpNorm: maSp.trim().toLowerCase(), maVatKiotNorm: maVat.trim().toLowerCase() };
}

function query(orderIndex, fields) {
  return { orderIndex, maSp: '', tenSp: '', sl: '', giaBan: '', ghiChuHangHoa: '', maHoaDon: '', thanhTien: '', ...fields };
}

const mappings = () => [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01', 'Tên VAT 1')];
const run = (queries, mappingRows, stockRows) => allocateInvoiceSources(queries, mappingRows, stockRows, config);
const plan = result => result.lines.map(line => [line.nguon, line.slPhanBo]);

test('1. mot nguon duy nhat va du ton', () => {
  const result = run([query(1, { maSp: 'SP01', sl: 100, giaBan: 11500 })], mappings(), [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 500)]);
  assert.equal(result.issues.length + result.shortages.length, 0);
  assert.deepEqual(plan(result), [['MAY', 100]]);
  assert.equal(result.lines[0].slYeuCau, 100);
  assert.equal(result.lines[0].tonConNhap, 500);
});

test('2. nhieu nguon deu du -> chon nguon xuat hien nhieu nhat', () => {
  const rows = [...mappings(), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02'), mapping(4, 'SP03', 'Sản phẩm 3', 'VAT03')];
  const stocks = [
    stock(2, 'Vận chuyển', 'VAT01', 'KT1', 'Cái', 200),
    stock(3, 'MAY', 'VAT01', 'KT2', 'Cái', 150),
    stock(4, 'CAO', 'VAT01', 'KT3', 'Cái', 120),
    stock(5, 'Vận chuyển', 'VAT02', 'KT4', 'Cái', 10),
    stock(6, 'Vận chuyển', 'VAT03', 'KT5', 'Cái', 10)
  ];
  const result = run([query(1, { maSp: 'SP01', sl: 100 }), query(2, { maSp: 'SP02', sl: 5 }), query(3, { maSp: 'SP03', sl: 5 })], rows, stocks);
  assert.equal(result.shortages.length, 0);
  assert.deepEqual(plan(result)[0], ['Vận chuyển', 100]);
});

test('2b. nguon xuat hien nhieu nhat thang uu tien cau hinh', () => {
  const rows = [...mappings(), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02')];
  const stocks = [
    stock(2, 'Vận chuyển', 'VAT01', 'KT1', 'Cái', 200),
    stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 200),
    stock(4, 'CAO', 'VAT02', 'KT3', 'Cái', 200)
  ];
  const result = run([query(1, { maSp: 'SP01', sl: 100 }), query(2, { maSp: 'SP02', sl: 1 })], rows, stocks);
  assert.deepEqual(plan(result)[0], ['CAO', 100]);
});

test('3. khong nguon nao du -> gop hai nguon, bat dau tu nguon xuat hien nhieu nhat', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 150), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 100)];
  const result = run([query(1, { maSp: 'SP01', sl: 200 })], mappings(), stocks);
  assert.equal(result.shortages.length, 0);
  assert.deepEqual(plan(result), [['MAY', 150], ['CAO', 50]]);
});

test('3b. mot nguon tu du thang nguon xuat hien nhieu hon nhung nho hon', () => {
  const rows = [...mappings(), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02')];
  const stocks = [
    stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 100),
    stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 300),
    stock(4, 'MAY', 'VAT02', 'KT3', 'Cái', 10)
  ];
  const result = run([query(1, { maSp: 'SP01', sl: 200 }), query(2, { maSp: 'SP02', sl: 1 })], rows, stocks);
  assert.deepEqual(plan(result).slice(0, 2), [['CAO', 200], ['MAY', 1]]);
});

test('4. gop tu ba nguon theo ton giam dan', () => {
  const rows = [...mappings(), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02')];
  const stocks = [
    stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 50),
    stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 120),
    stock(4, 'Vận chuyển', 'VAT01', 'KT3', 'Cái', 80),
    stock(5, 'MAY', 'VAT02', 'KT4', 'Cái', 1)
  ];
  const result = run([query(1, { maSp: 'SP01', sl: 220 }), query(2, { maSp: 'SP02', sl: 1 })], rows, stocks);
  assert.deepEqual(plan(result).slice(0, 3), [['MAY', 50], ['CAO', 120], ['Vận chuyển', 50]]);
  assert.equal(result.lines.filter(l => l.maSp === 'SP01').reduce((s, l) => s + l.slPhanBo, 0), 220);
});

test('4b. nhieu dong ton trong mot nguon duoc chia', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 60), stock(3, 'MAY', 'VAT01', 'KT2', 'Cái', 90)];
  const result = run([query(1, { maSp: 'SP01', sl: 120 })], mappings(), stocks);
  assert.equal(result.shortages.length, 0);
  assert.deepEqual(result.lines.map(l => [l.tenKeToan, l.slPhanBo]), [['KT2', 90], ['KT1', 30]]);
});

test('5. tong ton vua dung SL', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 70), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 30)];
  const result = run([query(1, { maSp: 'SP01', sl: 100 })], mappings(), stocks);
  assert.equal(result.shortages.length, 0);
  assert.deepEqual(plan(result), [['MAY', 70], ['CAO', 30]]);
});

test('6. tong ton nho hon SL -> thieu ton, moi nguon 1 dong dai dien', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 100), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 70)];
  const result = run([query(1, { maSp: 'SP01', sl: 200 })], mappings(), stocks);
  assert.equal(result.lines.length, 0);
  assert.equal(result.shortages.length, 2);
  assert.equal(result.shortageProductCount, 1);
  const [first] = result.shortages;
  assert.deepEqual([first.slYeuCau, first.tongTon, first.thieu], [200, 170, 30]);
  assert.equal(first.ghiChu, 'Không đủ số lượng tồn');
  assert.deepEqual(result.shortages.map(r => [r.nguon, r.tonConNhap]), [['MAY', 100], ['CAO', 70]]);
  assert.ok(result.shortages.every(r => r.tongTon === 170 && r.thieu === 30));
  assert.equal(buildUnifiedDisplayRows([], result.shortages, []).length, 2);
});

test('6b. dong dai dien thieu ton dung tong ton lon nhat cua mot nguon', () => {
  const stocks = [
    stock(2, 'MAY', 'VAT01', 'KT1', 'Unit', 60),
    stock(3, 'MAY', 'VAT01', 'KT2', 'Unit', 50),
    stock(4, 'CAO', 'VAT01', 'KT3', 'Unit', 100)
  ];
  const result = run([query(1, { maSp: 'SP01', sl: 250 })], mappings(), stocks);
  assert.deepEqual([result.shortages[0].tongTon, result.shortages[0].thieu], [210, 40]);
  assert.deepEqual(result.shortages.map(r => [r.nguon, r.tonConNhap]), [['MAY', 110], ['CAO', 100]]);
  assert.equal(result.shortages[1].tenKeToan, 'KT3');
  assert.ok(['KT1', 'KT2'].includes(result.shortages[0].tenKeToan));
});

test('6c. ton bang nhau -> dung thu tu uu tien hien co', () => {
  const stocks = [stock(2, 'CAO', 'VAT01', 'KT1', 'Unit', 60), stock(3, 'MAY', 'VAT01', 'KT2', 'Unit', 60)];
  const result = run([query(1, { maSp: 'SP01', sl: 150 })], mappings(), stocks);
  assert.deepEqual(result.shortages.map(r => [r.nguon, r.tonConNhap, r.tenKeToan]), [['MAY', 60, 'KT2'], ['CAO', 60, 'KT1']]);
});

test('6d. moi nguon ton 0 -> mot dong dai dien theo uu tien', () => {
  const stocks = [stock(2, 'CAO', 'VAT01', 'KT1', 'Unit', 0), stock(3, 'MAY', 'VAT01', 'KT2', 'Unit', 0)];
  const result = run([query(1, { maSp: 'SP01', sl: 10 })], mappings(), stocks);
  const [shortage] = result.shortages;
  assert.deepEqual([shortage.tongTon, shortage.thieu, shortage.nguon, shortage.tonConNhap, shortage.tenKeToan], [0, 10, 'MAY', 0, 'KT2']);
  assert.equal(result.skippedNonPositiveStockCount, 2);
});

test('7. ma hang khong ton tai -> issue', () => {
  const result = run([query(1, { maSp: 'KHONGCO', sl: 10 })], mappings(), []);
  assert.equal(result.lines.length + result.shortages.length, 0);
  assert.equal(result.issues[0].issueType, 'khong_tim_thay_ma');
  assert.equal(result.issues[0].detail, "Không tìm thấy Mã SP 'KHONGCO'.");
});

test('7b. ma thieu o Khop ma -> lay ma dai dien cua Gop VAT', () => {
  const s = stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 100);
  s.maKiotDaiDien = 'SP-GOP';
  s.tenKiotDaiDien = 'Sản phẩm chỉ có trong Gộp VAT';
  const result = run([query(1, { maSp: ' sp-gop ', sl: 25 })], [], [s]);
  assert.equal(result.issues.length + result.shortages.length, 0);
  assert.deepEqual(plan(result), [['MAY', 25]]);
  assert.equal(result.lines[0].maSp, 'SP-GOP');
  assert.equal(result.lines[0].maVat, 'VAT01');
});

test('7c. mapping Khop ma thang fallback Gop VAT', () => {
  const stocks = [stock(2, 'MAY', 'VAT-GOP', 'KT Gộp', 'Cái', 100), stock(3, 'CAO', 'VAT-KHOP', 'KT Khớp', 'Cái', 100)];
  stocks[0].maKiotDaiDien = 'SP01';
  stocks[0].tenKiotDaiDien = 'Tên từ Gộp VAT';
  const result = run([query(1, { maSp: 'SP01', sl: 25 })], [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT-KHOP')], stocks);
  assert.deepEqual(plan(result), [['CAO', 25]]);
  assert.equal(result.lines[0].maVat, 'VAT-KHOP');
});

test('8. SL rong / 0 / am / khong phai so -> bao loi, khong phan bo', () => {
  const result = run(
    [
      query(1, { maSp: 'SP01', sl: '' }),
      query(2, { maSp: 'SP01', sl: 0 }),
      query(3, { maSp: 'SP01', sl: -5 }),
      query(4, { maSp: 'SP01', sl: 'abc' }),
      query(5, { maSp: 'SP01', sl: null })
    ],
    mappings(),
    [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 100)]
  );
  assert.equal(result.lines.length + result.shortages.length, 0);
  assert.deepEqual(result.issues.map(i => i.issueType), ['sl_trong', 'sl_khong_duong', 'sl_khong_duong', 'sl_khong_phai_so', 'sl_trong']);
  assert.equal(result.issues[2].detail, 'SL=-5 phải lớn hơn 0.');
  assert.equal(result.issues[3].detail, "SL='abc' không phải số.");
});

test('8b. dau vao rong an toan', () => {
  const result = allocateInvoiceSources([], [], [], config);
  assert.equal(result.lines.length + result.issues.length + result.shortages.length, 0);
});

test('9. dong ton 0 / am bi bo qua khi phan bo', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 0), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', -3), stock(4, 'Vận chuyển', 'VAT01', 'KT3', 'Cái', 80)];
  const result = run([query(1, { maSp: 'SP01', sl: 80 })], mappings(), stocks);
  assert.deepEqual(plan(result), [['Vận chuyển', 80]]);
  assert.equal(result.skippedNonPositiveStockCount, 2);
});

test('9b. san pham chi co ton 0 -> nhan dien duoc roi bao thieu ton', () => {
  const result = run([query(1, { maSp: 'SP01', sl: 10 })], mappings(), [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 0)]);
  assert.equal(result.lines.length + result.issues.length, 0);
  assert.equal(result.shortages.length, 1);
  assert.deepEqual([result.shortages[0].maSp, result.shortages[0].tongTon, result.shortages[0].thieu], ['SP01', 0, 10]);
});

test('9c. ton khong duong khong lam lech tan suat nguon', () => {
  const rows = [...mappings(), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02')];
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 100), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 100), stock(4, 'CAO', 'VAT02', 'KT3', 'Cái', 0)];
  const result = run([query(1, { maSp: 'SP01', sl: 50 }), query(2, { maSp: 'SP02', sl: 1 })], rows, stocks);
  assert.deepEqual(plan(result), [['MAY', 50]]);
  assert.deepEqual(result.shortages.map(s => s.maSp), ['SP02']);
});

test('10. hop le va khong hop le tach rieng, giu thu tu nhap', () => {
  const rows = [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01'), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02'), mapping(4, 'SP03', 'Sản phẩm 3', 'VAT03')];
  const stocks = [
    stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 100),
    stock(3, 'CAO', 'VAT02', 'KT2', 'Cái', 10),
    stock(4, 'MAY', 'VAT03', 'KT3', 'Cái', 40),
    stock(5, 'CAO', 'VAT03', 'KT4', 'Cái', 40)
  ];
  const result = run([query(1, { maSp: 'SP01', sl: 60 }), query(2, { maSp: 'SP02', sl: 50 }), query(3, { maSp: 'SP03', sl: 70 })], rows, stocks);
  assert.deepEqual(result.lines.map(l => l.maSp), ['SP01', 'SP03', 'SP03']);
  assert.deepEqual(result.lines.map(l => l.queryOrder), [1, 3, 3]);
  assert.deepEqual(result.shortages.map(s => s.maSp), ['SP02']);
  assert.deepEqual(plan(result), [['MAY', 60], ['MAY', 40], ['CAO', 30]]);
});

test('bat bien: khong vuot SL yeu cau hay ton', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 33), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 44), stock(4, 'Vận chuyển', 'VAT01', 'KT3', 'Cái', 55)];
  const result = run([query(1, { maSp: 'SP01', sl: 100 })], mappings(), stocks);
  assert.equal(result.lines.reduce((s, l) => s + l.slPhanBo, 0), 100);
  assert.ok(result.lines.every(l => l.slPhanBo > 0 && l.slPhanBo <= l.tonConNhap));
});

test('cot hien thi: GIA NHAP = round(Gia ban/(1+%VAT), 2), so dang chu duoc doc', () => {
  const result = run([query(1, { maSp: 'SP01', sl: '100', giaBan: '11,500' })], mappings(), [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 150, { thueVat: 0.08 })]);
  const [row] = buildUnifiedDisplayRows(result.lines, result.shortages, result.issues);
  assert.equal(row.SL, 100);
  assert.equal(row['Giá bán'], 11500);
  assert.equal(row[GIA_NHAP_COLUMN], 10648.15);
  assert.equal(row['%VAT'], 8);
  assert.equal(row['TÊN VAT'], 'Tên VAT 1');
});

test('buildUnifiedColumns: dan tay giu bo cot cu; chung tu them Ma hoa don, Ghi chu tong (canh Ghi chu hang hoa), Thanh tien', () => {
  assert.deepEqual(buildUnifiedColumns(false), [
    'Trạng thái', 'MÃ SP', 'TÊN SP', 'Mã VAT', 'TÊN VAT', 'Ghi chú hàng hóa', 'NGUỒN', 'TỒN CÒN NHÁP',
    'Giá bán', 'TÊN KẾ TOÁN', 'ĐVT', 'SL', GIA_NHAP_COLUMN, '%VAT'
  ]);
  assert.deepEqual(buildUnifiedColumns(true), [
    'Trạng thái', 'MÃ SP', 'TÊN SP', 'Mã VAT', 'TÊN VAT', 'Mã hóa đơn', 'Ghi chú hàng hóa', 'Ghi chú tổng',
    'NGUỒN', 'TỒN CÒN NHÁP', 'Giá bán', 'TÊN KẾ TOÁN', 'ĐVT', 'SL', GIA_NHAP_COLUMN, '%VAT', 'Thành tiền'
  ]);
  assert.ok(!buildUnifiedColumns(true).includes('Ghi chú'), 'ly do loi khong phai cot (chi hien khi re chuot)');
});

test('bang gop: dong cung Ma hoa don nam canh nhau, Ghi chu tong gan theo dong nhap', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 150), stock(3, 'MAY', 'VAT03', 'KT3', 'Cái', 5)];
  const rows = [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01'), mapping(4, 'SP03', 'Sản phẩm 3', 'VAT03')];
  const queries = [
    query(1, { maSp: 'SP01', sl: 50, maHoaDon: 'HD1' }),
    query(2, { maSp: 'SP02', sl: 5, maHoaDon: 'HD2' }),
    query(3, { maSp: 'SP03', sl: 50, maHoaDon: 'HD1' })
  ];
  const result = run(queries, rows, stocks);
  const extraByOrder = new Map([[1, { 'Ghi chú tổng': 'giao sáng' }], [2, { 'Ghi chú tổng': '' }], [3, { 'Ghi chú tổng': 'giao sáng' }]]);
  const display = buildUnifiedDisplayRows(result.lines, result.shortages, result.issues, { extraByOrder });
  assert.deepEqual(display.map(r => r['Mã hóa đơn']), ['HD1', 'HD1', 'HD2']);
  assert.deepEqual(display.map(r => r['MÃ SP']), ['SP01', 'SP03', 'SP02']);
  assert.deepEqual(display.map(r => r['Trạng thái']), ['OK', 'Thiếu tồn', 'Không có mã']);
  assert.deepEqual(display.map(r => r['Ghi chú tổng']), ['giao sáng', 'giao sáng', '']);
  assert.equal(display[1]['Ghi chú'], '');
  assert.match(display[2]['Ghi chú'], /Không tìm thấy/);
});

test('luong dan tay day du (tuong duong test trang Streamlit)', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 150), stock(3, 'CAO', 'VAT01', 'KT2', 'Cái', 100), stock(4, 'MAY', 'VAT02', 'KT3', 'Cái', 5)];
  const rows = [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01'), mapping(3, 'SP02', 'Sản phẩm 2', 'VAT02')];
  const result = run([
    query(1, { maSp: 'SP01', tenSp: 'Sản phẩm 1', sl: '200', giaBan: '10000' }),
    query(2, { maSp: 'SP02', tenSp: 'Sản phẩm 2', sl: '50', giaBan: '9000' }),
    query(3, { maSp: 'KHONGCO', tenSp: 'Sản phẩm không có', sl: '10', giaBan: '8000' })
  ], rows, stocks);
  assert.deepEqual(plan(result), [['MAY', 150], ['CAO', 50]]);
  assert.deepEqual(result.shortages.map(s => s.maSp), ['SP02']);
  assert.deepEqual(result.issues.map(i => i.maSp), ['KHONGCO']);
  const statuses = new Set(buildUnifiedDisplayRows(result.lines, result.shortages, result.issues).map(r => r['Trạng thái']));
  assert.deepEqual([...statuses].sort(), ['Không có mã', 'OK', 'Thiếu tồn']);
});

test('nguon ten dang so ("123") van giu dung thu tu chen (Map, khong phai object)', () => {
  const stocks = [stock(2, 'ZZZ', 'VAT01', 'KT1', 'Cái', 60), stock(3, '123', 'VAT01', 'KT2', 'Cái', 60)];
  const result = run([query(1, { maSp: 'SP01', sl: 150 })], mappings(), stocks);
  // Ton bang nhau -> sap theo ten da casefold: '123' < 'zzz'.
  assert.deepEqual(result.shortages.map(s => s.nguon), ['123', 'ZZZ']);
});

test('formatQty giong _format_qty', () => {
  assert.equal(formatQty(1234), '1,234');
  assert.equal(formatQty(-5), '-5');
  assert.equal(formatQty(1234.5), '1,234.50');
  assert.equal(formatQty(0.125), '0.12');
});
