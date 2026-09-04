'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBranchConfigs } = require('./branchConfig');

function fakeLogger() {
  const warnings = [];
  return { warnings, warn: (msg) => warnings.push(msg) };
}

test('loadBranchConfigs tra ve ca 2 chi nhanh khi du bien moi truong', () => {
  const env = {
    KIOTVIET_CLIENT_ID: 'hn-id',
    KIOTVIET_CLIENT_SECRET: 'hn-secret',
    KIOTVIET_RETAILER: 'CHhanoi',
    KIOTVIET_CLIENT_ID_SG: 'sg-id',
    KIOTVIET_CLIENT_SECRET_SG: 'sg-secret',
    KIOTVIET_RETAILER_SG: 'CHsaigon'
  };
  const logger = fakeLogger();

  const branches = loadBranchConfigs(env, logger);

  assert.deepEqual(branches, [
    { code: 'hanoi', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'CHhanoi' },
    { code: 'saigon', clientId: 'sg-id', clientSecret: 'sg-secret', retailer: 'CHsaigon' }
  ]);
  assert.deepEqual(logger.warnings, []);
});

test('loadBranchConfigs bo qua Sai Gon va canh bao log khi thieu bien _SG, khong throw', () => {
  const env = {
    KIOTVIET_CLIENT_ID: 'hn-id',
    KIOTVIET_CLIENT_SECRET: 'hn-secret',
    KIOTVIET_RETAILER: 'CHhanoi'
  };
  const logger = fakeLogger();

  const branches = loadBranchConfigs(env, logger);

  assert.deepEqual(branches, [
    { code: 'hanoi', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'CHhanoi' }
  ]);
  assert.equal(logger.warnings.length, 1);
  assert.match(logger.warnings[0], /Sai Gon/);
});

test('loadBranchConfigs bo qua Ha Noi va canh bao log khi thieu bien Ha Noi, khong throw', () => {
  const env = {
    KIOTVIET_CLIENT_ID_SG: 'sg-id',
    KIOTVIET_CLIENT_SECRET_SG: 'sg-secret',
    KIOTVIET_RETAILER_SG: 'CHsaigon'
  };
  const logger = fakeLogger();

  const branches = loadBranchConfigs(env, logger);

  assert.deepEqual(branches, [
    { code: 'saigon', clientId: 'sg-id', clientSecret: 'sg-secret', retailer: 'CHsaigon' }
  ]);
  assert.equal(logger.warnings.length, 1);
  assert.match(logger.warnings[0], /Ha Noi/);
});

test('loadBranchConfigs tra ve mang rong va canh bao ca hai khi thieu toan bo bien moi truong', () => {
  const logger = fakeLogger();
  const branches = loadBranchConfigs({}, logger);

  assert.deepEqual(branches, []);
  assert.equal(logger.warnings.length, 2);
});

test('loadBranchConfigs bo qua chi nhanh khi thieu mot phan bien (vd co ID nhung thieu SECRET)', () => {
  const env = {
    KIOTVIET_CLIENT_ID: 'hn-id',
    KIOTVIET_RETAILER: 'CHhanoi'
    // thieu KIOTVIET_CLIENT_SECRET
  };
  const logger = fakeLogger();

  const branches = loadBranchConfigs(env, logger);

  assert.deepEqual(branches, []);
  assert.equal(logger.warnings.length, 2);
});

test('loadBranchConfigs mac dinh dung process.env va console khi khong truyen tham so', () => {
  const branches = loadBranchConfigs();
  assert.ok(Array.isArray(branches));
});
