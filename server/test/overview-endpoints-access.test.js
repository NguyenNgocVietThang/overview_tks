'use strict';
// Quyen truy cap cac API cua tab "Tong quan" (routes.js): Nhan vien sale chi co quyen
// reports.overview nhung muc 2 (doanh thu theo khach) + muc 3 (Bao cao hang hoa) nam ngay
// trong tab nay nen cac API CHI DOC cua chung phai mo theo quyen Tong quan; con API cua muc 4
// (quet dut hang, nhap Tra NCC duoi /api/products) va cac tab khac van phai bi chan.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const { signToken } = require('../auth/authService');
const localUserStore = require('../auth/localUserStore');
const effectiveUserResolver = require('../auth/effectiveUserResolver');

const testUsers = new Map();
localUserStore.getUserById = async id => testUsers.get(String(id)) || null;
effectiveUserResolver.resolveUser = async user => user;
delete require.cache[require.resolve('../auth/authMiddleware')];
delete require.cache[require.resolve('../routes')];
const { AUTH_COOKIE_NAME } = require('../auth/authMiddleware');
const router = require('../routes');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  res.cookie = () => res;
  return res;
}

function reqAs(vaiTro) {
  const id = `ov-${vaiTro}`;
  const user = { id, username: id, hoTen: 'Người dùng', vaiTro, coSo: 'Cả hai', trangThai: 'Đang hoạt động' };
  testUsers.set(id, user);
  return { cookies: { [AUTH_COOKIE_NAME]: signToken(user) }, query: {}, body: {}, headers: {} };
}

/**
 * Chay lan luot moi middleware (requireAuth -> requireFeature -> resolveBranch...) gan voi
 * duong dan `urlPath` trong router; tra ve true neu di het ma khong bi chan (toi duoc handler).
 */
async function passesGuards(urlPath, vaiTro) {
  const req = reqAs(vaiTro);
  const res = fakeRes();
  const layers = router.stack.filter(layer => !layer.route && layer.regexp && layer.regexp.test(urlPath));
  assert.ok(layers.length > 0, `phai co guard cho ${urlPath}`);
  for (const layer of layers) {
    let calledNext = false;
    await layer.handle(req, res, () => { calledNext = true; });
    if (!calledNext) return { allowed: false, status: res.statusCode };
  }
  return { allowed: true, status: res.statusCode };
}

const OVERVIEW_READ_ENDPOINTS = [
  '/api/dashboard',
  '/api/inventory-value-history',
  '/api/customer-suggest',
  '/api/customer-product-top',
  '/api/customer-product-revenue',
  '/api/product-report',
  '/api/product-report/customers'
];

const SALE_BLOCKED_ENDPOINTS = [
  '/api/products/supplier-returns/import-status',
  '/api/products/supplier-returns/import',
  '/api/products/stockout-recent/scan',
  '/api/products/stockout-90d/scan',
  '/api/export',
  '/api/invoice-detail'
];

for (const urlPath of OVERVIEW_READ_ENDPOINTS) {
  test(`Nhân viên sale (quyền Tổng quan) gọi được ${urlPath}`, async () => {
    const result = await passesGuards(urlPath, 'Nhân viên sale');
    assert.equal(result.allowed, true, `sale bi chan ${urlPath} (status ${result.status})`);
  });

  test(`Nhân viên marketing (không có quyền báo cáo nào) bị chặn ở ${urlPath}`, async () => {
    const result = await passesGuards(urlPath, 'Nhân viên marketing');
    assert.equal(result.allowed, false);
    assert.equal(result.status, 403);
  });

  test(`Trợ lý vẫn gọi được ${urlPath}`, async () => {
    const result = await passesGuards(urlPath, 'Trợ lý');
    assert.equal(result.allowed, true);
  });
}

for (const urlPath of SALE_BLOCKED_ENDPOINTS) {
  test(`Nhân viên sale KHÔNG gọi được ${urlPath} (mục 4 / tab khác vẫn cần quyền riêng)`, async () => {
    const result = await passesGuards(urlPath, 'Nhân viên sale');
    assert.equal(result.allowed, false);
    assert.equal(result.status, 403);
  });
}

test('Quản lý vẫn gọi được cả API mục 4 (quét đứt hàng, nhập Trả NCC)', async () => {
  for (const urlPath of ['/api/products/supplier-returns/import-status', '/api/products/stockout-recent/scan']) {
    const result = await passesGuards(urlPath, 'Quản lý');
    assert.equal(result.allowed, true, urlPath);
  }
});
