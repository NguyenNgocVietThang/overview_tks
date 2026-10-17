'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const registry = require('../auth/featureRegistry');
const { ROLES } = require('../auth/userRepository');
const { BRANCH_COOKIE_NAME } = require('../branch/branchMiddleware');
const { createVatDraftRouter } = require('./vatDraftRoutes');

const stock = (rowIndex, nguon, maVat, tenKt, ton, thueVat = 0.08) => ({
  rowIndex, nguon, maKiotDaiDien: '', tenKiotDaiDien: '', maVatKiot: maVat, tenVatKiot: 'Tên VAT', tenKeToan: tenKt, donViTinh: 'Cái',
  tonDauNgay: ton, giaBan: 0, thueVat, thueNk: null, tongThueMat: null, tongDangNhap: 0, tonCoTheNhap: ton,
  maVatKiotNorm: maVat.toLowerCase(), tenKeToanNorm: tenKt.toLowerCase(), donViTinhNorm: 'cái'
});
const mapping = (maSp, maVat) => ({ rowIndex: 2, maSp, tenSp: `Tên ${maSp}`, maVatKiot: maVat, tenTruocVat: '', maSpNorm: maSp.toLowerCase(), maVatKiotNorm: maVat.toLowerCase() });

const MASTER = {
  stockRows: [stock(2, 'TKS THẤP', 'VAT01', 'KT1', 150), stock(3, 'VC', 'VAT01', 'KT2', 100), stock(4, 'SHC', 'VAT02', 'KT3', 5)],
  mappingRows: [mapping('SP01', 'VAT01'), mapping('SP02', 'VAT02')],
  warnings: [],
  loadedAt: Date.parse('2026-10-17T02:00:00Z'),
  stale: false
};

function fakeRepository(overrides = {}) {
  const calls = {};
  return {
    calls,
    listDocuments: async args => { calls.list = args; return { rows: [], total: 0, page: 1, pageSize: 50 }; },
    resolveCodes: async args => { calls.resolve = args; return { found: [], notFound: args.codes, ambiguous: [] }; },
    readDocumentLines: async selections => {
      calls.read = selections;
      return [
        { kind: 'invoice', branch: 'hanoi', code: 'HD1', status: 'Hoàn thành', docNote: 'giao sáng', lines: [
          { productCode: 'SP01', productName: 'Sản phẩm 1', quantity: '200', unitPrice: '10800', lineTotal: '2160000', note: 'màu xanh' },
          { productCode: '', productName: 'dòng trống', quantity: '1', unitPrice: '1', lineTotal: '1', note: '' }
        ] },
        { kind: 'order', branch: 'hanoi', code: 'DH2', status: 'Phiếu tạm', docNote: '', lines: [
          { productCode: 'SP02', productName: 'Sản phẩm 2', quantity: '50', unitPrice: '9000', lineTotal: '450000', note: '' },
          { productCode: 'KHONGCO', productName: 'Không có', quantity: '10', unitPrice: '8000', lineTotal: '80000', note: '' }
        ] }
      ];
    },
    syncStatus: async () => [{ branch: 'hanoi', entity: 'invoices', syncedAt: '2026-10-17T02:00:00Z' }],
    ...overrides
  };
}

function fakeMaster({ fail = false } = {}) {
  return {
    get: async () => { if (fail) { const e = new Error('Sheet không còn chia sẻ công khai'); e.statusCode = 503; e.code = 'SHEET_NOT_PUBLIC'; throw e; } return MASTER; },
    refresh: async () => ({ ...MASTER, loadedAt: Date.parse('2026-10-17T03:00:00Z') })
  };
}

function userFor(vaiTro, featurePermissions) {
  const user = { username: 'u1', vaiTro, featurePermissions, trangThai: 'Đang hoạt động' };
  return { ...user, permissions: registry.resolvePermissions(user) };
}

async function request(path, { user = userFor(ROLES.QUAN_LY), method = 'GET', body, repository = fakeRepository(), masterData = fakeMaster() } = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    req.user = user;
    req.effectiveUserResolved = !!user;
    req.cookies = { [BRANCH_COOKIE_NAME]: 'Cả hai' };
    next();
  });
  app.use('/api/vat-draft', createVatDraftRouter({ repository, masterData }));
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/vat-draft${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  } finally {
    server.close();
  }
}

test('phan quyen: chua dang nhap 401; Ke toan 403; Ke toan duoc cap rieng / Quan ly / admin 200; Khach du cap van 403', async () => {
  assert.equal((await request('/meta', { user: null })).status, 401);
  const accountant = await request('/meta', { user: userFor(ROLES.KE_TOAN) });
  assert.equal(accountant.status, 403);
  assert.equal(accountant.body.code, 'FEATURE_FORBIDDEN');
  assert.equal((await request('/meta', { user: userFor(ROLES.KE_TOAN, { 'accounting.vatDraft': true }) })).status, 200);
  assert.equal((await request('/meta')).status, 200);
  const admin = { username: 'admin', vaiTro: ROLES.KE_TOAN };
  assert.equal((await request('/meta', { user: { ...admin, permissions: registry.resolvePermissions(admin) } })).status, 200);
  assert.equal((await request('/meta', { user: userFor(ROLES.KHACH, { 'accounting.vatDraft': true }) })).status, 403);
});

test('GET /meta: trang thai master data, dong bo, danh sach tai khoan', async () => {
  const res = await request('/meta');
  assert.deepEqual([res.body.masterData.stockRows, res.body.masterData.mappingRows, res.body.masterData.error], [3, 2, null]);
  assert.equal(res.body.sync[0].entity, 'invoices');
  assert.equal(res.body.vietqr.accounts.length, 17);
  const broken = await request('/meta', { masterData: fakeMaster({ fail: true }) });
  assert.equal(broken.status, 200);
  assert.match(broken.body.masterData.error, /chia sẻ công khai/);
});

test('GET /documents va POST /documents/resolve dung co so tu cookie (Ca hai -> hanoi + saigon)', async () => {
  const repository = fakeRepository();
  await request('/documents?kind=order&from=2026-10-10&to=2026-10-17&q=lan', { repository });
  assert.deepEqual(repository.calls.list, { branchCodes: ['hanoi', 'saigon'], kind: 'order', from: '2026-10-10', to: '2026-10-17', q: 'lan', page: undefined, pageSize: undefined });
  const res = await request('/documents/resolve', { method: 'POST', body: { text: 'hd1, HD2 abc' }, repository });
  assert.deepEqual(repository.calls.resolve.codes, ['HD1', 'HD2']);
  assert.deepEqual(res.body.invalid, ['ABC']);
});

test('POST /allocate tu chung tu: cot co Ma hoa don + Ghi chu tong canh Ghi chu hang hoa, ly do loi, QR dien san ma', async () => {
  const repository = fakeRepository();
  const res = await request('/allocate', { method: 'POST', repository, body: { source: 'documents', documents: [{ kind: 'invoice', branch: 'hanoi', code: 'hd1' }, { kind: 'order', branch: 'hanoi', code: 'DH2' }] } });
  assert.equal(res.status, 200);
  assert.deepEqual(repository.calls.read.map(s => s.code), ['HD1', 'DH2']);
  const { columns, rows, metrics, qr } = res.body;
  const col = name => columns.indexOf(name);
  assert.equal(col('Ghi chú tổng'), col('Ghi chú hàng hóa') + 1);
  assert.deepEqual(rows.map(r => [r.values[col('Trạng thái')], r.values[col('Mã hóa đơn')], r.values[col('NGUỒN')], r.values[col('SL')], r.values[col('Ghi chú tổng')]]), [
    ['OK', 'HD1', 'TKS THẤP', 150, 'giao sáng'],
    ['OK', 'HD1', 'VC', 50, 'giao sáng'],
    ['Thiếu tồn', 'DH2', 'SHC', 50, ''],
    ['Không có mã', 'DH2', '', 10, '']
  ]);
  assert.equal(rows[0].values[col('Ghi chú hàng hóa')], 'màu xanh');
  assert.equal(rows[3].reason, "Không tìm thấy Mã SP 'KHONGCO'.");
  assert.deepEqual(metrics, { inputCount: 3, okProducts: 1, shortageProducts: 1, missingCount: 1 });
  assert.equal(qr.transferContent, 'HD1 DH2');
  assert.deepEqual(qr.bySource.map(s => [s.nguon, s.defaultAccountKey, s.defaultAmount]), [['TKS THẤP', 'tks_group', 1500000], ['VC', 'mb_vc_ex', 500000]]);
  assert.equal(qr.total.defaultAmount, 2160000);
});

test('POST /allocate dan tay: bo cot cu, khong noi dung CK; loi dau vao 400; sheet loi 503', async () => {
  const res = await request('/allocate', { method: 'POST', body: { source: 'paste', text: 'SP01\tSản phẩm 1\t100\t10800' } });
  assert.equal(res.status, 200);
  assert.ok(!res.body.columns.includes('Ghi chú tổng') && !res.body.columns.includes('Mã hóa đơn'));
  assert.equal(res.body.qr.transferContent, '');
  assert.equal((await request('/allocate', { method: 'POST', body: { source: 'paste', text: '  ' } })).status, 400);
  assert.equal((await request('/allocate', { method: 'POST', body: { source: 'documents', documents: [] } })).status, 400);
  const down = await request('/allocate', { method: 'POST', body: { source: 'paste', text: 'SP01\t\t1' }, masterData: fakeMaster({ fail: true }) });
  assert.equal(down.status, 503);
  assert.equal(down.body.code, 'SHEET_NOT_PUBLIC');
});

test('POST /lookup: tra moi nguon, dong loi rieng', async () => {
  const res = await request('/lookup', { method: 'POST', body: { source: 'paste', text: 'Mã SP\tTên\nSP01\t\t3\t1000\nKHONGCO' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.length, 2);
  assert.deepEqual(res.body.rows[1].slice(0, 4), ['', '', '', '']);
  assert.deepEqual(res.body.issues, [[2, 'KHONGCO', '', "Không tìm thấy Mã SP 'KHONGCO'."]]);
});

test('POST /export tra file xlsx; cot la bi tu choi', async () => {
  const ok = await request('/export', { method: 'POST', body: { view: 'lookupIssues', columns: ['Dòng nhập', 'Mã SP', 'Tên SP', 'Nội dung'], rows: [[1, '=HYPERLINK("x")', 'A', 'B']] } });
  assert.equal(ok.status, 200);
  assert.match(ok.type, /spreadsheetml/);
  assert.equal(ok.body.subarray(0, 2).toString(), 'PK');
  const bad = await request('/export', { method: 'POST', body: { view: 'lookup', columns: ['password'], rows: [] } });
  assert.equal(bad.status, 400);
});

test('POST /qr/url va /qr/parse-text', async () => {
  const res = await request('/qr/url', { method: 'POST', body: { accountKey: 'shc', amount: '1.134.000 đ', addInfo: 'HD1 HD2' } });
  assert.equal(res.body.url, 'https://img.vietqr.io/image/MB-525345345-compact2.png?amount=1134000&addInfo=HD1%20HD2&accountName=CONG%20TY%20SHC');
  assert.equal((await request('/qr/url', { method: 'POST', body: { manual: { bankId: 'VCB/x', accountNo: '1' } } })).status, 400);
  const manual = await request('/qr/url', { method: 'POST', body: { manual: { bankId: 'ACB', accountNo: '123456' }, amount: '0' } });
  assert.equal(manual.body.url, 'https://img.vietqr.io/image/ACB-123456-compact2.png?amount=&addInfo=');
  const parsed = await request('/qr/parse-text', { method: 'POST', body: { text: 'Đơn vị bán hàng (Seller): CÔNG TY CỔ PHẦN THƯƠNG MẠI VC EXPRESS\nTổng cộng tiền thanh toán (Total payment): 4.850.064' } });
  assert.deepEqual([parsed.body.totalPayment, parsed.body.matchedAccountKeys], [4850064, ['mb_vc_ex']]);
});
