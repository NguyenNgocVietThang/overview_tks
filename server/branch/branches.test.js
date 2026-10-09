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

test('allowedBranches: ai cung xem duoc ca hai co so, khong phu thuoc coSo', () => {
  const both = [BRANCHES.HANOI, BRANCHES.SAIGON];
  assert.deepEqual(allowedBranches({ coSo: 'Cả hai' }), both);
  assert.deepEqual(allowedBranches({ coSo: 'Tân Phú' }), both);
  assert.deepEqual(allowedBranches({ vaiTro: 'Lái xe', coSo: '' }), both);
  assert.deepEqual(allowedBranches(null), both);
});

test('isBranchAllowed chi nhan co so vat ly; defaultBranch luon la Ca hai', () => {
  assert.equal(isBranchAllowed({ coSo: 'Hà Nội' }, BRANCHES.SAIGON), true);
  assert.equal(isBranchAllowed({ coSo: 'Hà Nội' }, BRANCH_BOTH), false);
  assert.equal(defaultBranch({ coSo: 'Cả hai' }), BRANCH_BOTH);
  assert.equal(defaultBranch({ coSo: 'Tân Phú' }), BRANCH_BOTH);
  assert.equal(defaultBranch({ coSo: 'Hà Nội' }), BRANCH_BOTH);
  assert.equal(defaultBranch({ coSo: 'Sài Gòn' }), BRANCH_BOTH);
  assert.equal(defaultBranch({ coSo: '' }), BRANCH_BOTH);
  assert.equal(defaultBranch(null), BRANCH_BOTH);
});

test('selectableBranches luon gom 2 co so va Ca hai', () => {
  const all = [BRANCHES.HANOI, BRANCHES.SAIGON, BRANCH_BOTH];
  assert.deepEqual(selectableBranches({ coSo: 'Cả hai' }), all);
  assert.deepEqual(selectableBranches({ coSo: 'Hà Nội' }), all);
  assert.deepEqual(selectableBranches({ coSo: '' }), all);
});

test('resolveBranchScope chi mo rong lua chon Ca hai, khong chap nhan gia tri khac', () => {
  assert.deepEqual(resolveBranchScope(BRANCH_BOTH), [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(resolveBranchScope(BRANCHES.HANOI), [BRANCHES.HANOI]);
  assert.deepEqual(resolveBranchScope(BRANCHES.SAIGON), [BRANCHES.SAIGON]);
  assert.deepEqual(resolveBranchScope('Da Nang'), []);
});
