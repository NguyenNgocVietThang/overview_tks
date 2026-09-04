'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchBranchRows, computeStartDelayMs } = require('./runSyncEngine');

test('matchBranchRows: ghep dung branchConfig (env) voi dong branches (DB) theo code', () => {
  const branchConfigs = [
    { code: 'hanoi', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'CHhanoi' },
    { code: 'saigon', clientId: 'sg-id', clientSecret: 'sg-secret', retailer: 'CHsaigon' }
  ];
  const branchRows = [
    { id: 1, code: 'hanoi', kiotviet_retailer: 'CHhanoi' },
    { id: 2, code: 'saigon', kiotviet_retailer: 'CHsaigon' }
  ];

  const matched = matchBranchRows(branchConfigs, branchRows);

  assert.equal(matched.length, 2);
  assert.deepEqual(matched[0].branch, { id: 1, code: 'hanoi', kiotvietRetailer: 'CHhanoi' });
  assert.deepEqual(matched[0].config, branchConfigs[0]);
});

test('matchBranchRows: bo qua branchConfig khong co dong branches tuong ung, khong throw', () => {
  const branchConfigs = [
    { code: 'hanoi', clientId: 'hn-id', clientSecret: 'hn-secret', retailer: 'CHhanoi' },
    { code: 'danang', clientId: 'dn-id', clientSecret: 'dn-secret', retailer: 'CHdanang' }
  ];
  const branchRows = [{ id: 1, code: 'hanoi', kiotviet_retailer: 'CHhanoi' }];

  const matched = matchBranchRows(branchConfigs, branchRows);

  assert.equal(matched.length, 1);
  assert.equal(matched[0].branch.code, 'hanoi');
});

test('matchBranchRows: tra ve mang rong khi khong co branchConfig nao', () => {
  const matched = matchBranchRows([], [{ id: 1, code: 'hanoi', kiotviet_retailer: 'CHhanoi' }]);
  assert.deepEqual(matched, []);
});

test('computeStartDelayMs: branch dau tien (index 0) khong lech gio', () => {
  assert.equal(computeStartDelayMs(0, 90000), 0);
});

test('computeStartDelayMs: branch thu 2 (index 1) lech nua fastIntervalMs', () => {
  assert.equal(computeStartDelayMs(1, 90000), 45000);
});
