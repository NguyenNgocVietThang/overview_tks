'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const indexPath = path.join(publicDir, 'index.html');

function createDashboard() {
  const source = fs.readFileSync(indexPath, 'utf8');
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://tokosi.example/#products' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.Chart = class FakeChart {
    static instances = [];
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; FakeChart.instances.push(this); }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = {
    authGuard: () => new Promise(() => {}),
    // Trang bao cao goi TKSNav.can('reports.<tab>') de biet tab nao duoc xem
    // (nguon: user.permissions tu /api/auth/me) — test nay khong kiem tra phan
    // quyen nen mo het.
    can: () => true,
    handleBranchError: () => false,
    renderTopSidebar() {}
  };
  dom.window.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return dom;
}

test('initSupplierReturnImportPanel: tai khoan 1 co so thi an dropdown chon co so', async () => {
  const dom = createDashboard();
  dom.window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ statuses: [] }) });

  dom.window.initSupplierReturnImportPanel({ branches: ['Hà Nội'] });
  await Promise.resolve();

  const select = dom.window.document.getElementById('supplierReturnImportBranch');
  assert.equal(select.hidden, true);
  assert.deepEqual([...select.options].map(o => o.value), ['Hà Nội']);
  dom.window.close();
});

test('initSupplierReturnImportPanel: tai khoan ca hai co so thi hien dropdown, bo qua gia tri "Cả hai"', async () => {
  const dom = createDashboard();
  dom.window.fetch = () => Promise.resolve({ ok: true, json: async () => ({ statuses: [] }) });

  dom.window.initSupplierReturnImportPanel({ branches: ['Hà Nội', 'Sài Gòn', 'Cả hai'] });
  await Promise.resolve();

  const select = dom.window.document.getElementById('supplierReturnImportBranch');
  assert.equal(select.hidden, false);
  assert.deepEqual([...select.options].map(o => o.value), ['Hà Nội', 'Sài Gòn']);
  dom.window.close();
});

test('refreshSupplierReturnImportStatus: hien thi dung dinh dang tu API', async () => {
  const dom = createDashboard();
  dom.window.fetch = () => Promise.resolve({
    ok: true,
    json: async () => ({
      statuses: [
        { branch: 'Hà Nội', rowCount: 8718, earliestDate: '2026-06-01', latestDate: '2026-09-22', importedAt: '2026-09-22T10:01:32Z', importedBy: 'thangnnv' },
        { branch: 'Sài Gòn', rowCount: 0, earliestDate: null, latestDate: null, importedAt: null, importedBy: '' }
      ]
    })
  });

  await dom.window.refreshSupplierReturnImportStatus();

  const text = dom.window.document.getElementById('supplierReturnImportStatusBox').textContent;
  assert.match(text, /Hà Nội: 8\.718 dòng, từ 01\/06\/2026 đến 22\/09\/2026/);
  assert.match(text, /bởi thangnnv/);
  assert.match(text, /Sài Gòn: chưa nhập dữ liệu/);
  dom.window.close();
});

test('submitSupplierReturnImport: chua chon file thi bao loi, khong goi fetch', async () => {
  const dom = createDashboard();
  let fetchCalled = false;
  dom.window.fetch = () => { fetchCalled = true; return Promise.resolve({ ok: true, json: async () => ({}) }); };

  await dom.window.submitSupplierReturnImport();

  assert.equal(fetchCalled, false);
  const errorBox = dom.window.document.getElementById('supplierReturnImportErrorBox');
  assert.equal(errorBox.hidden, false);
  assert.match(errorBox.textContent, /chọn file/);
  dom.window.close();
});

test('submitSupplierReturnImport: gui dung branch + file qua FormData, hien ket qua thanh cong', async () => {
  const dom = createDashboard();
  dom.window.initSupplierReturnImportPanel.call(dom.window, { branches: ['Hà Nội', 'Sài Gòn'] });
  const select = dom.window.document.getElementById('supplierReturnImportBranch');
  select.value = 'Sài Gòn';

  const fileInput = dom.window.document.getElementById('supplierReturnImportFile');
  const fakeFile = new dom.window.File(['dummy'], 'TraNCC.xlsx');
  Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });

  let capturedBody = null;
  dom.window.fetch = (url, opts) => {
    capturedBody = opts.body;
    return Promise.resolve({
      ok: true,
      json: async () => ({ imported: 8718, skipped: 0, earliestDate: '2026-06-01', latestDate: '2026-09-22' })
    });
  };

  await dom.window.submitSupplierReturnImport();

  assert.equal(capturedBody.get('branch'), 'Sài Gòn');
  assert.equal(capturedBody.get('file').name, 'TraNCC.xlsx');
  const resultBox = dom.window.document.getElementById('supplierReturnImportResultBox');
  assert.equal(resultBox.hidden, false);
  assert.match(resultBox.textContent, /Đã nhập 8\.718 dòng/);
  assert.match(resultBox.textContent, /cho Sài Gòn/);
  dom.window.close();
});

test('submitSupplierReturnImport: server bao loi thi hien thong bao loi, khong hien ket qua', async () => {
  const dom = createDashboard();
  const fileInput = dom.window.document.getElementById('supplierReturnImportFile');
  const fakeFile = new dom.window.File(['dummy'], 'TraNCC.xlsx');
  Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });

  dom.window.fetch = () => Promise.resolve({ ok: false, json: async () => ({ error: 'File thiếu cột bắt buộc: Thời gian.' }) });

  await dom.window.submitSupplierReturnImport();

  const errorBox = dom.window.document.getElementById('supplierReturnImportErrorBox');
  assert.equal(errorBox.hidden, false);
  assert.match(errorBox.textContent, /File thiếu cột bắt buộc/);
  assert.equal(dom.window.document.getElementById('supplierReturnImportResultBox').hidden, true);
  dom.window.close();
});
