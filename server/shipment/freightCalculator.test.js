'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFreight } = require('./freightCalculator');

test('thieu the tich (0, am, NaN) -> khong tinh cuoc', () => {
  for (const m3 of [0, -1, NaN, undefined]) {
    assert.deepEqual(calculateFreight({ m3, kg: 10 }), { DM: null, VL: null });
  }
});

test('Duc Manh: m3 x 550k <= 350k -> cuoc toi thieu 350k', () => {
  const { DM } = calculateFreight({ m3: 0.5, kg: 900 });
  assert.equal(DM.total, 350000);
  assert.equal(DM.surcharge, 0);
});

test('Duc Manh: tren nguong -> max(kg x 1330, m3 x 550k); nhanh the tich thang', () => {
  assert.equal(calculateFreight({ m3: 1, kg: 100 }).DM.total, 550000);
});

test('Duc Manh: nhanh can nang thang khi hang nang', () => {
  assert.equal(calculateFreight({ m3: 1, kg: 600 }).DM.total, 798000);
});

test('Viet Linh: <= 0,6 m3 -> 500k + phu thu 200k', () => {
  const { VL } = calculateFreight({ m3: 0.6, kg: 5 });
  assert.equal(VL.freight, 500000);
  assert.equal(VL.surcharge, 200000);
  assert.equal(VL.total, 700000);
});

test('Viet Linh: > 0,6 m3 va < 2 m3 -> m3 x 465k + phu thu 200k', () => {
  const { VL } = calculateFreight({ m3: 1, kg: 5 });
  assert.equal(VL.freight, 465000);
  assert.equal(VL.total, 665000);
});

test('Viet Linh: dung 2 m3 khong phu thu', () => {
  const { VL } = calculateFreight({ m3: 2, kg: 5 });
  assert.equal(VL.surcharge, 0);
  assert.equal(VL.total, 930000);
});

test('moi nha xe tra ve nhan, ghi chu va cac buoc tinh', () => {
  const result = calculateFreight({ m3: 3, kg: 10 });
  assert.equal(result.DM.label, 'Đức Mạnh');
  assert.equal(result.VL.label, 'Việt Linh');
  assert.ok(result.DM.steps.length >= 1 && result.VL.note.length > 0);
});

const { buildOrderFreight } = require('./freightCalculator');

const MEASURES = new Map([
  ['a', { perCarton: 100, m3PerUnit: 0.01, kgPerUnit: 0.5 }],
  ['x', { missing: true }]
]);

test('buildOrderFreight: cong the tich/kg/thung theo SL dat, bo dong dich vu, tinh cuoc', () => {
  const { lineMeasures, freight } = buildOrderFreight([
    { productCode: 'A', quantity: 250 }, { productCode: 'VAT8', quantity: 1, isService: true }
  ], MEASURES);
  assert.equal(lineMeasures[0].status, 'ok');
  assert.equal(lineMeasures[0].m3, 2.5);
  assert.equal(lineMeasures[0].cartons, 3);
  assert.equal(lineMeasures[1].status, 'service');
  assert.deepEqual(freight.totals, { m3: 2.5, kg: 125, cartons: 3 });
  assert.equal(freight.carriers.VL.total, Math.round(2.5 * 465000));
});

test('buildOrderFreight: co ma thieu -> khong tinh cuoc, liet ke ma thieu', () => {
  const { lineMeasures, freight } = buildOrderFreight([
    { productCode: 'A', quantity: 10 }, { productCode: 'X', quantity: 5 }, { productCode: 'Z', quantity: 1 }
  ], MEASURES);
  assert.equal(lineMeasures[1].status, 'missing');
  assert.deepEqual(freight.missingCodes, ['X', 'Z']);
  assert.equal(freight.carriers, null);
});

test('J&T: moi thung = max(40k, 4k x the tich quy doi, kg x 4k); cuoc dong = cuoc thung x so thung', () => {
  // 100 sp/thung, 0,01 m3/sp => 1 m3/thung => 1e6 cm3 / 6000 x 4k = 666.667; 0,5 kg/sp => 50 kg => 200.000.
  const measures = new Map([
    ['a', { perCarton: 100, m3PerUnit: 0.01, kgPerUnit: 0.5 }],
    ['b', { perCarton: 10, m3PerUnit: 0.0001, kgPerUnit: 0.01 }],
    ['c', { perCarton: 10, m3PerUnit: 0.0001, kgPerUnit: 20 }]
  ]);
  const { freight } = buildOrderFreight([
    { productCode: 'A', quantity: 200 }, { productCode: 'B', quantity: 10 }, { productCode: 'C', quantity: 10 }
  ], measures);
  const { JT } = freight.carriers;
  assert.equal(JT.label, 'J&T');
  assert.equal(JT.surcharge, 0);
  // A: 2 thung x 666.667 | B: 1 thung, the tich 0,001 m3 -> 667 < 40k -> 40k | C: 200 kg x 4k = 800.000
  assert.equal(JT.steps.length, 3);
  assert.equal(JT.total, Math.round(2 * (1e6 / 6000) * 4000) + 40000 + 800000);
});

test('J&T: SL > 0 nhung lam tron 0 thung van tinh toi thieu 1 thung; dong dich vu bi bo qua', () => {
  const measures = new Map([['a', { perCarton: 100, m3PerUnit: 0.0001, kgPerUnit: 0 }]]);
  const { freight } = buildOrderFreight([
    { productCode: 'A', quantity: 10 }, { productCode: 'VAT8', quantity: 1, isService: true }
  ], measures);
  assert.equal(freight.carriers.JT.total, 40000);
});
