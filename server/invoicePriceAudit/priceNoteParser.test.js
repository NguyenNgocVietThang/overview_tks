'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePriceNote, parseMoney, normalizeText } = require('./priceNoteParser');

test('mau T30 co o trong -T -- giu vi tri va bo bac trong', () => {
  const r = parsePriceNote('T30 # 4/10 # 1T -169000 | 2T- 168000 | 3T- 167000 | -T -- | VAT+16800đ');
  assert.deepEqual(r.tiers, [
    { position: 1, cartons: '1', unitPrice: '169000' },
    { position: 2, cartons: '2', unitPrice: '168000' },
    { position: 3, cartons: '3', unitPrice: '167000' },
  ]);
  assert.equal(r.cartonSize, '30');
  assert.equal(r.vatPerUnit, '16800');
  assert.equal(r.updatedLabel, '4/10');
});

test('mau T100 bon bac, VAT va ngay cap nhat', () => {
  const r = parsePriceNote('T100 # 16/10 # 1T -24000 | 3T- 23800 | 5T- 23600 | 10T-23000 | VAT+2000đ');
  assert.equal(r.cartonSize, '100');
  assert.equal(r.updatedLabel, '16/10');
  assert.equal(r.vatPerUnit, '2000');
  assert.deepEqual(r.tiers, [
    { position: 1, cartons: '1', unitPrice: '24000' },
    { position: 2, cartons: '3', unitPrice: '23800' },
    { position: 3, cartons: '5', unitPrice: '23600' },
    { position: 4, cartons: '10', unitPrice: '23000' },
  ]);
});

test('o trong o giua khong day bac sau len vi tri truoc', () => {
  const r = parsePriceNote('T30 # 1/1 # 1T -100 | -T -- | 3T- 90');
  assert.deepEqual(r.tiers, [
    { position: 1, cartons: '1', unitPrice: '100' },
    { position: 3, cartons: '3', unitPrice: '90' },
  ]);
});

test('khong co bac nao hoac khong co gia -> tiers rong, khong sinh gia 0', () => {
  const r = parsePriceNote('T30 # 4/10 # -T -- | -T -- | -T -- | VAT+0');
  assert.deepEqual(r.tiers, []);
  assert.equal(r.vatPerUnit, '0');
});

test('dau phan cach hang nghin, hau to d/dong, hoa thuong va khoang trang', () => {
  const r = parsePriceNote('t100 # 16/10 # 1t - 24.000 | 3T-23,800 đồng | vat +2.000 d');
  assert.equal(r.cartonSize, '100');
  assert.deepEqual(r.tiers, [
    { position: 1, cartons: '1', unitPrice: '24000' },
    { position: 2, cartons: '3', unitPrice: '23800' },
  ]);
  assert.equal(r.vatPerUnit, '2000');
});

test('so khong hop le -> null, khong doc mot phan thanh gia khac', () => {
  const r = parsePriceNote('T100 # 16/10 # 1T -24x000 | 2T- 23.00 | 3T- 1.23.456 | VAT+abc');
  assert.deepEqual(r.tiers, []);
  assert.equal(r.vatPerUnit, null);
});

test('thieu thanh phan -> null', () => {
  assert.deepEqual(parsePriceNote('1T -100 | 2T- 90'), {
    cartonSize: null,
    tiers: [
      { position: 1, cartons: '1', unitPrice: '100' },
      { position: 2, cartons: '2', unitPrice: '90' },
    ],
    vatPerUnit: null,
    updatedLabel: null,
  });
});

test('rong/null/khong phai chuoi -> ket qua rong', () => {
  for (const v of ['', '   ', null, undefined, 123]) {
    assert.deepEqual(parsePriceNote(v), { cartonSize: null, tiers: [], vatPerUnit: null, updatedLabel: null });
  }
});

test('mo ta tu do co chu so khong suy ra gia', () => {
  const r = parsePriceNote('Hang moi ve 2024, thung 48 cai, gia 12000');
  assert.deepEqual(r.tiers, []);
  assert.equal(r.cartonSize, null);
  assert.equal(r.vatPerUnit, null);
});

test('parseMoney tra decimal string hoac null', () => {
  assert.equal(parseMoney('24.000đ'), '24000');
  assert.equal(parseMoney('1,234,567'), '1234567');
  assert.equal(parseMoney('0'), '0');
  assert.equal(parseMoney('12.5'), null);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('--'), null);
});

test('normalizeText: NFKC, hoa thuong, gop khoang trang', () => {
  assert.equal(normalizeText('  FULL    VAT '), 'full vat');
});
