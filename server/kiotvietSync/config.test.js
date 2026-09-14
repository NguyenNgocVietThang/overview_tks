'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfiguredBranches } = require('./config');

const KEYS = ['KIOTVIET_CLIENT_ID', 'KIOTVIET_CLIENT_SECRET', 'KIOTVIET_RETAILER',
  'KIOTVIET_CLIENT_ID_SG', 'KIOTVIET_CLIENT_SECRET_SG', 'KIOTVIET_RETAILER_SG'];

function withEnv(values, fn) {
  const old = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try { return fn(); } finally {
    KEYS.forEach((key) => old[key] === undefined ? delete process.env[key] : process.env[key] = old[key]);
  }
}

test('returns Hanoi then Saigon and applies the existing SG credential fallback', () => withEnv({
  KIOTVIET_CLIENT_ID: 'hn-id', KIOTVIET_CLIENT_SECRET: 'hn-secret', KIOTVIET_RETAILER: 'hn-shop',
  KIOTVIET_RETAILER_SG: 'sg-shop'
}, () => {
  assert.deepEqual(getConfiguredBranches(), [
    { branch: 'hanoi', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'hn-shop' },
    { branch: 'saigon', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'sg-shop' }
  ]);
}));

test('skips only incomplete Saigon configuration without throwing', () => withEnv({
  KIOTVIET_CLIENT_ID: 'hn-id', KIOTVIET_CLIENT_SECRET: 'hn-secret', KIOTVIET_RETAILER: 'hn-shop'
}, () => {
  const warnings = [];
  assert.deepEqual(getConfiguredBranches({ warn: (message) => warnings.push(message) }), [
    { branch: 'hanoi', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'hn-shop' }
  ]);
  assert.match(warnings.join(' '), /saigon/i);
}));

test('returns an empty list and warnings when neither branch is complete', () => withEnv({}, () => {
  const warnings = [];
  assert.deepEqual(getConfiguredBranches({ warn: (message) => warnings.push(message) }), []);
  assert.equal(warnings.length, 2);
}));
