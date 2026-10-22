'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  customerLevelFromEmail,
  hasFullVat,
  isExcludedProduct,
  isFreightCustomer,
  normalizeCustomerName,
  FREIGHT_CUSTOMERS,
} = require('./priceAuditRules');

test('cap khach tu email: vua/lon/vip, bo dau, hoa thuong, khoang trang', () => {
  assert.equal(customerLevelFromEmail('Vừa@gmail.com'), 'medium');
  assert.equal(customerLevelFromEmail('abc@gmail.com'), 'medium');
  assert.equal(customerLevelFromEmail('Lớn@gmail.com'), 'large');
  assert.equal(customerLevelFromEmail('lon@x.vn'), 'large');
  assert.equal(customerLevelFromEmail(' VIP @gmail.com'), 'vip');
  assert.equal(customerLevelFromEmail('V I P@gmail.com'), 'vip');
});

test('cap khach: khong co email = Lon; email la = Vua; chi phan truoc @ duoc xet', () => {
  for (const v of ['', null, undefined, '   ', 42]) {
    assert.equal(customerLevelFromEmail(v), 'large', String(v));
  }
  for (const v of ['vipx@gmail.com', 'a@vip.com', 'vip.nguyen@gmail.com']) {
    assert.equal(customerLevelFromEmail(v), 'medium', String(v));
  }
  assert.equal(customerLevelFromEmail('vip'), 'vip');
});

test('Full VAT: nhieu bien the, ghi chu dong hoac hoa don', () => {
  assert.equal(hasFullVat(' FULL   VAT ', ''), true);
  assert.equal(hasFullVat('', 'fullvat'), true);
  assert.equal(hasFullVat('Full Vat', null), true);
  assert.equal(hasFullVat('giao sang, FULLVAT.', ''), true);
  assert.equal(hasFullVat('FULL\tVAT', ''), true);
  assert.equal(hasFullVat('Vat', ''), true);
  assert.equal(hasFullVat('', 'khach lay VAT 8%'), true);
});

test('Full VAT: khong co / khong co ranh gioi tu thi sai', () => {
  assert.equal(hasFullVat('', ''), false);
  assert.equal(hasFullVat(null, undefined), false);
  assert.equal(hasFullVat('gia full', 'full'), false);
  assert.equal(hasFullVat('invat', 'vats'), false);
  assert.equal(hasFullVat('unfullvat', ''), false);
  assert.equal(hasFullVat('fullvatx', ''), false);
  assert.equal(hasFullVat('fullvatà', ''), false);
  assert.equal(hasFullVat('àfullvat', ''), false);
});

test('bo qua OD/PK chi khi nam trong ngoac', () => {
  assert.equal(isExcludedProduct('Hàng phụ (pk)'), 'pk');
  assert.equal(isExcludedProduct('Hàng (OD)'), 'od');
  assert.equal(isExcludedProduct('Hàng ( Od )'), 'od');
  assert.equal(isExcludedProduct('Hàng (PK) loai 2'), 'pk');
  assert.equal(isExcludedProduct('Hàng OD'), null);
  assert.equal(isExcludedProduct('PK ABC'), null);
  assert.equal(isExcludedProduct('Hang [OD]'), null);
  assert.equal(isExcludedProduct('Hàng (ODX)'), null);
  assert.equal(isExcludedProduct(''), null);
  assert.equal(isExcludedProduct(null), null);
});

test('khach bao cuoc: khop toan bo ten sau chuan hoa, giu dau', () => {
  assert.equal(FREIGHT_CUSTOMERS.length, 10);
  assert.equal(isFreightCustomer('KMN Tín Phong Shop'), true);
  assert.equal(isFreightCustomer('  kmn   tín phong  SHOP '), true);
  assert.equal(isFreightCustomer('KMN C Thư Sóc Trăng'), true);
  assert.equal(isFreightCustomer('KMN Jinlong + ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN'), true);
  assert.equal(isFreightCustomer('KH HENG - ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN'), true);
  // NFC khac NFD van khop
  assert.equal(isFreightCustomer('KMN Tín Phong Shop'.normalize('NFD')), true);
});

test('khach bao cuoc: khong khop chuoi con, mat dau, hoac ten khac', () => {
  assert.equal(isFreightCustomer('KMN Tin Phong Shop'), false);
  assert.equal(isFreightCustomer('KMN Tín Phong Shop 2'), false);
  assert.equal(isFreightCustomer('Tín Phong'), false);
  assert.equal(isFreightCustomer('KMN Jinlong'), false);
  assert.equal(isFreightCustomer(''), false);
  assert.equal(isFreightCustomer(null), false);
});

test('normalizeCustomerName', () => {
  assert.equal(normalizeCustomerName('  KMN   Tín Phong '), 'kmn tín phong');
  assert.equal(normalizeCustomerName(null), '');
});
