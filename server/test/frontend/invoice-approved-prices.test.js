'use strict';

// Muc 2 "Bang gia duyet" cua tab Hoa don: quyen xem / tao-sua-xoa, loc Nguoi duyet + Ngay duyet Tu-Den, sort moi cot,
// hop Tao / Sua (chi chon khach / ma SP tu goi y, Ten SP tu nhay, ngay mac dinh hom nay, nguoi duyet dropdown),
// xac nhan truoc khi xoa va xuat Excel theo bo loc + sort dang dung.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(publicDir, 'invoice-approved-prices.js'), 'utf8');
const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setImmediate(r)); };
const APPROVERS = ['Anh Quân', 'Anh Duy', 'Anh Duy Khánh'];
const VIEW = 'reports.invoices.approvedPrice';
const MANAGE = 'reports.invoices.approvedPrice.manage';

function rec(id, over = {}) {
  return {
    id: String(id), branch: 'hanoi', branchLabel: 'Hà Nội', customerId: '1', customerName: 'Khách Vừa', customerCode: 'KH1',
    customerMissing: false, productId: '1', productCode: 'T100', productName: 'Ly giữ nhiệt', approvedPrice: '23500',
    approver: 'Anh Quân', approvedOn: '2026-10-19', version: 1, ...over
  };
}

function fakeServer({ rows = [rec(1), rec(2, { customerName: 'An Khách', approver: 'Anh Duy', approvedPrice: '50000', approvedOn: '2026-10-21', productId: '2', productCode: 'T200', productName: 'Bình nước' })] } = {}) {
  const server = { rows: rows.map(r => ({ ...r })), requests: [], nextId: 100 };
  server.list = params => {
    let all = server.rows.filter(r => (!params.get('approver') || r.approver === params.get('approver'))
      && (!params.get('from') || r.approvedOn >= params.get('from')) && (!params.get('to') || r.approvedOn <= params.get('to')));
    const sort = params.get('sort');
    if (sort) {
      const dir = params.get('dir') === 'desc' ? -1 : 1;
      all = [...all].sort((a, b) => (String(a[sort]).localeCompare(String(b[sort]), 'vi', { numeric: true })) * dir);
    }
    const pageSize = Number(params.get('pageSize') || 50);
    const page = Number(params.get('page') || 1);
    return { rows: all.slice((page - 1) * pageSize, page * pageSize).map(r => ({ ...r })), totalRows: all.length, page, pageSize,
      kpis: { records: all.length, customers: new Set(all.map(r => r.customerId)).size, products: new Set(all.map(r => r.productId)).size,
        latestApprovedOn: all.map(r => r.approvedOn).sort().at(-1) || null },
      filters: {}, options: { approvers: APPROVERS }, canManage: true };
  };
  return server;
}

function createPage({ permissions = [VIEW, MANAGE, 'reports.export', 'reports.invoices'], server = fakeServer(), confirm = () => true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/reports/#invoices' });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  w.Chart = class { static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } }; constructor(c, config) { this.config = config; } destroy() {} };
  w.setInterval = () => 1;
  w.requestAnimationFrame = cb => cb();
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
  w.EventSource = class { addEventListener() {} close() {} };
  const confirms = [];
  const downloads = [];
  w.confirm = message => { confirms.push(message); return confirm(message); };
  w.URL.createObjectURL = () => 'blob:fake';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  w.TKSNav = { authGuard: () => new Promise(() => {}), can: key => permissions.includes(key), handleBranchError: () => false, renderTopSidebar() {} };
  const toasts = [];

  w.fetch = (url, options = {}) => {
    const href = String(url);
    const method = (options.method || 'GET').toUpperCase();
    server.requests.push({ href, method, body: options.body ? JSON.parse(options.body) : null });
    const respond = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body, blob: async () => ({ size: 1 }) });
    if (!href.startsWith('/api/invoice-approved-prices')) return new Promise(() => {});
    const [pathPart, query = ''] = href.split('?');
    const params = new URLSearchParams(query);
    const sub = pathPart.replace('/api/invoice-approved-prices', '');
    if (method === 'GET' && sub === '') return respond(200, server.list(params));
    if (method === 'GET' && sub === '/export') return respond(200, {});
    // Máy chủ thật tìm gần đúng bỏ dấu; bản giả lập chỉ cần bỏ dấu + chữ thường.
    const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
    const match = (r, q) => fold(r.name + ' ' + r.code).includes(fold(q));
    if (method === 'GET' && sub === '/customer-suggest') {
      const all = params.get('branch') === 'hanoi' ? [{ id: '1', code: 'KH1', name: 'Khách Vừa' }, { id: '3', code: 'KH3', name: 'An Khách' }] : [{ id: '9', code: 'KS9', name: 'Khách SG' }];
      return respond(200, { results: all.filter(r => match(r, params.get('q') || '')) });
    }
    if (method === 'GET' && sub === '/product-suggest') {
      const all = [{ id: '1', code: 'T100', name: 'Ly giữ nhiệt' }, { id: '2', code: 'T200', name: 'Bình nước' }];
      return respond(200, { results: all.filter(r => match(r, params.get('q') || '')) });
    }
    if (method === 'POST' && sub === '') {
      const body = JSON.parse(options.body);
      const row = rec(server.nextId++, { ...body, customerName: 'Khách Vừa', productCode: 'T100', productName: 'Ly giữ nhiệt' });
      server.rows.push(row);
      return respond(201, { row, recalc: { status: 'applied', recomputedLines: 3, resultChangedLines: 1 } });
    }
    const m = sub.match(/^\/(\d+)$/);
    if (m) {
      const row = server.rows.find(r => r.id === m[1]);
      if (!row) return respond(404, { error: 'Không tồn tại.' });
      if (method === 'PUT') {
        const body = JSON.parse(options.body);
        if (body.expectedVersion !== row.version) return respond(409, { error: 'Xung đột', code: 'VERSION_CONFLICT' });
        Object.assign(row, body, { version: row.version + 1 });
        return respond(200, { row, recalc: { status: 'skipped' } });
      }
      if (method === 'DELETE') {
        server.rows = server.rows.filter(r => r !== row);
        return respond(200, { id: m[1], recalc: { status: 'applied', recomputedLines: 1, resultChangedLines: 1 } });
      }
    }
    return respond(404, {});
  };

  w.eval(fs.readFileSync(path.join(publicDir, 'js', 'pagination.js'), 'utf8'));
  w.eval(js);
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim()).forEach(s => w.eval(s));
  w.showToast = (message, type) => toasts.push([message, type]); // sau script inline (nó tự định nghĩa showToast)
  const doc = w.document;
  return { dom, w, doc, server, confirms, toasts, downloads, $: id => doc.getElementById(id) };
}

async function opened(options) {
  const page = createPage(options);
  await page.w.TKSApprovedPrices.load(true);
  await settle();
  return page;
}

const rows = page => [...page.$('approvedPriceRows').querySelectorAll('tr[data-id]')];
const texts = tr => [...tr.cells].map(c => c.textContent.trim().replace(/\s+/g, ' '));
const change = (page, id, value) => { const el = page.$(id); el.value = value; el.dispatchEvent(new page.w.Event('change', { bubbles: true })); };
const gets = page => page.server.requests.filter(r => r.method === 'GET' && /^\/api\/invoice-approved-prices(\?|$)/.test(r.href));
const typeInto = async (page, el, value) => { el.value = value; el.dispatchEvent(new page.w.Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); await settle(); };
const dialog = page => page.$('approvedPriceDialog');
const dq = (page, id) => dialog(page).querySelector('#' + id);
const pick = async (page, inputId, typed) => {
  await typeInto(page, dq(page, inputId), typed);
  const li = dialog(page).querySelector('#' + inputId + 'List li[data-i]');
  li.dispatchEvent(new page.w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
};

test('Bảng giá duyệt là mục 2 của tab Hóa đơn, ẩn khi thiếu quyền xem; nút Tạo / Sửa / Xóa chỉ khi có quyền quản lý', async () => {
  const none = createPage({ permissions: ['reports.invoices'] });
  await none.w.TKSApprovedPrices.load(true);
  assert.equal(none.$('approvedPriceSection'), null, 'khong co quyen xem: muc bi go han khoi trang');
  assert.equal(gets(none).length, 0);

  // Chi co quyen xem Kiem tra gia ban (khong co quyen rieng) -> van an: bang nay nhay cam.
  const auditOnly = createPage({ permissions: ['reports.invoices', 'reports.invoices.priceAudit', 'reports.export'] });
  await auditOnly.w.TKSApprovedPrices.load(true);
  assert.equal(auditOnly.$('approvedPriceSection'), null, 'quyen Kiem tra gia ban khong du: muc bi go han');
  assert.equal(gets(auditOnly).length, 0);

  const viewer = await opened({ permissions: [VIEW] });
  assert.equal(viewer.$('approvedPriceSection').hidden, false);
  assert.equal(viewer.$('approvedPriceCreateButton').hidden, true);
  assert.equal(viewer.$('approvedPriceExportButton').hidden, true);
  assert.equal(viewer.$('approvedPriceRows').querySelectorAll('button[data-action]').length, 0);

  const manager = await opened();
  assert.equal(manager.$('approvedPriceCreateButton').hidden, false);
  assert.equal(manager.$('approvedPriceExportButton').hidden, false);
  assert.equal(manager.$('approvedPriceRows').querySelectorAll('button[data-action="edit"]').length, 2);
  assert.equal(manager.$('approvedPriceRows').querySelectorAll('button[data-action="delete"]').length, 2);
});

test('bảng hiển thị 7 cột + thao tác, giá định dạng en-US, ngày dd/mm/yyyy, tag số bản ghi', async () => {
  const page = await opened();
  const heads = [...page.$('approvedPriceHead').querySelectorAll('th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim());
  assert.deepEqual(heads, ['Khách hàng', 'Cơ sở', 'Mã SP', 'Tên SP', 'Giá duyệt', 'Người duyệt', 'Ngày duyệt', 'Thao tác']);
  assert.equal(page.$('tagApprovedPrice').textContent, '2 bản ghi');
  const first = texts(rows(page)[0]);
  assert.deepEqual(first.slice(0, 7), ['Khách Vừa · KH1', 'Hà Nội', 'T100', 'Ly giữ nhiệt', '23,500', 'Anh Quân', '19/10/2026']);
  // Chỉ số theo mục nằm ngay dưới tiêu đề mục (quy ước mọi mục của tab).
  const kpis = [...page.$('approvedPriceKpis').querySelectorAll('.kpi-card')].map(c => [c.querySelector('.eyebrow').textContent, c.querySelector('.value').textContent]);
  assert.deepEqual(kpis, [['Bản ghi giá duyệt', '2'], ['Khách có giá duyệt', '1'], ['Mã SP có giá duyệt', '2'], ['Duyệt gần nhất', '21/10/2026']]);
});

test('lọc Người duyệt + Ngày duyệt Từ–Đến gửi lên máy chủ, Xóa lọc trả về mặc định', async () => {
  const page = await opened();
  change(page, 'approvedPriceApproverFilter', 'Anh Duy');
  await settle();
  assert.match(gets(page).at(-1).href, /approver=Anh\+Duy/);
  assert.equal(rows(page).length, 1);
  assert.equal(page.$('tagApprovedPrice').textContent, '1 bản ghi');
  change(page, 'approvedPriceApproverFilter', '');
  change(page, 'approvedPriceFrom', '2026-10-20');
  await settle();
  assert.match(gets(page).at(-1).href, /from=2026-10-20/);
  assert.equal(rows(page).length, 1);
  change(page, 'approvedPriceTo', '2026-10-20');
  await settle();
  assert.match(gets(page).at(-1).href, /to=2026-10-20/);
  assert.match(page.$('approvedPriceRows').textContent, /Không có bản ghi nào khớp bộ lọc/);
  page.$('approvedPriceClearFilters').click();
  await settle();
  assert.equal(page.$('approvedPriceApproverFilter').value, '');
  assert.equal(page.$('approvedPriceFrom').value, '');
  assert.doesNotMatch(gets(page).at(-1).href, /approver=|from=|to=/);
  assert.equal(rows(page).length, 2);
});

test('sort mọi cột ở máy chủ: lần 1 tăng dần ▼, lần 2 giảm dần ▲, lần 3 bỏ sắp xếp ▲▼', async () => {
  const page = await opened();
  const keys = [...page.$('approvedPriceHead').querySelectorAll('th.sortable')].map(th => th.dataset.sort);
  assert.deepEqual(keys, ['customerName', 'branch', 'productCode', 'productName', 'approvedPrice', 'approver', 'approvedOn']);
  const th = page.$('approvedPriceHead').querySelector('th[data-sort="approvedPrice"]');
  th.querySelector('button').click();
  await settle();
  assert.match(gets(page).at(-1).href, /sort=approvedPrice&dir=asc/);
  assert.equal(th.getAttribute('aria-sort'), 'ascending');
  assert.equal(th.querySelector('.sort-indicator').textContent, '▼');
  assert.equal(texts(rows(page)[0])[4], '23,500');
  th.querySelector('button').click();
  await settle();
  assert.match(gets(page).at(-1).href, /dir=desc/);
  assert.equal(th.querySelector('.sort-indicator').textContent, '▲');
  assert.equal(texts(rows(page)[0])[4], '50,000');
  th.querySelector('button').click();
  await settle();
  assert.doesNotMatch(gets(page).at(-1).href, /sort=/);
  assert.equal(th.querySelector('.sort-indicator').textContent, '▲▼');
  for (const key of keys) {
    const h = page.$('approvedPriceHead').querySelector(`th[data-sort="${key}"] button`);
    h.click();
    await settle();
    assert.match(gets(page).at(-1).href, new RegExp(`sort=${key}&dir=asc`), key);
    h.click(); h.click();
    await settle();
  }
});

test('Tạo bản ghi: ngày mặc định hôm nay, người duyệt 3 lựa chọn, Tên SP tự nhảy, phải chọn khách / mã từ gợi ý', async () => {
  const page = await opened();
  page.$('approvedPriceCreateButton').click();
  assert.ok(dialog(page).hasAttribute('open'));
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  assert.equal(dq(page, 'apDate').value, today);
  assert.deepEqual([...dq(page, 'apApprover').options].map(o => o.textContent), ['Chọn người duyệt', ...APPROVERS]);
  assert.deepEqual([...dq(page, 'apBranch').options].map(o => o.textContent), ['Hà Nội', 'Sài Gòn']);
  assert.equal(dq(page, 'apProductName').readOnly, true);

  // Gõ khách nhưng KHÔNG chọn từ gợi ý → không gửi.
  await typeInto(page, dq(page, 'apCustomer'), 'khach');
  assert.equal(dialog(page).querySelectorAll('#apCustomerList li[data-i]').length, 2);
  dq(page, 'apPrice').value = '23000';
  dq(page, 'apApprover').value = 'Anh Duy';
  dialog(page).querySelector('form').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.match(dq(page, 'apError').textContent, /Chọn khách hàng/);
  assert.equal(page.server.requests.filter(r => r.method === 'POST').length, 0);

  await pick(page, 'apCustomer', 'khach v');
  assert.equal(dq(page, 'apCustomer').value, 'Khách Vừa (KH1)');
  // Chưa chọn mã SP.
  dialog(page).querySelector('form').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.match(dq(page, 'apError').textContent, /Chọn mã SP/);
  await pick(page, 'apProductCode', 't200');
  assert.equal(dq(page, 'apProductCode').value, 'T200');
  assert.equal(dq(page, 'apProductName').value, 'Bình nước');
  // Gõ lại mã làm mất lựa chọn và xóa Tên SP.
  await typeInto(page, dq(page, 'apProductCode'), 't20');
  assert.equal(dq(page, 'apProductName').value, '');
  await pick(page, 'apProductCode', 't200');

  dq(page, 'apApprover').value = '';
  dialog(page).querySelector('form').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.match(dq(page, 'apError').textContent, /người duyệt/);
  dq(page, 'apApprover').value = 'Anh Duy';
  dq(page, 'apDate').value = '2026-10-18'; // sửa được
  dialog(page).querySelector('form').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const post = page.server.requests.find(r => r.method === 'POST');
  assert.deepEqual(post.body, { branch: 'hanoi', customerId: '1', productId: '2', approvedPrice: '23000', approver: 'Anh Duy', approvedOn: '2026-10-18' });
  assert.equal(dialog(page), null, 'hộp đóng sau khi tạo');
  assert.equal(rows(page).length, 3, 'bảng nạp lại');
  assert.match(page.toasts.at(-1)[0], /Đã tạo bản ghi giá duyệt\. Đã tính lại 3 dòng/);
});

test('đổi Cơ sở xóa khách / SP đã chọn; gợi ý theo cơ sở', async () => {
  const page = await opened();
  page.$('approvedPriceCreateButton').click();
  await pick(page, 'apCustomer', 'khach v');
  await pick(page, 'apProductCode', 't100');
  assert.equal(dq(page, 'apProductName').value, 'Ly giữ nhiệt');
  dq(page, 'apBranch').value = 'saigon';
  dq(page, 'apBranch').dispatchEvent(new page.w.Event('change', { bubbles: true }));
  assert.equal(dq(page, 'apCustomer').value, '');
  assert.equal(dq(page, 'apProductCode').value, '');
  assert.equal(dq(page, 'apProductName').value, '');
  await typeInto(page, dq(page, 'apCustomer'), 'khach');
  assert.match(page.server.requests.filter(r => r.href.includes('customer-suggest')).at(-1).href, /branch=saigon/);
  assert.deepEqual([...dialog(page).querySelectorAll('#apCustomerList li')].map(li => li.querySelector('span').textContent), ['Khách SG']);
});

test('Sửa bản ghi: điền sẵn, gửi PUT kèm expectedVersion; 409 báo xung đột và giữ hộp mở', async () => {
  const page = await opened();
  rows(page)[0].querySelector('[data-action="edit"]').click();
  assert.ok(dialog(page).hasAttribute('open'));
  assert.equal(dq(page, 'apCustomer').value, 'Khách Vừa (KH1)');
  assert.equal(dq(page, 'apProductCode').value, 'T100');
  assert.equal(dq(page, 'apProductName').value, 'Ly giữ nhiệt');
  assert.equal(dq(page, 'apPrice').value, '23500');
  assert.equal(dq(page, 'apApprover').value, 'Anh Quân');
  assert.equal(dq(page, 'apDate').value, '2026-10-19');
  dq(page, 'apPrice').value = '23600';
  dq(page, 'apApprover').value = 'Anh Duy Khánh';
  dialog(page).querySelector('form').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  const put = page.server.requests.find(r => r.method === 'PUT');
  assert.deepEqual(put.body, { branch: 'hanoi', customerId: '1', productId: '1', approvedPrice: '23600', approver: 'Anh Duy Khánh', approvedOn: '2026-10-19', expectedVersion: 1 });
  assert.equal(dialog(page), null);
  assert.equal(texts(rows(page).find(tr => tr.dataset.id === '1'))[4], '23,600');

  // Người khác sửa trước → 409.
  page.server.rows.find(r => r.id === '1').version = 9;
  rows(page).find(tr => tr.dataset.id === '1').querySelector('[data-action="edit"]').click();
  page.server.rows.find(r => r.id === '1').version = 12;
  dq(page, 'apPrice').value = '1000';
  dialog(page).querySelector('form').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.ok(dialog(page), 'hộp vẫn mở');
  assert.match(dq(page, 'apError').textContent, /người khác cập nhật/);
});

test('Xóa: có hộp xác nhận; Hủy thì không gọi máy chủ, đồng ý thì DELETE kèm expectedVersion rồi nạp lại bảng', async () => {
  const declined = await opened({ confirm: () => false });
  rows(declined)[0].querySelector('[data-action="delete"]').click();
  await settle();
  assert.equal(declined.confirms.length, 1);
  assert.match(declined.confirms[0], /Xóa bản ghi giá duyệt\?/);
  assert.match(declined.confirms[0], /Khách Vừa/);
  assert.equal(declined.server.requests.filter(r => r.method === 'DELETE').length, 0);
  assert.equal(rows(declined).length, 2);

  const page = await opened();
  rows(page)[0].querySelector('[data-action="delete"]').click();
  await settle();
  assert.equal(page.confirms.length, 1);
  const del = page.server.requests.find(r => r.method === 'DELETE');
  assert.match(del.href, /\/api\/invoice-approved-prices\/\d+\?expectedVersion=1$/);
  assert.equal(rows(page).length, 1);
  assert.match(page.toasts.at(-1)[0], /Đã xóa bản ghi giá duyệt\. Đã tính lại 1 dòng/);
});

test('Xuất file: gọi /export với đúng bộ lọc + sort đang dùng rồi tải TKS_Gia_duyet.xlsx', async () => {
  const page = await opened();
  change(page, 'approvedPriceApproverFilter', 'Anh Quân');
  await settle();
  page.$('approvedPriceHead').querySelector('th[data-sort="approvedOn"] button').click();
  await settle();
  page.$('approvedPriceExportButton').click();
  await settle();
  const exp = page.server.requests.find(r => r.href.startsWith('/api/invoice-approved-prices/export'));
  assert.ok(exp);
  const q = new URLSearchParams(exp.href.split('?')[1]);
  assert.equal(q.get('approver'), 'Anh Quân');
  assert.equal(q.get('sort'), 'approvedOn');
  assert.equal(q.get('dir'), 'asc');
  assert.equal(q.get('page'), null, 'xuất toàn bộ tập, không phân trang');
  assert.deepEqual(page.downloads, ['TKS_Gia_duyet.xlsx']);
});
