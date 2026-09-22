const test = require('node:test');
const assert = require('node:assert');
const {
  BRANCHES,
  BRANCH_BOTH,
  normalizeCoSo,
  allowedBranches,
  selectableBranches,
  isBranchAllowed,
  resolveBranchScope,
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
  assert.deepEqual(allowedBranches({ vaiTro: 'Lái xe', coSo: '' }), []);
  assert.deepEqual(allowedBranches(null), []);
});

test('allowedBranches mac dinh Quan ly ve Ca hai khi chua duoc gan co so', () => {
  assert.deepEqual(allowedBranches({ vaiTro: 'Quản lý', coSo: '' }), [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(allowedBranches({ vaiTro: 'Quản lý' }), [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(allowedBranches({ vaiTro: 'Quản lý', coSo: 'Sài Gòn' }), [BRANCHES.SAIGON]);
});

test('isBranchAllowed va defaultBranch', () => {
  assert.equal(isBranchAllowed({ coSo: 'Hà Nội' }, BRANCHES.SAIGON), false);
  assert.equal(isBranchAllowed({ coSo: 'Cả hai' }, BRANCHES.SAIGON), true);
  assert.equal(defaultBranch({ coSo: 'Cả hai' }), BRANCH_BOTH);
  assert.equal(defaultBranch({ coSo: 'Tân Phú' }), BRANCHES.SAIGON);
  assert.equal(defaultBranch({ coSo: '' }), null);
});

test('selectableBranches chi them Ca hai cho tai khoan co du hai co so vat ly', () => {
  assert.deepEqual(allowedBranches({ coSo: 'Cả hai' }), [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(selectableBranches({ coSo: 'Cả hai' }), [BRANCHES.HANOI, BRANCHES.SAIGON, BRANCH_BOTH]);
  assert.deepEqual(selectableBranches({ vaiTro: 'Quản lý', coSo: '' }), [BRANCHES.HANOI, BRANCHES.SAIGON, BRANCH_BOTH]);
  assert.deepEqual(selectableBranches({ coSo: 'Hà Nội' }), [BRANCHES.HANOI]);
});

test('resolveBranchScope chi mo rong lua chon Ca hai, khong chap nhan gia tri khac', () => {
  assert.deepEqual(resolveBranchScope(BRANCH_BOTH), [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(resolveBranchScope(BRANCHES.HANOI), [BRANCHES.HANOI]);
  assert.deepEqual(resolveBranchScope(BRANCHES.SAIGON), [BRANCHES.SAIGON]);
  assert.deepEqual(resolveBranchScope('Da Nang'), []);
});
