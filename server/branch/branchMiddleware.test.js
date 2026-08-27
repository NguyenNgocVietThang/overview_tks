const test = require('node:test');
const assert = require('node:assert');

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'hn-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { BRANCHES } = require('./branches');
const { resolveBranch, currentBranchFor, BRANCH_COOKIE_NAME } = require('./branchMiddleware');

function run(user, cookieValue) {
  const req = { user, cookies: cookieValue ? { [BRANCH_COOKIE_NAME]: cookieValue } : {} };
  const res = {
    statusCode: 200,
    body: null,
    cookies: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value) { this.cookies[name] = value; }
  };
  let nexted = false;
  resolveBranch(req, res, () => { nexted = true; });
  return { req, res, nexted };
}

test('tai khoan chua gan co so bi chan 403 BRANCH_UNASSIGNED', () => {
  const { res, nexted } = run({ coSo: '' });
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'BRANCH_UNASSIGNED');
});

test('cookie tro toi co so khong duoc phep thi rot ve co so mac dinh', () => {
  const { req, res, nexted } = run({ coSo: 'Hà Nội' }, BRANCHES.SAIGON);
  assert.equal(nexted, true);
  assert.equal(req.branch, BRANCHES.HANOI);
  assert.equal(res.cookies[BRANCH_COOKIE_NAME], BRANCHES.HANOI);
});

test('cookie hop le duoc ton trong voi tai khoan phu trach ca hai co so', () => {
  const { req, nexted } = run({ coSo: 'Cả hai' }, BRANCHES.SAIGON);
  assert.equal(nexted, true);
  assert.equal(req.branch, BRANCHES.SAIGON);
});

test('khong co cookie thi dung co so dau tien va viet lai cookie', () => {
  const { req, res } = run({ coSo: 'Cả hai' });
  assert.equal(req.branch, BRANCHES.HANOI);
  assert.equal(res.cookies[BRANCH_COOKIE_NAME], BRANCHES.HANOI);
});

test('currentBranchFor dung chung logic nhung khong ghi cookie', () => {
  const req = { cookies: { [BRANCH_COOKIE_NAME]: BRANCHES.SAIGON } };
  assert.equal(currentBranchFor(req, { coSo: 'Cả hai' }), BRANCHES.SAIGON);
  assert.equal(currentBranchFor(req, { coSo: 'Hà Nội' }), BRANCHES.HANOI);
  assert.equal(currentBranchFor(req, { coSo: '' }), null);
});
