'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./stocktake.js');

const FILE = [
  'Mã hàng\tTên hàng\tTên khách hàng\tGhi chú\tGhi chú hàng hóa\tSố lượng',
  'COC123\tCốc thủy tinh 123\tKhu A\tA05\tT\t12.000',
  'COC123\tCốc thủy tinh 123\tKhu A\tA05\tT\t3.000',
  'COC123\tCốc thủy tinh 123\tKhu B\tB05\t\t10.000',
  'BINH500\tBình nước 500 ml\tKhu A\ta05\tThùng 100\t400',
  'KEP78\tMóc phơi đồ\tKhu B\tB06\t\tkhông rõ',
  '\tThiếu mã\tKhu B\tB07\t\t10'
].join('\n');

test('quantity reads the Vietnamese stocktake format and refuses to guess', () => {
  assert.equal(S.parseQuantity('12.000'), 12000);
  assert.equal(S.parseQuantity('1.234.567'), 1234567);
  assert.equal(S.parseQuantity('12,5'), 12.5);
  assert.equal(S.parseQuantity('1.000,5'), 1000.5);
  assert.equal(S.parseQuantity('400'), 400);
  assert.equal(S.parseQuantity('12.3'), 12.3);
  assert.equal(S.parseQuantity('không rõ'), null);
  assert.equal(S.parseQuantity(''), null);
  assert.equal(S.parseQuantity(-5), null);
});

test('columns map the stocktake file meanings, not the sheet labels', () => {
  const map = S.detectColumns(S.parseTable(FILE)[0]);
  // "Ghi chú" là vị trí, "Ghi chú hàng hóa" là quy cách, "Tên khách hàng" là nhóm kiểm kê.
  assert.equal(map.location, 3);
  assert.equal(map.spec, 4);
  assert.equal(map.zone, 2);
  assert.equal(map.quantity, 5);
});

test('duplicate code + location rows are summed and location case is normalised', () => {
  const snapshot = S.build(FILE, { branch:'HN' });
  assert.deepEqual(snapshot.errors, []);
  const a05 = snapshot.lines.find(l => l.code === 'COC123' && l.location === 'A05');
  assert.equal(a05.quantity, 15000);
  assert.deepEqual(a05.sourceRows, [2, 3]);
  assert.equal(a05.spec, 'T');
  assert.equal(snapshot.lines.find(l => l.code === 'BINH500').location, 'A05');
  assert.equal(snapshot.zones.find(z => z.zone === 'Khu A').locationCount, 1);
});

test('unreadable rows are reported, never silently counted as zero', () => {
  const snapshot = S.build(FILE, { branch:'HN' });
  assert.equal(snapshot.lines.some(l => l.code === 'KEP78'), false);
  assert.deepEqual(snapshot.skipped.map(s => s.sourceRow), [6, 7]);
  assert.match(snapshot.skipped[0].reason, /Số lượng không đọc được/);
  assert.match(snapshot.skipped[1].reason, /Thiếu mã hàng/);
});

test('a location appearing in two zones is rejected because locations are unique', () => {
  const snapshot = S.build([
    ['Mã hàng','Tên khách hàng','Ghi chú','Số lượng'],
    ['COC123','Khu A','A05','100'],
    ['BINH500','Khu B','A05','50']
  ], { branch:'HN' });
  assert.equal(snapshot.errors.length, 1);
  assert.match(snapshot.errors[0], /A05 xuất hiện ở nhiều khu/);
});

test('a zone without a cutoff time is not loaded as opening stock', () => {
  const ledger = S.createLedger();
  const snapshot = S.build(FILE, { branch:'HN' });
  const result = ledger.load(snapshot, { 'Khu A':'2026-10-20T18:00:00+07:00' });
  assert.deepEqual(result.loadedZones, ['Khu A']);
  assert.deepEqual(result.pendingZones, ['Khu B']);
  assert.equal(ledger.onHand('HN','COC123','A05'), 15000);
  assert.equal(ledger.onHand('HN','COC123','B05'), null, 'khu chưa chốt giờ phải là chưa có tồn xác nhận');
});

test('movements before the zone cutoff are already counted and not added twice', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T18:00:00+07:00' });
  const during = ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'receipt', quantity:'5.000', at:'2026-10-20T09:00:00+07:00' });
  assert.equal(during.counted, true);
  assert.equal(ledger.onHand('HN','COC123','A05'), 15000);
  ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'receipt', quantity:'5.000', at:'2026-10-21T09:00:00+07:00' });
  assert.equal(ledger.onHand('HN','COC123','A05'), 20000);
});

test('opening stock plus receipts minus picks plus adjustment', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T18:00:00+07:00', 'Khu B':'2026-10-21T18:00:00+07:00' });
  const after = { at:'2026-10-22T08:00:00+07:00' };
  ledger.record({ ...after, branch:'HN', code:'COC123', location:'A05', type:'receipt', quantity:2000 });
  ledger.record({ ...after, branch:'HN', code:'COC123', location:'A05', type:'pick', quantity:3000 });
  ledger.record({ ...after, branch:'HN', code:'COC123', location:'A05', type:'adjust', quantity:'-500' });
  assert.equal(ledger.onHand('HN','COC123','A05'), 13500);
  assert.deepEqual(ledger.verifiedTotal('HN','coc123'), { locationCount:2, quantity:23500 });
});

test('movement on a location without opening stock is refused', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T18:00:00+07:00' });
  assert.throws(() => ledger.record({ branch:'HN', code:'COC123', location:'Z99', type:'pick', quantity:1 }), /Chưa có tồn kiểm kê/);
  assert.throws(() => ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'pick', quantity:'nhiều' }), /không hợp lệ/);
  assert.throws(() => ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'sale', quantity:1 }), /receipt, pick hoặc adjust/);
});

test('a zone cutoff added later turns its lines into confirmed stock', () => {
  const ledger = S.createLedger();
  const snapshot = S.build(FILE, { branch:'HN' });
  ledger.load(snapshot, { 'Khu A':'2026-10-20T18:00:00+07:00' });
  assert.equal(ledger.onHand('HN','COC123','B05'), null);
  ledger.setCutoff('HN','Khu B','2026-10-21T18:00:00+07:00');
  ledger.load(snapshot, { 'Khu B':'2026-10-21T18:00:00+07:00' });
  assert.equal(ledger.onHand('HN','COC123','B05'), 10000);
  assert.equal(ledger.cutoff('HN','Khu B'), new Date('2026-10-21T18:00:00+07:00').toISOString());
});

test('each branch is a separate stock source', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T18:00:00+07:00' });
  ledger.load(S.build(FILE, { branch:'SG' }), { 'Khu A':'2026-10-20T18:00:00+07:00' });
  ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'pick', quantity:5000, at:'2026-10-22T08:00:00+07:00' });
  assert.equal(ledger.onHand('HN','COC123','A05'), 10000);
  assert.equal(ledger.onHand('SG','COC123','A05'), 15000);
});

test('comma separated files and quoted fields parse the same way', () => {
  const rows = S.parseTable('Mã hàng,Tên khách hàng,Ghi chú,Số lượng\n"COC, 123",Khu A,A05,"1.500"\n');
  assert.deepEqual(rows[1], ['COC, 123','Khu A','A05','1.500']);
});

/* --- Đóng băng khu đang kiểm kê (quyết định: trong ngày kiểm khu sẽ không ra đơn) --- */

test('khu đang kiểm kê bị đóng băng, không ghi được biến động cho tới khi chốt', () => {
  const ledger = S.createLedger();
  ledger.startCount('HN', 'Khu A', { locations:['A05','Z09'], startedAt:'2026-10-20T08:00:00+07:00' });
  assert.equal(ledger.frozen('HN','A05').zone, 'Khu A');
  assert.equal(ledger.frozen('HN','B05'), null, 'khu khác vẫn hoạt động bình thường');
  assert.throws(() => ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'pick', quantity:2000 }),
    /Khu Khu A đang kiểm kê/);
  // Chốt kỳ kiểm kê là mốc mở lại khu.
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T16:00:00+07:00' });
  assert.equal(ledger.frozen('HN','A05'), null);
  assert.equal(ledger.onHand('HN','COC123','A05'), 15000);
  ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'pick', quantity:2000, at:'2026-10-20T17:00:00+07:00' });
  assert.equal(ledger.onHand('HN','COC123','A05'), 13000);
});

test('đếm lại một khu đã chốt phải khai báo rõ là đếm lại', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T16:00:00+07:00' });
  assert.throws(() => ledger.startCount('HN','Khu A'), /đã có kỳ kiểm kê chốt/);
  // Đếm lại dùng chính danh sách vị trí của kỳ trước, không cần khai lại.
  assert.equal(ledger.startCount('HN','Khu A',{ recount:true }).locationCount, 1);
  assert.equal(ledger.frozen('HN','A05').zone, 'Khu A');
});

test('đóng băng khu chưa từng kiểm kê cần danh sách vị trí', () => {
  const ledger = S.createLedger();
  assert.throws(() => ledger.startCount('HN','Khu C'), /Cần danh sách vị trí/);
});

/* --- Hàng về sau giờ chốt, lấy vị trí từ tab Vị trí hàng (cột NGÀY VỀ) --- */

test('NGÀY VỀ đọc được định dạng ngày Việt Nam', () => {
  assert.equal(S.parseSheetDate('22/10/2026'), Date.parse('2026-10-22T00:00:00+07:00'));
  assert.equal(S.parseSheetDate('3/9/2026'), Date.parse('2026-09-03T00:00:00+07:00'));
  assert.equal(S.parseSheetDate('2026-10-22'), Date.parse('2026-10-22T00:00:00+07:00'));
  assert.equal(S.parseSheetDate('tháng 10'), null);
  assert.equal(S.parseSheetDate(''), null);
});

test('phân loại dòng Vị trí hàng theo NGÀY VỀ so với giờ chốt khu', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T16:00:00+07:00' });
  const sheet = [
    { branch:'HN', code:'COC123',  location:'A05', arrivalDate:'22/10/2026' },  // về sau giờ chốt
    { branch:'HN', code:'HOP1000', location:'A05', arrivalDate:'23/10/2026' },  // mã mới ở vị trí đã kiểm kê
    { branch:'HN', code:'COC123',  location:'A05', arrivalDate:'20/10/2026' },  // đúng ngày chốt
    { branch:'HN', code:'KEP78',   location:'A05', arrivalDate:'15/10/2026' },  // trước chốt mà không có trong file
    { branch:'HN', code:'COC123',  location:'A05', arrivalDate:'' },            // không đọc được ngày
    { branch:'HN', code:'COC123',  location:'B05', arrivalDate:'22/10/2026' },  // khu B chưa chốt → bỏ qua
    { branch:'SG', code:'COC123',  location:'A05', arrivalDate:'22/10/2026' }   // cơ sở khác → bỏ qua
  ];
  const pending = ledger.pendingReceipts('HN', sheet);
  assert.deepEqual(pending.map(p => [p.code, p.status]), [
    ['COC123','after'], ['HOP1000','after'], ['COC123','same-day'], ['KEP78','missing'], ['COC123','unknown-date']
  ]);
  assert.equal(pending[0].hasOpening, true);
  assert.equal(pending[1].hasOpening, false, 'mã mới tại vị trí cũ chưa có tồn đầu');
  assert.equal(pending[0].zone, 'Khu A');
});

test('danh sách hàng về không tự cộng số lượng nào vào sổ', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T16:00:00+07:00' });
  const before = ledger.onHand('HN','COC123','A05');
  ledger.pendingReceipts('HN', [{ branch:'HN', code:'COC123', location:'A05', arrivalDate:'22/10/2026' }]);
  assert.equal(ledger.onHand('HN','COC123','A05'), before, 'TỔNG SL của tab Vị trí hàng không được dùng làm số nhập');
  // Chỉ khi có số lượng từ nguồn đáng tin mới ghi nhập.
  ledger.record({ branch:'HN', code:'COC123', location:'A05', type:'receipt', quantity:50000, at:'2026-10-22T09:00:00+07:00' });
  assert.equal(ledger.onHand('HN','COC123','A05'), before + 50000);
});

test('mã mới tại vị trí đã kiểm kê: tồn đầu 0 rồi ghi được lô nhập', () => {
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T16:00:00+07:00' });
  assert.equal(ledger.onHand('HN','HOP1000','A05'), null);
  assert.throws(() => ledger.record({ branch:'HN', code:'HOP1000', location:'A05', type:'receipt', quantity:800 }), /Chưa có tồn kiểm kê/);
  ledger.openZero('HN','HOP1000','A05');
  assert.equal(ledger.onHand('HN','HOP1000','A05'), 0);
  ledger.record({ branch:'HN', code:'HOP1000', location:'A05', type:'receipt', quantity:800, at:'2026-10-23T09:00:00+07:00' });
  assert.equal(ledger.onHand('HN','HOP1000','A05'), 800);
  assert.equal(ledger.zoneOfLocation('HN','A05'), 'Khu A');
  assert.throws(() => ledger.openZero('HN','HOP1000','KHONG-CO'), /chưa thuộc khu nào/);
});
