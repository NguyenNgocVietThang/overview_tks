'use strict';

// Port cac test lookup_all_sources / build_all_sources_display_rows (tests/test_source_lookup.py).

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookupAllSources, buildAllSourcesDisplayRows, buildLookupIssueRows, ALL_SOURCES_COLUMNS } = require('./sourceLookup');

function stock(rowIndex, nguon, maVat, tenKt, dvt, ton, thueVat = 0.08) {
  return {
    rowIndex, nguon, maKiotDaiDien: '', tenKiotDaiDien: '', maVatKiot: maVat, tenVatKiot: 'TEN VAT MAU',
    tenKeToan: tenKt, donViTinh: dvt, tonDauNgay: ton, giaBan: 10000, thueVat, thueNk: null, tongThueMat: null,
    tongDangNhap: 0, tonCoTheNhap: ton, maVatKiotNorm: maVat.toLowerCase(), tenKeToanNorm: tenKt.toLowerCase(), donViTinhNorm: dvt.toLowerCase()
  };
}
const mapping = (rowIndex, maSp, tenSp, maVat, tenTruocVat = '') => ({
  rowIndex, maSp, tenSp, maVatKiot: maVat, tenTruocVat, maSpNorm: maSp.toLowerCase(), maVatKiotNorm: maVat.toLowerCase()
});
const query = (orderIndex, fields) => ({ orderIndex, maSp: '', tenSp: '', sl: '', giaBan: '', ghiChuHangHoa: '', ...fields });

test('tra moi nguon: ton duong truoc (ton it truoc), het/am ton sau', () => {
  const stocks = [
    stock(2, 'CAO', 'VAT10636', 'Bông tẩy trang', 'Túi', 11403),
    stock(3, 'MAY', 'VAT10636', 'Bông tẩy trang Hatsu', 'Gói', 50),
    stock(4, 'MAY', 'VAT10636', 'Bông tẩy trang', 'Cái', 1),
    stock(5, 'MAY', 'VAT10636', 'Hết tồn', 'Gói', 0),
    stock(6, 'CAO', 'VAT10636', 'Âm tồn', 'Gói', -2)
  ];
  const result = lookupAllSources([query(1, { maSp: 'BTT8422', sl: 100, giaBan: 11500 })], [mapping(2, 'BTT8422', 'Bông tẩy trang', 'VAT10636')], stocks);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.lines.map(l => l.tonConNhap), [1, 50, 11403, 0, -2]);
  assert.equal(result.lines[0].giaNhap, 10648.15);
});

test('ma chi co o Gop VAT -> lay ma dai dien', () => {
  const s = stock(2, 'MAY', 'VAT01', 'Tên kế toán', 'Cái', 0);
  s.maKiotDaiDien = 'ONLY-GOP';
  s.tenKiotDaiDien = 'Chỉ có trong Gộp VAT';
  const result = lookupAllSources([query(1, { maSp: ' only-gop ' })], [], [s]);
  assert.equal(result.issues.length, 0);
  assert.deepEqual([result.lines[0].maSp, result.lines[0].maVat, result.lines[0].tonConNhap], ['ONLY-GOP', 'VAT01', 0]);
});

test('bang hien thi: dung bo cot, cot dau vao chi o dong dau moi san pham', () => {
  const stocks = [stock(2, 'MAY', 'VAT01', 'KT1', 'Cái', 5), stock(3, 'CAO', 'VAT01', 'KT2', 'Gói', 10)];
  const result = lookupAllSources([query(1, { maSp: 'SP01', sl: 3, giaBan: 1000 })], [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01')], stocks);
  const rows = buildAllSourcesDisplayRows(result.lines);
  assert.deepEqual(Object.keys(rows[0]), [...ALL_SOURCES_COLUMNS]);
  assert.equal(rows[0]['Mã kiot'], 'SP01');
  assert.deepEqual([rows[1]['Mã kiot'], rows[1]['Tên kiot'], rows[1].SL, rows[1]['Giá bán']], ['', '', '', '']);
});

test('tra theo ten chinh xac; ten trung nhieu ma -> yeu cau nhap ma', () => {
  const found = lookupAllSources([query(1, { tenSp: ' sản phẩm 1 ' })], [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01')], [stock(2, 'A', 'VAT01', 'KT1', 'Cái', 20)]);
  assert.equal(found.issues.length, 0);
  assert.equal(found.lines[0].maSp, 'SP01');

  const dup = lookupAllSources([query(1, { tenSp: 'Tên trùng' })], [mapping(2, 'SP01', 'Tên trùng', 'VAT01'), mapping(3, 'SP02', 'Tên trùng', 'VAT02')], []);
  assert.equal(dup.lines.length, 0);
  assert.equal(dup.issues[0].issueType, 'ten_trung_nhieu_ma');
  assert.deepEqual(buildLookupIssueRows(dup.issues)[0], {
    'Dòng nhập': 1, 'Mã SP': '', 'Tên SP': 'Tên trùng',
    'Nội dung': 'Tên SP khớp nhiều mã: SP01, SP02. Hãy nhập Mã SP để chọn chính xác.'
  });
});

test('Ma VAT khong co dong nguon -> issue khong_co_nguon', () => {
  const result = lookupAllSources([query(1, { maSp: 'SP01' })], [mapping(2, 'SP01', 'Sản phẩm 1', 'VAT01')], []);
  assert.equal(result.issues[0].issueType, 'khong_co_nguon');
});
