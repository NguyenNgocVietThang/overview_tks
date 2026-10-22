'use strict';

// Quyen "Kiem tra gia ban": xem / giai thich (dung nhom khach hien tai) / Chot.

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePermissions } = require('../auth/featureRegistry');
const A = require('./priceAuditAccess');

const user = (vaiTro, hoTen, featurePermissions = {}) => {
  const u = { vaiTro, hoTen, featurePermissions };
  return { ...u, permissions: resolvePermissions(u) };
};

test('canView: Quan ly / Tro ly / Nhan vien sale mac dinh; Ke toan khong; thieu reports.invoices thi mat', () => {
  assert.equal(A.canView(user('Quản lý', 'QL')), true);
  assert.equal(A.canView(user('Trợ lý', 'TL')), true);
  assert.equal(A.canView(user('Nhân viên sale', 'S')), true);
  assert.equal(A.canView(user('Kế toán', 'KT')), false);
  assert.equal(A.canView(user('Nhân viên sale', 'S', { 'reports.invoices': false })), false);
  assert.equal(A.canView(null), false);
});

test('canExplain: quyen giai thich ap dung moi hoa don, khong phu thuoc nhom khach hay ten', () => {
  const sale = user('Nhân viên sale', 'Duy  Thái');
  assert.equal(A.canExplain(sale, 'Duy Thái'), true);
  assert.equal(A.canExplain(sale, '  duy   THÁI '), true);
  assert.equal(A.canExplain(sale, 'Duy Thái'), true, 'NFKC hop dau to hop');
  assert.equal(A.canExplain(sale, 'Duy Thái - 1234567890'), true, 'hau to ID Telegram bo ca hai phia');
  assert.equal(A.canExplain(sale, 'Minh Anh'), true);
  assert.equal(A.canExplain(sale, 'Duy Thai'), true);
  assert.equal(A.canExplain(sale, 'Duy Thái 2'), true);
  assert.equal(A.canExplain(sale, ''), true);
  assert.equal(A.canExplain(sale, null), true);
  assert.equal(A.canExplain(user('Nhân viên sale', ''), ''), true);
  assert.equal(A.canExplain(user('Nhân viên sale', '  '), '  '), true);
  assert.equal(A.canExplain(null, 'Duy Thái'), false);
});

test('canExplain/canDecide: Quan ly chot duoc nhung KHONG tu co quyen giai thich; Tro ly khong chot', () => {
  const ql = user('Quản lý', 'Duy Thái');
  assert.equal(A.canDecide(ql), true);
  assert.equal(A.canExplain(ql, 'Duy Thái'), false);
  assert.equal(A.canDecide(user('Trợ lý', 'TL')), false);
  assert.equal(A.canDecide(user('Nhân viên sale', 'S')), false);
});

test('cap rieng / thu hoi quyen: Tro ly duoc cap decide + explain; Sale bi thu hoi explain; thu hoi view keo theo', () => {
  const tl = user('Trợ lý', 'Duy Thái', { 'reports.invoices.priceAudit.decide': true, 'reports.invoices.priceAudit.explain': true });
  assert.equal(A.canDecide(tl), true);
  assert.equal(A.canExplain(tl, 'Duy Thái'), true);
  assert.equal(A.canExplain(user('Nhân viên sale', 'Duy Thái', { 'reports.invoices.priceAudit.explain': false }), 'Duy Thái'), false);
  const noView = user('Quản lý', 'QL', { 'reports.invoices.priceAudit': false });
  assert.equal(A.canView(noView), false);
  assert.equal(A.canDecide(noView), false);
});

test('withCapabilities: dien quyen theo dong, Chot chi dong sai goc, bo currentSaleGroup', () => {
  const row = { originalStatus: 'wrong', currentSaleGroup: 'Duy Thái', canEditExplanation: false, canDecide: false };
  const sale = A.withCapabilities(user('Nhân viên sale', 'Duy Thái'), row);
  assert.equal(sale.canEditExplanation, true);
  assert.equal(sale.canDecide, false);
  assert.equal('currentSaleGroup' in sale, false);
  const ql = user('Quản lý', 'QL');
  assert.equal(A.withCapabilities(ql, row).canDecide, true);
  assert.equal(A.withCapabilities(ql, { ...row, originalStatus: 'correct' }).canDecide, false);
});
