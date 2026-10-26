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

/* --- Ghép phiếu nhập Kiot (số lượng) với vị trí của tab Vị trí hàng (NGÀY VỀ) --- */

function loadedLedger(){
  const ledger = S.createLedger();
  ledger.load(S.build(FILE, { branch:'HN' }), { 'Khu A':'2026-10-20T16:00:00+07:00', 'Khu B':'2026-10-21T16:00:00+07:00' });
  return ledger;
}
const SHEET = [
  { branch:'HN', code:'COC123',  location:'A05', arrivalDate:'22/10/2026' },
  { branch:'HN', code:'HOP1000', location:'A05', arrivalDate:'23/10/2026' },
  { branch:'HN', code:'HOP1000', location:'B05', arrivalDate:'23/10/2026' }
];

test('một mã về một vị trí: ghép tự động và cộng đúng số của phiếu nhập', () => {
  const ledger = loadedLedger();
  const plan = ledger.matchReceipts('HN', SHEET, [
    { branch:'HN', productCode:'COC123', purchaseDate:'22/10/2026', quantity:'50.000', documentId:901, documentCode:'PN0901' }
  ]);
  assert.equal(plan[0].status, 'matched');
  assert.equal(plan[0].location, 'A05');
  assert.equal(plan[0].quantity, 50000);
  ledger.applyMatch(plan[0]);
  assert.equal(ledger.onHand('HN','COC123','A05'), 65000, 'tồn đầu 15.000 + nhập 50.000');
});

test('cùng mã về cùng ngày ở nhiều vị trí: máy không tự chia, phải phân tay', () => {
  const ledger = loadedLedger();
  const plan = ledger.matchReceipts('HN', SHEET, [
    { branch:'HN', productCode:'HOP1000', purchaseDate:'23/10/2026', quantity:1000, documentId:902, documentCode:'PN0902' }
  ]);
  assert.equal(plan[0].status, 'ambiguous');
  assert.deepEqual(plan[0].candidates.map(c => c.location), ['A05','B05']);
  assert.throws(() => ledger.applyMatch(plan[0]), /Cần phân số lượng/);
  assert.throws(() => ledger.applyMatch(plan[0], { A05:600, B05:300 }), /không bằng số nhập 1000/);
  assert.throws(() => ledger.applyMatch(plan[0], { A05:600, 'KHONG-CO':400 }), /không phải ứng viên/);
  ledger.applyMatch(plan[0], { A05:600, B05:400 });
  assert.equal(ledger.onHand('HN','HOP1000','A05'), 600, 'mã mới ở vị trí đã kiểm kê: tồn đầu 0 + 600');
  assert.equal(ledger.onHand('HN','HOP1000','B05'), 400);
});

test('phiếu nhập không ghép được vị trí hoặc đã nằm trong số đếm', () => {
  const ledger = loadedLedger();
  const plan = ledger.matchReceipts('HN', SHEET, [
    { branch:'HN', productCode:'KEP78',  purchaseDate:'22/10/2026', quantity:10, documentId:903 },  // sheet không có dòng nào
    { branch:'HN', productCode:'COC123', purchaseDate:'19/10/2026', quantity:10, documentId:904 },  // trước giờ chốt, sheet không có
    { branch:'HN', productCode:'COC123', purchaseDate:'',           quantity:10, documentId:905 },
    { branch:'HN', productCode:'',       purchaseDate:'22/10/2026', quantity:10, documentId:906 }
  ]);
  assert.deepEqual(plan.map(p => p.status), ['no-location','no-location','invalid','invalid']);
  assert.throws(() => ledger.applyMatch(plan[0]), /Chỉ ghi được dòng đã ghép được vị trí/);
});

test('lô về trước giờ chốt khu được nhận là đã nằm trong số đếm, không cộng lại', () => {
  const ledger = loadedLedger();
  const sheet = [{ branch:'HN', code:'COC123', location:'A05', arrivalDate:'18/10/2026' }];
  const plan = ledger.matchReceipts('HN', sheet, [
    { branch:'HN', productCode:'COC123', purchaseDate:'18/10/2026', quantity:7000, documentId:907 }
  ]);
  assert.equal(plan[0].status, 'counted');
  assert.equal(ledger.onHand('HN','COC123','A05'), 15000);
});

test('một chứng từ chỉ ghi một lần, dù bấm lại hay đồng bộ lại', () => {
  const ledger = loadedLedger();
  const receipt = { branch:'HN', productCode:'COC123', purchaseDate:'22/10/2026', quantity:50000, documentId:901, documentCode:'PN0901' };
  const plan = ledger.matchReceipts('HN', SHEET, [receipt]);
  ledger.applyMatch(plan[0]);
  assert.equal(ledger.onHand('HN','COC123','A05'), 65000);
  const again = ledger.applyMatch(plan[0]);
  assert.equal(again[0].duplicate, true);
  assert.equal(ledger.onHand('HN','COC123','A05'), 65000, 'ghi lại cùng chứng từ không cộng thêm');
  assert.equal(ledger.movements({ branch:'HN' }).filter(m => m.type === 'receipt').length, 1);
  // Chứng từ bị sửa số: phải xử lý bằng điều chỉnh, không ghi đè lịch sử.
  const edited = ledger.matchReceipts('HN', SHEET, [{ ...receipt, quantity:60000 }]);
  assert.throws(() => ledger.applyMatch(edited[0]), /Chứng từ đã bị sửa/);
  assert.equal(ledger.onHand('HN','COC123','A05'), 65000);
});

test('ghép Kiot không chạm cơ sở khác', () => {
  const ledger = loadedLedger();
  const plan = ledger.matchReceipts('HN', SHEET, [
    { branch:'SG', productCode:'COC123', purchaseDate:'22/10/2026', quantity:50000, documentId:908 }
  ]);
  assert.deepEqual(plan, [], 'phiếu nhập của SG không được ghép vào HN');
});

test('SL của dòng kiểm kê lấy từ Ghi chú hàng hóa (5T x 100 = 500), cột Số lượng chỉ là dự phòng; cột Số lượng không bắt buộc khi có ghi chú', () => {
  globalThis.PickingCarton = require('./carton.js');
  try {
    const rows = [
      ['Mã hàng','Tên khách hàng','Ghi chú','Ghi chú hàng hóa','Số lượng'],
      ['P1','Khu A','A01','5T x 100','1'],
      ['P2','Khu A','A02','Dãy cửa kho','70'],
      ['P3','Khu A','A03','1Tx50 + 2Tx25','']
    ];
    const snapshot = S.build(rows, { branch:'HN' });
    const by = code => snapshot.lines.find(line => line.code === code);
    assert.equal(by('P1').quantity, 500, 'ghi chú đọc được thắng cột Số lượng');
    assert.equal(by('P2').quantity, 70, 'ghi chú không đọc được thì dùng Số lượng dự phòng (dòng vẫn bị cảnh báo ở sổ vị trí)');
    assert.equal(by('P3').quantity, 100, 'nhiều quy cách vẫn tính SL, thiếu cột Số lượng cũng được');
    const noQuantityColumn = S.build([['Mã hàng','Tên khách hàng','Ghi chú','Ghi chú hàng hóa'], ['P1','Khu A','A01','5T x 100']], { branch:'HN' });
    assert.deepEqual(noQuantityColumn.errors, []);
    assert.equal(noQuantityColumn.lines[0].quantity, 500);
  } finally { delete globalThis.PickingCarton; }
});

test('hai dòng cùng mã và vị trí: cùng SL/thùng thì cộng thùng, khác SL/thùng thì thành nhiều quy cách; mã giống nhau ở HN và SG tách riêng', () => {
  globalThis.PickingCarton = require('./carton.js');
  try {
    const header = ['Mã hàng','Tên khách hàng','Ghi chú','Ghi chú hàng hóa'];
    const merged = S.build([header, ['P1','Khu A','A01','3T x 100'], ['P1','Khu A','A01','2T x 100']], { branch:'HN' });
    assert.equal(merged.lines.length, 1);assert.equal(merged.lines[0].spec, '5T x 100');assert.equal(merged.lines[0].quantity, 500);
    const mixed = S.build([header, ['P1','Khu A','A01','1T x 50'], ['P1','Khu A','A01','2T x 25']], { branch:'HN' });
    assert.equal(mixed.lines[0].spec, '1T x 50 + 2T x 25');assert.equal(mixed.lines[0].quantity, 100);
    const sg = S.build([header, ['P1','Khu A','A01','1T x 60']], { branch:'SG' });
    assert.equal(sg.lines[0].key, 'SG|p1|A01');assert.notEqual(sg.lines[0].key, mixed.lines[0].key);
  } finally { delete globalThis.PickingCarton; }
});
