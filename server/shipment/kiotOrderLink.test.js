'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retailerHosts, kiotOrderUrl, normalizeRetailer } = require('./kiotOrderLink');

test('retailerHosts: moi co so mot ten mien, doc tu bien moi truong', () => {
  assert.deepEqual(retailerHosts({ KIOTVIET_RETAILER: 'CHhanoi', KIOTVIET_RETAILER_SG: 'CHsaigon' }),
    { HN: 'chhanoi.kiotviet.vn', SG: 'chsaigon.kiotviet.vn' });
});

test('retailerHosts: thieu bien SG thi dung chung gian hang HN (nhu kiotvietSync/config.js)', () => {
  assert.deepEqual(retailerHosts({ KIOTVIET_RETAILER: 'CHhanoi' }),
    { HN: 'chhanoi.kiotviet.vn', SG: 'chhanoi.kiotviet.vn' });
});

test('retailerHosts: khong co bien nao -> null, giao dien khong hien nut', () => {
  assert.deepEqual(retailerHosts({}), { HN: null, SG: null });
});

test('normalizeRetailer: chan gia tri env khong phai mot subdomain thuan', () => {
  assert.equal(normalizeRetailer('CHhanoi'), 'chhanoi');
  assert.equal(normalizeRetailer('  CHhanoi  '), 'chhanoi');
  assert.equal(normalizeRetailer('kho-ha-noi-2'), 'kho-ha-noi-2');
  // Nhung dang nay se bien duong dan thanh host/duong dan khac -> phai bi loai.
  assert.equal(normalizeRetailer('https://chhanoi.kiotviet.vn'), null);
  assert.equal(normalizeRetailer('chhanoi.kiotviet.vn'), null);
  assert.equal(normalizeRetailer('chhanoi/man'), null);
  assert.equal(normalizeRetailer('evil@host'), null);
  assert.equal(normalizeRetailer('-chhanoi'), null);
  assert.equal(normalizeRetailer(''), null);
  assert.equal(normalizeRetailer(undefined), null);
});

test('kiotOrderUrl: loc danh sach Dat hang theo ma don, ma duoc ma hoa', () => {
  const env = { KIOTVIET_RETAILER: 'CHhanoi', KIOTVIET_RETAILER_SG: 'CHsaigon' };
  assert.equal(kiotOrderUrl('HN', 'DH041173', env), 'https://chhanoi.kiotviet.vn/man/#/Orders?code=DH041173');
  assert.equal(kiotOrderUrl('SG', 'DH041173', env), 'https://chsaigon.kiotviet.vn/man/#/Orders?code=DH041173');
  assert.equal(kiotOrderUrl('HN', 'DH 04/11', env), 'https://chhanoi.kiotviet.vn/man/#/Orders?code=DH%2004%2F11');
});

test('kiotOrderUrl: thieu co so, ma don hoac cau hinh -> null (khong doan bua)', () => {
  const env = { KIOTVIET_RETAILER: 'CHhanoi' };
  assert.equal(kiotOrderUrl('HN', '', env), null);
  assert.equal(kiotOrderUrl('HN', '   ', env), null);
  assert.equal(kiotOrderUrl('HN', null, env), null);
  assert.equal(kiotOrderUrl('XX', 'DH041173', env), null);
  assert.equal(kiotOrderUrl('HN', 'DH041173', {}), null);
});

test('khong co khoa/secret nao trong dia chi', () => {
  const env = { KIOTVIET_RETAILER: 'CHhanoi', KIOTVIET_CLIENT_ID: 'id', KIOTVIET_CLIENT_SECRET: 'secret' };
  const url = kiotOrderUrl('HN', 'DH041173', env);
  assert.equal(url.includes('secret'), false);
  assert.equal(url.includes('id=') || url.includes('token'), false);
});
