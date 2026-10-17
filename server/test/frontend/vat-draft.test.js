'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { resolvePermissions, PAGE_FEATURES } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '../../public');
const html = fs.readFileSync(path.join(publicDir, 'vat-draft/index.html'), 'utf8');
const code = fs.readFileSync(path.join(publicDir, 'vat-draft/vat-draft.js'), 'utf8');
const nav = fs.readFileSync(path.join(publicDir, 'shared/shared-nav.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const GIA_NHAP = 'GIÁ NHÁP\n(Giá bán/(1+%VAT))';

const ALLOC_COLUMNS = ['Trạng thái', 'MÃ SP', 'TÊN SP', 'Mã VAT', 'TÊN VAT', 'Mã hóa đơn', 'Ghi chú hàng hóa', 'Ghi chú tổng',
  'NGUỒN', 'TỒN CÒN NHÁP', 'Giá bán', 'TÊN KẾ TOÁN', 'ĐVT', 'SL', GIA_NHAP, '%VAT', 'Thành tiền'];
const allocRow = (status, maSp, sl, nguon, reason = '') => ({
  values: [status, maSp, 'Tên ' + maSp, 'VAT01', 'Tên VAT', 'HD1', 'màu xanh', 'giao sáng', nguon, 150, 10800, 'KT1', 'Cái', sl, 10000, 8.000000000000002, 2160000],
  reason
});

function api(overrides = {}) {
  return {
    'GET /meta': { masterData: { loadedAt: '2026-10-17T02:00:00Z', stale: false, stockRows: 8432, mappingRows: 2998, error: null },
      sync: [{ branch: 'hanoi', entity: 'invoices', syncedAt: new Date().toISOString() }],
      vietqr: { template: 'compact2', commonBankCodes: 'VCB, MB', accounts: [{ key: 'tks_group', label: 'MB TKS — MB 606266688888' }, { key: 'shc', label: 'MB SHC — MB 525345345' }] } },
    'GET /documents': { rows: [
      { kind: 'invoice', branch: 'hanoi', code: 'HD028345', date: '16/10/2026 14:54', customerName: 'KH A', customerCode: 'KH1', note: 'thắng thức 16/10', status: 'Hoàn thành', orderCode: 'DH1', total: 82582000, lineCount: 13 },
      { kind: 'order', branch: 'saigon', code: 'DH050000', date: '16/10/2026 11:00', customerName: 'Chị Lan', customerCode: '', note: '', status: 'Phiếu tạm', orderCode: '', total: 45000, lineCount: 1 }
    ], total: 2, page: 1, pageSize: 50 },
    'POST /documents/resolve': { found: [{ kind: 'order', branch: 'hanoi', code: 'DH044391', selectable: true, warning: 'Đơn đã xuất hóa đơn: HD028345' }], notFound: ['HD999'], ambiguous: [], invalid: ['ABC'] },
    'POST /allocate': { hasMeta: true, columns: ALLOC_COLUMNS,
      rows: [allocRow('OK', 'SP01', 150, 'TKS THẤP'), allocRow('OK', 'SP01', 50, 'VC'), allocRow('Không có mã', 'KHONGCO', 10, '', "Không tìm thấy Mã SP 'KHONGCO'.")],
      metrics: { inputCount: 2, okProducts: 1, shortageProducts: 0, missingCount: 1 },
      qr: { transferContent: 'HD028345 DH050000',
        bySource: [{ nguon: 'TKS THẤP', soDong: 1, tongGiaNhap: 1500000, thieuDonGia: false, defaultAccountKey: 'tks_group', defaultAmount: 1500000 },
          { nguon: 'VC', soDong: 1, tongGiaNhap: 500000, thieuDonGia: true, defaultAccountKey: 'shc', defaultAmount: 500000 }],
        total: { soDong: 2, tongGiaBan: 2160000, thieuDonGia: false, defaultAccountKey: 'tks_group', defaultAmount: 2160000 } },
      masterData: { stockRows: 8432, mappingRows: 2998 } },
    'POST /qr/url': { url: 'https://img.vietqr.io/image/MB-606266688888-compact2.png?amount=1500000', amount: 1500000, accountLabel: 'MB TKS', addInfo: 'HD028345 DH050000' },
    ...overrides
  };
}

async function setup(t, { hash = '#xu-ly', responses = api(), vaiTro = 'Quản lý' } = {}) {
  const dom = new JSDOM(html, { url: 'https://tokosi.test/vat-draft/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const window = dom.window;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.URL.createObjectURL = () => 'blob:x';
  window.URL.revokeObjectURL = () => {};
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/table-controls.js'), 'utf8'));
  window.eval(nav);
  const user = { vaiTro, branch: 'Cả hai', permissions: resolvePermissions({ vaiTro }), pageFeatures: PAGE_FEATURES };
  window.TKSNav.authGuard = async () => { window.TKSNav.setPermissions(user); return user; };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(url, window.location.href);
    const key = `${options.method || 'GET'} ${parsed.pathname.replace('/api/vat-draft', '')}`;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ key, query: Object.fromEntries(parsed.searchParams), body });
    const data = responses[key];
    return {
      ok: data !== undefined, status: data !== undefined ? 200 : 404,
      headers: { get: () => key === 'POST /export' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json' },
      json: async () => data ?? { error: 'Không có' },
      blob: async () => new window.Blob(['x'])
    };
  };
  window.eval(code);
  await window.TKSVatDraft.init();
  await tick();
  return { window, doc: window.document, calls };
}

test('tai trang: trang thai Sheets/KiotViet, mac dinh 7 ngay, danh sach chung tu co ghi chu tong', async t => {
  const { doc, calls } = await setup(t);
  assert.match(doc.getElementById('vdSheetsStatus').textContent, /Gộp VAT 8,432 dòng · Khớp mã 2,998 dòng/);
  const list = calls.find(c => c.key === 'GET /documents');
  assert.equal(list.query.kind, 'all');
  assert.equal(list.query.branch, 'all', 'user Ca hai -> loc ca hai co so');
  assert.match(list.query.from, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(Math.round((Date.parse(list.query.to) - Date.parse(list.query.from)) / 86400000), 6);
  const rows = doc.querySelectorAll('#vdDocsRows tr[data-key]');
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /thắng thức 16\/10/);
  assert.match(rows[1].textContent, /Sài Gòn/);
  assert.equal(doc.getElementById('vdRunDocs').disabled, true);
  assert.equal(doc.querySelector('.vd-tabs [aria-current="page"]').dataset.vatDraftTab, 'xu-ly');
  assert.ok(doc.querySelector('#sidebar a[href="/vat-draft/#xu-ly"]'), 'sidebar co nhom Ke toan');
});

test('tick chon, dan ma -> chip theo thu tu chon; canh bao ma khong tim thay', async t => {
  const { doc, window, calls } = await setup(t);
  doc.querySelector('#vdDocsRows tr[data-key] td:nth-child(2)').click();
  assert.equal(doc.getElementById('vdSelectedCount').textContent, 'Đã chọn 1 chứng từ');
  doc.getElementById('vdCodesInput').value = 'DH044391 HD999 abc';
  doc.getElementById('vdAddCodes').click();
  await tick(); await tick();
  assert.deepEqual(calls.find(c => c.key === 'POST /documents/resolve').body, { text: 'DH044391 HD999 abc' });
  assert.deepEqual([...doc.querySelectorAll('#vdChips li span')].map(s => s.textContent), ['HD028345', 'DH044391']);
  const message = doc.getElementById('vdCodesMessage').textContent;
  assert.match(message, /Đơn đã xuất hóa đơn: HD028345/);
  assert.match(message, /Không tìm thấy: HD999/);
  assert.match(message, /Không phải mã HD\/DH: ABC/);
  assert.equal(doc.getElementById('vdRunDocs').disabled, false);
  assert.equal(JSON.parse(window.sessionStorage.getItem('tks-vat-draft-selection')).length, 2);
});

test('xu ly chung tu: bang co Ghi chu tong canh Ghi chu hang hoa, ly do khi re chuot, QR dien san ma chung tu', async t => {
  const { doc, calls } = await setup(t);
  doc.querySelector('#vdDocsRows tr[data-key] input').click();
  doc.getElementById('vdRunDocs').click();
  await tick(); await tick();
  assert.deepEqual(calls.find(c => c.key === 'POST /allocate').body, { source: 'documents', documents: [{ kind: 'invoice', branch: 'hanoi', code: 'HD028345' }] });
  assert.equal(doc.getElementById('vdAllocResult').hidden, false);
  const headers = [...doc.querySelectorAll('#vdAllocTable thead th')].map(th => th.querySelector('.sort-label') ? th.querySelector('.sort-label').textContent : th.textContent);
  assert.equal(headers.indexOf('Ghi chú tổng'), headers.indexOf('Ghi chú hàng hóa') + 1);
  assert.ok([...doc.querySelectorAll('#vdAllocTable thead th')].every(th => th.dataset.columnKey));
  const missing = doc.querySelector('#vdAllocRows tr:nth-child(3) td');
  assert.equal(missing.className, 'vd-status-missing');
  assert.equal(missing.title, "Không tìm thấy Mã SP 'KHONGCO'.");
  assert.equal(doc.getElementById('vdMetricMissing').textContent, '1');
  assert.match(doc.getElementById('vdAllocBanner').textContent, /1 OK · 1 không có mã/);
  assert.equal(doc.getElementById('vdTransfer').value, 'HD028345 DH050000');
  const cards = doc.querySelectorAll('[data-qr-card]');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('[data-qr-amount]').value, '1,500,000 đ');
  assert.equal(cards[1].querySelector('[data-qr-account]').value, 'shc');
  assert.match(cards[1].textContent, /thiếu Giá bán/);
  doc.querySelector('[data-qr-mode="khong_vat"]').click();
  assert.equal(doc.querySelectorAll('[data-qr-card]').length, 1);
  assert.equal(doc.querySelector('[data-qr-amount]').value, '2,160,000 đ');
  doc.querySelector('[data-qr-generate]').click();
  await tick(); await tick();
  assert.deepEqual(calls.find(c => c.key === 'POST /qr/url').body, { accountKey: 'tks_group', amount: '2160000', addInfo: 'HD028345 DH050000' });
  assert.ok(doc.querySelector('[data-qr-result] img').src.startsWith('https://img.vietqr.io/'));

  // Bam anh QR -> phong to; Esc dong; nut Tai ma QR tai anh ve.
  doc.querySelector('[data-qr-zoom]').click();
  const viewer = doc.getElementById('vdQrViewer');
  assert.equal(viewer.hidden, false);
  assert.equal(doc.getElementById('vdQrViewerImg').src, 'https://img.vietqr.io/image/MB-606266688888-compact2.png?amount=1500000');
  assert.match(doc.getElementById('vdQrViewerCaption').textContent, /Tất cả nguồn — 1,500,000đ/);
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(viewer.hidden, true);
  doc.querySelector('[data-qr-download]').click();
  await tick(); await tick();
  assert.ok(calls.some(c => c.key.startsWith('GET /image/MB-606266688888-compact2.png')), 'tai anh QR ve');
});

test('sap xep 2 cot nhu app cu, xuat Excel theo dung thu tu dang hien thi', async t => {
  const { doc, window, calls } = await setup(t);
  doc.querySelector('#vdDocsRows tr[data-key] input').click();
  doc.getElementById('vdRunDocs').click();
  await tick(); await tick();
  const choose = (id, value) => { doc.getElementById(id).value = value; doc.getElementById(id).dispatchEvent(new window.Event('change')); };
  const column = name => [...doc.querySelectorAll('#vdAllocRows tr')].map(tr => tr.children[ALLOC_COLUMNS.indexOf(name)].firstChild.textContent);
  // Chi chon cot phu -> nhac chon cot chinh truoc, chua sap xep.
  choose('vdSortSecondary', 'SL');
  assert.match(doc.getElementById('vdSortNote').textContent, /Chọn cột sắp xếp chính trước/);
  assert.deepEqual(column('SL'), ['150', '50', '10']);
  // Chinh: Trang thai giam dan, phu: SL tang dan.
  choose('vdSortPrimary', 'Trạng thái');
  choose('vdSortPrimaryDir', 'desc');
  assert.deepEqual(column('Trạng thái'), ['OK', 'OK', 'Không có mã']);
  assert.deepEqual(column('SL'), ['50', '150', '10']);
  assert.match(doc.getElementById('vdSortNote').textContent, /Đang sắp xếp theo cột đã chọn/);
  choose('vdSortPrimary', 'SL');
  choose('vdSortPrimaryDir', 'asc');
  assert.equal(doc.querySelector('#vdAllocTable thead th[title="GIÁ NHÁP (Giá bán/(1+%VAT))"]').dataset.defaultWidth, '96');
  doc.getElementById('vdAllocExcel').click();
  await tick();
  const exported = calls.find(c => c.key === 'POST /export').body;
  assert.equal(exported.view, 'allocation');
  const slIndex = exported.columns.indexOf('SL');
  assert.deepEqual(exported.rows.map(r => r[slIndex]), [10, 50, 150]);
});

test('CSV giu dinh dang so cua pandas (repr float), BOM, xuong dong trong o duoc bao nhay kep', async t => {
  const { window } = await setup(t);
  const { pyFloatRepr, csvCell } = window.TKSVatDraft;
  assert.equal(pyFloatRepr(150), '150.0');
  assert.equal(pyFloatRepr(8.000000000000002), '8.000000000000002');
  assert.equal(pyFloatRepr(10648.15), '10648.15');
  assert.equal(csvCell(GIA_NHAP, GIA_NHAP), '"GIÁ NHÁP\n(Giá bán/(1+%VAT))"');
  assert.equal(csvCell('Ghi chú hàng hóa', 'a, "b"'), '"a, ""b"""');
  assert.equal(csvCell('SL', null), '');
});

test('tab Tao QR: tai khoan nhap tay can du ma ngan hang + so TK, hash doi tab', async t => {
  const { doc, window } = await setup(t, { hash: '#tao-qr' });
  assert.equal(doc.getElementById('vdInputPanel').hidden, true);
  assert.equal(doc.getElementById('vdQrPage').hidden, false);
  const select = doc.getElementById('vdManualAccount');
  assert.equal(select.value, '__manual__');
  assert.equal(doc.getElementById('vdManualGenerate').disabled, true);
  doc.getElementById('vdManualBank').value = 'ACB';
  doc.getElementById('vdManualBank').dispatchEvent(new window.Event('input'));
  doc.getElementById('vdManualNo').value = '123456';
  doc.getElementById('vdManualNo').dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('vdManualGenerate').disabled, false);
  select.value = 'shc';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(doc.getElementById('vdManualFields').hidden, true);
  const changed = new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
  window.location.hash = 'tra-cuu';
  await changed;
  assert.equal(doc.getElementById('vdInputPanel').hidden, false);
  assert.match(doc.getElementById('vdRunDocs').textContent, /Tra cứu nguồn/);
});

test('loi may chu hien ro cho nguoi dung', async t => {
  const responses = api();
  delete responses['POST /allocate'];
  const { doc } = await setup(t, { responses });
  doc.querySelector('[data-input-mode="paste"]').click();
  doc.getElementById('vdPasteInvoice').value = 'SP01\tA\t1';
  doc.getElementById('vdRunPasteInvoice').click();
  await tick(); await tick();
  assert.equal(doc.getElementById('vdRunError').textContent, 'Không có');
});

test('bo loc Co so: doi sang Sai Gon thi tai lai danh sach va dan ma theo dung co so', async t => {
  const { doc, window, calls } = await setup(t);
  const select = doc.getElementById('vdBranch');
  select.value = 'saigon';
  select.dispatchEvent(new window.Event('change'));
  await tick(); await tick();
  assert.equal(calls.filter(c => c.key === 'GET /documents').pop().query.branch, 'saigon');
  doc.getElementById('vdCodesInput').value = 'DH044391';
  doc.getElementById('vdAddCodes').click();
  await tick(); await tick();
  assert.equal(calls.find(c => c.key === 'POST /documents/resolve').query.branch, 'saigon');
});

test('bam tieu de: bang chung tu sap xep o may chu; bang ket qua dong bo o "Sắp xếp chính"; so dung dau phay', async t => {
  const { doc, calls } = await setup(t);
  assert.match(doc.querySelector('#vdDocsRows tr td:last-child').textContent, /^82,582,000$/);
  const totalButton = () => doc.querySelector('#vdDocsTable th[data-column-key="total"] [data-sort-field]');
  totalButton().click();
  await tick(); await tick();
  let list = calls.filter(c => c.key === 'GET /documents').pop().query;
  assert.deepEqual([list.sort, list.dir, list.page], ['total', 'asc', '1']);
  assert.equal(totalButton().querySelector('.sort-indicator').textContent, '▼');
  totalButton().click();
  await tick(); await tick();
  assert.equal(calls.filter(c => c.key === 'GET /documents').pop().query.dir, 'desc');
  totalButton().click();
  await tick(); await tick();
  list = calls.filter(c => c.key === 'GET /documents').pop().query;
  assert.equal(list.sort, '', 'bam lan 3 bo sap xep');

  doc.querySelector('#vdDocsRows tr[data-key] input').click();
  doc.getElementById('vdRunDocs').click();
  await tick(); await tick();
  const slButton = () => doc.querySelector('#vdAllocTable [data-sort-field="SL"]');
  slButton().click();
  assert.equal(doc.getElementById('vdSortPrimary').value, 'SL');
  assert.equal(doc.getElementById('vdSortPrimaryDir').value, 'asc');
  assert.deepEqual([...doc.querySelectorAll('#vdAllocRows tr')].map(tr => tr.children[13].textContent), ['10', '50', '150']);
  slButton().click();
  assert.equal(doc.getElementById('vdSortPrimaryDir').value, 'desc');
  assert.equal(slButton().querySelector('.sort-indicator').textContent, '▲');
  slButton().click();
  assert.equal(doc.getElementById('vdSortPrimary').value, '');
  assert.equal(doc.querySelector('#vdAllocRows tr td:nth-child(11)').textContent, '10,800');
});

test('bang luon vua khung: do rong cot theo ti le %, bang 100%', async t => {
  const { doc, window } = await setup(t);
  const table = doc.getElementById('vdDocsTable');
  window.TKSTables.refresh(table);
  assert.equal(table.dataset.tableFit, 'contain');
  assert.equal(table.style.width, '100%');
  const widths = [...table.querySelectorAll(':scope > colgroup > col')].map(col => col.style.width);
  assert.ok(widths.length && widths.every(w => w.endsWith('%')), widths.join());
  const sum = widths.reduce((s, w) => s + parseFloat(w), 0);
  assert.ok(Math.abs(sum - 100) < 0.01, String(sum));
});
