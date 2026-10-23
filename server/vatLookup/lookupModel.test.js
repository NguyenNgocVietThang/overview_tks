'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../vatDraft/csv');
const m = require('./lookupModel');
const { parseLookupRecords, isFormulaErrorSheet } = require('./lookupSource');

// Header giong sheet that (23/10/2026): Khớp mã co dong ghi chu phia tren header,
// DK về 2 co cot so luong cuoi khong co ten.
const GOP = [
  'CTY,Mã kiot đại diện,Tên kiot đại diện,MÃ VAT KIOT,TÊN VAT KIOT (giá chưa vat tham khảo),TÊN HÀNG,Đơn vị tính,x,TỒN ĐẦU NGÀY,GIÁ BÁN,THUẾ VAT,THUẾ NK,TỔNG THUẾ MẤT,TỔNG ĐANG NHÁP,TỒN CÓ THỂ NHÁP',
  'TKS THẤP,APTH10,Ấm Hoa,VAT10001,Ấm VAT,Ấm giữ nhiệt 1L,Cái,x,"1,200",100,8%,,8.00%,200,"1,000"',
  'VC,APTH10,Ấm Hoa,VAT10001,Ấm VAT,Ấm giữ nhiệt 1L,Cái,x,300,100,8%,,8.00%,,300',
  'LUCKY,APTH10,Ấm Hoa,VAT10001,Ấm VAT,Ấm giữ nhiệt loại khác,Cái,x,50,100,8%,,10.00%,,XUẤT THẤP',
  'SHC,BDC-PT1B,Bơm đạp,VAT20002,Bơm VAT,Bơm đạp chân,Cái,x,0,100,8%,,8.00%,,0',
  'SHC,ONLYGOP,Chỉ có ở Gộp,VAT30003,X,Hàng gộp,Cái,x,10,1,8%,,8.00%,,10'
].join('\n');
const KHOP = [
  'CHECK TỒN BÊN SHEET VAT,,,,,,,,,,',
  'Mã SP,Tên SP,,,,,,,,MÃ VAT KIOT,TÊN VAT KIOT',
  'APTH10,Ấm giữ nhiệt Hoa 1L,0,,,,,,,VAT10001,Ấm giữ nhiệt 1000ML (VAT)',
  'APTH10-B,Ấm Hoa bản B,0,,,,,,,VAT10001,Ấm giữ nhiệt 1000ML (VAT)',
  'BDC-PT1B,Bơm đạp chân pittong,0,,,,,,,VAT20002,Bơm (VAT)',
  'NOVAT,Hàng chưa có mã VAT,0,,,,,,,,'
].join('\n');
const DKVE = [
  'TRẠNG THÁI,CONT,mã kiot,tên kiot,',
  '1. Đang chờ khai,10-10Y,APTH10,Ấm giữ nhiệt Hoa 1L,800',
  '1. Đang chờ khai,10-10Y,APTH10,Ấm giữ nhiệt Hoa 1L,"1,000"',
  '3. Đã khai,9-1V,APTH10,Ấm giữ nhiệt Hoa 1L,5',
  '4. Đã ký - Chưa nhập Kiot,9-10V,APTH10,Ấm giữ nhiệt Hoa 1L,"2,592"',
  '10. Đã nhập Kiot,8-1V,BDC-PT1B,Bơm đạp chân pittong,10',
  '2. Đang về cảng,BSUNG-1,TALEWS,BÚT NHUỘM TÓC SUAKE (OD),972'
].join('\n');

const model = () => parseLookupRecords({ gop: parseCsv(GOP), khop: parseCsv(KHOP), dkve: parseCsv(DKVE) });

test('rowsToObjects: do dung dong header nam duoi dong ghi chu, cot khong ten thanh "Cột N"', () => {
  const rows = m.rowsToObjects(parseCsv(KHOP), ['ma sp', 'ten sp']);
  assert.equal(rows[0]['Mã SP'], 'APTH10');
  assert.equal(rows[0].__rowNumber, 3);
  assert.deepEqual(m.makeUniqueHeaders(['A', '', 'A']), ['A', 'Cột 2', 'A (2)']);
});

test('parseNumber: phan cach hang nghin, chu -> 0', () => {
  assert.equal(m.parseNumber('1,200'), 1200);
  assert.equal(m.parseNumber('1.234.567'), 1234567);
  assert.equal(m.parseNumber('1,5'), 1.5);
  assert.equal(m.parseNumber('XUẤT THẤP'), 0);
  assert.equal(m.parseNumber(''), 0);
});

test('trang thai: "10." khong bi doc thanh 1; chi 1-3 la chuan bi ve', () => {
  assert.equal(m.parseTrangThaiSo('10. Đã nhập Kiot'), 10);
  assert.equal(m.isChuanBiVe(10), false);
  assert.equal(m.isChuanBiVe(3), true);
  assert.equal(m.trangThaiLabel('1. Đang chờ khai'), 'Đang chờ khai');
});

test('Gộp VAT: cong ton qua cac CTY cung san pham, Ten hang khac thanh dong rieng', () => {
  const result = m.search(model(), ['APTH10']);
  const lines = result.vat.rows.filter(r => r.maKiot === 'APTH10');
  assert.equal(lines.length, 2);
  const main = lines.find(r => r.tenHang === 'Ấm giữ nhiệt 1L');
  assert.deepEqual([main.tonDauNgay, main.tonCoTheNhap, main.tongThueMat, main.conVAT], [1500, 1300, '8.00%', true]);
  const other = lines.find(r => r.tenHang === 'Ấm giữ nhiệt loại khác');
  assert.equal(other.tonCoTheNhap, 0, 'ton la chu -> 0, dong van hien');
});

test('tim kiem: khop ma chinh xac dung dau, san pham chung ma VAT di kem', () => {
  const result = m.search(model(), ['APTH10']);
  assert.equal(result.productCount, 2);
  assert.deepEqual([...new Set(result.vat.rows.map(r => r.maKiot))], ['APTH10', 'APTH10-B']);
});

test('tim theo ten khong dau', () => {
  const result = m.search(model(), ['bom dap chan']);
  assert.equal(result.vat.rows[0].maKiot, 'BDC-PT1B');
  assert.equal(result.vat.rows[0].conVAT, false, 'ton co the nhap = 0 -> Không còn VAT');
});

test('Hàng sắp về: chi trang thai 1-3, gop theo CONT + ma Kiot va cong so luong', () => {
  const result = m.search(model(), ['APTH10']);
  assert.deepEqual(result.incoming.rows.map(r => [r.cont, r.maKiot, r.trangThai, r.soLuong]), [
    ['10-10Y', 'APTH10', 'Đang chờ khai', 1800],
    ['9-1V', 'APTH10', 'Đã khai', 5]
  ]);
  assert.equal(result.vat.rows[0].hasIncoming, true);
});

test('san pham chi co o DK về 2 van tim duoc (loi BÚT NHUỘM TÓC SUAKE 2026-08-19)', () => {
  const result = m.search(model(), ['BÚT NHUỘM TÓC SUAKE']);
  assert.equal(result.productCount, 1);
  assert.deepEqual(result.vat.rows.map(r => [r.maKiot, r.maVat, r.conVAT, r.hasIncoming]), [['TALEWS', '', false, true]]);
  assert.equal(result.incoming.rows[0].cont, 'BSUNG-1');
});

test('khong co dong sap ve: tra danh sach dong DK về 2 de thay ly do', () => {
  const result = m.search(model(), ['BDC-PT1B']);
  assert.equal(result.incoming.total, 0);
  assert.deepEqual(result.incoming.debug, [{ maKiot: 'BDC-PT1B', trangThai: '10. Đã nhập Kiot', rowNumber: 6 }]);
});

test('dan nhieu dong: bo trung, tach ;, bao tu khoa khong tim thay', () => {
  const parsed = m.parseSearchQueries('APTH10\n apth10 ;khongco\n\nBDC-PT1B');
  assert.deepEqual(parsed.queries, ['APTH10', 'khongco', 'BDC-PT1B']);
  const result = m.search(model(), parsed.queries);
  assert.deepEqual(result.notFoundQueries, ['khongco']);
  assert.deepEqual(result.matchedQueries, ['APTH10', 'BDC-PT1B']);
  const many = m.parseSearchQueries(Array.from({ length: 105 }, (_, i) => 'M' + i).join('\n'));
  assert.equal(many.queries.length, 100);
  assert.equal(many.ignoredCount, 5);
});

test('model dem dong tung sheet', () => {
  const built = model();
  assert.deepEqual(built.counts, { gop: 5, khop: 4, dkve: 6 });
  assert.match(built.source, /DK về 2 6 dòng/);
});

test('sheet chi con o #REF! -> loi 503 DK_VE_REF_ERROR', () => {
  assert.equal(isFormulaErrorSheet(parseCsv('#REF!')), true);
  assert.equal(isFormulaErrorSheet(parseCsv(DKVE)), false);
  assert.throws(() => parseLookupRecords({ gop: parseCsv(GOP), khop: parseCsv(KHOP), dkve: [['#REF!']] }), error => error.code === 'DK_VE_REF_ERROR' && error.statusCode === 503);
});

test('Khớp mã goc (file VAT TKS): cot K "Tên trước (Giá đầu - Giá cuối) (VAT)" dung lam ten VAT', () => {
  const khop = parseCsv(',,,,,,,Đỏ cao quá,Vàng thấp quá\nMã SP,Tên SP,Giá Bq,,,,,,,Mã vat kiot,Tên trước (Giá đầu  - Giá cuối) (VAT)\nNOGOP,Ấm Hoa,0,,,,,,,VAT90009,"Ấm (72,300 - 78,700) (VAT)"');
  const built = parseLookupRecords({ gop: parseCsv(GOP), khop, dkve: parseCsv(DKVE) });
  const result = m.search(built, ['NOGOP']);
  assert.deepEqual(result.vat.rows.map(r => [r.maKiot, r.maVat, r.tenVat]), [['NOGOP', 'VAT90009', 'Ấm (72,300 - 78,700) (VAT)']]);
});
