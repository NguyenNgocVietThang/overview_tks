const test = require('node:test');
const assert = require('node:assert');
const {
  BRANCHES,
  BRANCH_BOTH,
  normalizeCoSo,
  allowedBranches,
  isBranchAllowed,
  defaultBranch
} = require('./branches');

test('normalizeCoSo map ten kho cu sang ten co so', () => {
  assert.equal(normalizeCoSo('An Khánh'), BRANCHES.HANOI);
  assert.equal(normalizeCoSo('  Tân Phú '), BRANCHES.SAIGON);
  assert.equal(normalizeCoSo('Hà Nội'), BRANCHES.HANOI);
  assert.equal(normalizeCoSo('Cả hai'), BRANCH_BOTH);
  assert.equal(normalizeCoSo(''), '');
  assert.equal(normalizeCoSo(null), '');
  assert.equal(normalizeCoSo('Đà Nẵng'), '');
});

test('allowedBranches mo rong "Cả hai" va chan tai khoan chua gan co so', () => {
  assert.deepEqual(allowedBranches({ coSo: 'Cả hai' }), [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(allowedBranches({ coSo: 'Tân Phú' }), [BRANCHES.SAIGON]);
  assert.deepEqual(allowedBranches({ coSo: '' }), []);
  assert.deepEqual(allowedBranches(null), []);
});

test('isBranchAllowed va defaultBranch', () => {
  assert.equal(isBranchAllowed({ coSo: 'Hà Nội' }, BRANCHES.SAIGON), false);
  assert.equal(isBranchAllowed({ coSo: 'Cả hai' }, BRANCHES.SAIGON), true);
  assert.equal(defaultBranch({ coSo: 'Cả hai' }), BRANCHES.HANOI);
  assert.equal(defaultBranch({ coSo: 'Tân Phú' }), BRANCHES.SAIGON);
  assert.equal(defaultBranch({ coSo: '' }), null);
});
