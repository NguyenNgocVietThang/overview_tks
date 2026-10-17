'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFreight, buildOrderFreight } = require('./freightCalculator');

test('DM is max(350k minimum, volume x 550k, kg x 1.833)', () => {
  assert.equal(calculateFreight({ m3: 0.5, kg: 100 }).DM.total, 350000);
  assert.equal(calculateFreight({ m3: 0.5, kg: 300 }).DM.total, 549900);
  assert.equal(calculateFreight({ m3: 1, kg: 600 }).DM.total, 1099800);
  assert.equal(calculateFreight({ m3: 2, kg: 600 }).DM.total, 1100000);
});
test('VL is max(volume, kg x 1.550) plus 200k below 2 m3', () => {
  assert.equal(calculateFreight({ m3: 0.6, kg: 5 }).VL.total, 700000);
  assert.equal(calculateFreight({ m3: 0.3, kg: 400 }).VL.total, 820000);
  assert.equal(calculateFreight({ m3: 1, kg: 5 }).VL.total, 665000);
  assert.equal(calculateFreight({ m3: 1, kg: 600 }).VL.total, 1130000);
  assert.equal(calculateFreight({ m3: 2, kg: 5 }).VL.total, 930000);
  assert.equal(calculateFreight({ m3: 2, kg: 1000 }).VL.total, 1550000);
});
test('VL withChanh adds 490k delivery to chanh + 70k ticket without changing the base variant', () => {
  const { VL } = calculateFreight({ m3: 1, kg: 5 });
  assert.equal(VL.total, 665000);
  assert.equal(VL.withChanh.total, 665000 + 490000 + 70000);
  assert.deepEqual(VL.withChanh.steps.slice(-2).map(item => item.amount), [490000, 70000]);
  assert.equal(VL.steps.length, VL.withChanh.steps.length - 2);
  assert.equal(calculateFreight({ m3: 1, kg: 5 }).DM.withChanh, undefined);
});
test('no usable measurements has no carrier estimates', () => {
  const { freight, lineMeasures } = buildOrderFreight([{ productCode: 'X', quantity: 2 }], new Map());
  assert.deepEqual(freight.carriers, { DM: null, VL: null, JT: null });
  assert.equal(lineMeasures[0].m3, null);
  assert.equal(lineMeasures[0].kg, null);
});
test('partial measurements remain independent and still produce provisional freight', () => {
  const measures = new Map([
    ['a', { m3PerUnit: null, kgPerUnit: 2 }],
    ['b', { m3PerUnit: 0.01, kgPerUnit: null }]
  ]);
  const { freight, lineMeasures } = buildOrderFreight([
    { productCode: 'A', quantity: 2 }, { productCode: 'B', quantity: 3 },
    { productCode: 'X', quantity: 1 }, { productCode: 'VAT', quantity: 1, isService: true }
  ], measures);
  assert.equal(lineMeasures[0].m3, null);
  assert.equal(lineMeasures[0].kg, 4);
  assert.equal(lineMeasures[0].missingVolume, true);
  assert.equal(lineMeasures[1].missingWeight, true);
  assert.deepEqual(freight.totals, { m3: 0.03, kg: 4 });
  assert.deepEqual(freight.missingCodes, ['A', 'B', 'X']);
  assert.equal(freight.provisional, true);
  assert.equal(freight.carriers.JT.total, 36000);
  assert.equal(freight.carriers.DM.provisional, true);
  assert.equal(freight.carriers.VL.withChanh.provisional, true);
  assert.equal(lineMeasures[3].status, 'service');
});
test('JT uses ordered units, no carton rounding or minimum, and sums per-code maxima', () => {
  const measures = new Map([
    ['a', { perCarton: 100, m3PerUnit: 0.0001, kgPerUnit: 0.01 }],
    ['b', { perCarton: 100, m3PerUnit: 0.00001, kgPerUnit: 2 }]
  ]);
  const { freight } = buildOrderFreight([{ productCode: 'A', quantity: 10 }, { productCode: 'B', quantity: 10 }], measures);
  assert.equal(freight.carriers.JT.total, Math.round(0.001 * 1e6 / 6000 * 4000 + 20 * 4000));
  assert.equal(freight.provisional, false);
  assert.equal(freight.carriers.JT.steps.length, 2);
  assert.ok(!freight.carriers.JT.note.includes('40k'));
});
test('weight-only orders can still estimate carriers', () => {
  const { freight } = buildOrderFreight([{ productCode: 'A', quantity: 400 }], new Map([['a', { kgPerUnit: 1, m3PerUnit: null }]]));
  assert.equal(freight.carriers.DM.total, 733200);
  assert.equal(freight.carriers.VL.total, 820000);
  assert.equal(freight.carriers.VL.withChanh.total, 1380000);
  assert.equal(freight.carriers.JT.total, 1600000);
});

test('JT combines duplicate SKU lines and rounds only the final sum', () => {
  const measures = new Map([
    ['a', { m3PerUnit: 0.000001, kgPerUnit: 0.0001 }],
    ['b', { m3PerUnit: 0.000001, kgPerUnit: 0.0001 }]
  ]);
  const { freight } = buildOrderFreight([
    { productCode: ' A ', quantity: 0.5 }, { productCode: 'a', quantity: 0.5 },
    { productCode: 'B', quantity: 1 }
  ], measures);
  assert.equal(freight.carriers.JT.steps.length, 2);
  assert.equal(freight.carriers.JT.total, 1);
});
