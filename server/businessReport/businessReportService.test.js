'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('./businessReportService');
const { serviceSnapshot: snapshot } = require('./testFixtures');

test('bang khach: quy doi 30 ngay, tang truong, TB 4 thang, khach hoat dong, Khach le vao Chua phan nhom', () => {
  const r = svc.buildCustomerReport(snapshot());
  const a = r.rows.find(x => x.key === 'hanoi:KH1');
  assert.equal(a.saleName, 'Khang');
  assert.equal(a.priceLevel, 'Level 2');
  assert.equal(a.normalized, 500);            // 100*30/6
  assert.equal(a.growth, 100);                // 500/500
  assert.equal(a.avg4, (500 + 0 + 0 + 500) / 4);
  assert.equal(a.active, true);
  const le = r.rows.find(x => x.key === 'hanoi:');
  assert.equal(le.saleName, 'Chưa phân nhóm');
  assert.equal(le.name, 'Khách lẻ');
  assert.equal(le.growth, null);
  const old = r.rows.find(x => x.key === 'hanoi:KH9');
  assert.equal(old.active, false, 'chi co doanh so T3 => TB 4 thang = 0');
  assert.deepEqual(r.monthLabels, ['T7/26', 'T8/26', 'T9/26', 'T10/26']);
});

test('bang sale: thang chot doc bang sale, thang hien tai gom tu khach theo nhom hien tai; SL khach = so khach hoat dong', () => {
  const r = svc.buildSaleReport(snapshot());
  const khang = r.rows.find(x => x.saleName === 'Khang');
  assert.equal(khang.series['2026-09-01'], 500);
  assert.equal(khang.current, 100);
  assert.equal(khang.activeCustomers, 2); // KH1 HN + KH1 SG (TB4 = 300/4 > 0)
  const none = r.rows.find(x => x.saleName === 'Chưa phân nhóm');
  assert.equal(none.current, 60);
  assert.ok(r.kpis.find(k => k.key === 'current').value === 160);
});

test('bang ma hang: tang truong theo tien', () => {
  const r = svc.buildProductReport(snapshot());
  const p = r.rows.find(x => x.code === 'SP1');
  assert.equal(p.normalized, 800);
  assert.equal(p.growth, 200);
});

test('chi tiet sale: tong quan + chuoi thang + danh sach khach cua sale', () => {
  const d = svc.buildDetail('sale', 'Khang', snapshot(), {});
  assert.equal(d.title, 'Khang');
  assert.deepEqual(d.chart.map(c => c.label), ['T7/26', 'T8/26', 'T9/26', 'T10/26']);
  assert.equal(d.customers.length, 2);
  assert.ok(d.summary.find(s => s.key === 'avg4'));
});

test('khong co key thi buildDetail nem loi 404', () => {
  assert.throws(() => svc.buildDetail('sale', 'Khong ton tai', snapshot(), {}), e => e.statusCode === 404);
});
