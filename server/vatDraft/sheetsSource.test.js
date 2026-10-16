'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('./csv');
const {
  columnLetterToIndex,
  toPandasFrame,
  parseGopVat,
  parseKhopMa,
  parseMasterData,
  fetchSheetCsv,
  createMasterDataSource
} = require('./sheetsSource');

const GOP_HEADER = 'CTY,Mã kiot đại diện,Tên kiot đại diện,MÃ VAT KIOT,TÊN VAT KIOT,TÊN HÀNG,Đơn vị tính,x,TỒN ĐẦU NGÀY,GIÁ BÁN,THUẾ VAT,THUẾ NK,TỔNG THUẾ MẤT,TỔNG ĐANG NHÁP,TỒN CÓ THỂ NHÁP';
const KHOP_HEADER = 'CHECK TỒN BÊN SHEET VAT,,,,,,,,,,\nMã SP,Tên SP,,,,,,,,MÃ VAT KIOT,TÊN VAT KIOT';

test('parseCsv: nhay kep, "" trong o, xuong dong trong o, bo dong rong', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""e"""\n\n"x\ny",,\r\nz'), [['a', 'b,c', 'd "e"'], ['x\ny', '', ''], ['z']]);
});

test('columnLetterToIndex', () => {
  assert.equal(columnLetterToIndex('A'), 0);
  assert.equal(columnLetterToIndex('o'), 14);
  assert.equal(columnLetterToIndex('AA'), 26);
  assert.throws(() => columnLetterToIndex('A1'));
});

test('toPandasFrame: o trong / #N/A -> NaN; cot toan so nguyen -> chuoi so chuan; cot so le -> Number', () => {
  const frame = toPandasFrame(parseCsv('h1,h2,h3,h4\n007,1.5,#N/A,x\n10,,abc,\n'), 1);
  assert.equal(frame.width, 4);
  assert.deepEqual(frame.rows[0].slice(0, 2), ['7', 1.5]);
  assert.ok(Number.isNaN(frame.rows[0][2]));
  assert.equal(frame.rows[1][0], '10');
  assert.ok(Number.isNaN(frame.rows[1][1]));
  assert.equal(frame.rows[1][2], 'abc');
  assert.ok(Number.isNaN(frame.rows[1][3]));
});

test('parseGopVat: dong A-G trong thanh "nan" nhu pandas, TON #N/A bi bo, dong trong hoan toan bi bo', () => {
  const csv = [
    GOP_HEADER,
    'TKS THẤP,XUẤT THẤP,XUẤT THẤP,VAT1,Tên VAT,Đũa tre,Đôi,TKS THẤP,"76,614",370,8%,,8.00%,"1,000","75,614"',
    ',,,,,,,,,,,,,,"1,234"',
    'MAY,SP2,Tên 2,VAT2,Tên VAT 2,Kế toán 2,Cái,MAY,10,500,10%,,10%,,#N/A',
    ',,,,,,,,,,,,,,',
    'CAO,SP3,Tên 3,VAT3,Tên VAT 3,Kế toán 3,Cái,CAO,10,500,8%,,8%,,-5'
  ].join('\n');
  const { stockRows, warnings, summary, errors } = parseGopVat(toPandasFrame(parseCsv(csv), 1));
  assert.deepEqual(errors, []);
  assert.equal(stockRows.length, 3);
  const [first, nanRow, third] = stockRows;
  assert.deepEqual([first.rowIndex, first.nguon, first.maVatKiot, first.tonCoTheNhap, first.thueVat, first.tongDangNhap, first.giaBan], [2, 'TKS THẤP', 'VAT1', 75614, 0.08, 1000, 370]);
  assert.equal(first.maVatKiotNorm, 'vat1');
  assert.deepEqual([nanRow.nguon, nanRow.maVatKiot, nanRow.maVatKiotNorm, nanRow.tonCoTheNhap, nanRow.thueVat], ['nan', 'nan', 'nan', 1234, null]);
  assert.deepEqual([third.rowIndex, third.tonCoTheNhap], [6, -5], 'row_index dem ca dong bi bo');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].detail, /Dòng 4: TỒN CÓ THỂ NHÁP='nan'/);
  assert.equal(summary.invalidTonCount, 1);
  assert.equal(summary.zeroOrNegativeTonCount, 1);
});

test('parseKhopMa bo 2 dong dau, doc A/B/J/K', () => {
  const csv = `${KHOP_HEADER}\nAPTH10,Ấm giữ nhiệt Hoa 1L,"71,500",,,,,0,9.27%,VAT10001,"Ấm giữ nhiệt 1000ML (72,300 - 78,700) (VAT)"`;
  const { mappingRows } = parseKhopMa(toPandasFrame(parseCsv(csv), 2));
  assert.deepEqual(mappingRows, [{
    rowIndex: 2, maSp: 'APTH10', tenSp: 'Ấm giữ nhiệt Hoa 1L', maVatKiot: 'VAT10001',
    tenTruocVat: 'Ấm giữ nhiệt 1000ML (72,300 - 78,700) (VAT)', maSpNorm: 'apth10', maVatKiotNorm: 'vat10001'
  }]);
});

test('cot nam ngoai pham vi sheet -> loi', () => {
  const data = parseMasterData('a,b,c\n1,2,3', 'x\ny\n1,2');
  assert.equal(data.errors.length, 2);
  assert.match(data.errors[0], /Gộp VAT' thiếu cột/);
});

function fakeResponse({ status = 200, contentType = 'text/csv; charset=utf-8', body = '' }) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => contentType }, text: async () => body };
}

test('fetchSheetCsv: sheet het cong khai (tra HTML) -> loi ro rang', async () => {
  await assert.rejects(
    fetchSheetCsv({ gid: 0, sheetName: 'Gộp VAT', fetchImpl: async () => fakeResponse({ contentType: 'text/html' }) }),
    error => error.code === 'SHEET_NOT_PUBLIC' && error.statusCode === 503
  );
  await assert.rejects(
    fetchSheetCsv({ gid: 0, sheetName: 'Gộp VAT', fetchImpl: async () => fakeResponse({ status: 500 }) }),
    error => error.code === 'SHEET_HTTP'
  );
});

test('createMasterDataSource: cache 10 phut, refresh ep tai lai, loi thi tra ban cu (stale)', async () => {
  let calls = 0;
  let fail = false;
  let clock = 0;
  const gop = `${GOP_HEADER}\nMAY,SP1,Tên,VAT1,Tên VAT,KT,Cái,MAY,1,100,8%,,8%,,5`;
  const khop = `${KHOP_HEADER}\nSP1,Tên,,,,,,,,VAT1,Tên VAT`;
  const fetchImpl = async url => {
    calls += 1;
    if (fail) throw new Error('mat mang');
    return fakeResponse({ body: url.includes('gid=0') ? gop : khop });
  };
  const source = createMasterDataSource({ fetchImpl, now: () => clock });
  const first = await source.get();
  assert.equal(first.stockRows.length, 1);
  assert.equal(first.mappingRows.length, 1);
  assert.equal(calls, 2);
  clock = 5 * 60 * 1000;
  await source.get();
  assert.equal(calls, 2, 'con trong 10 phut thi dung cache');
  await source.refresh();
  assert.equal(calls, 4);
  fail = true;
  const stale = await source.refresh();
  assert.equal(stale.stale, true);
  assert.equal(stale.stockRows.length, 1);
});
