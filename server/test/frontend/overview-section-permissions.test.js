'use strict';

// Tab Tong quan co 4 muc; muc 4 (Kiem tra dut hang + nhap Tra NCC) goi cac API duoi
// /api/products can quyen Hang hoa (reports.products). Nhan vien sale chi co quyen Tong quan
// (reports.overview) nen muc 4 phai bi AN va khong duoc goi /import-status (se 403).
// Chay trang that trong JSDOM voi TKSNav/fetch gia.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { defaultsForRole } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function createPage(vaiTro) {
  const permissions = defaultsForRole(vaiTro);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = {
    authGuard: () => Promise.resolve({ vaiTro, branches: ['Hà Nội', 'Sài Gòn', 'Cả hai'], permissions }),
    can: (...keys) => keys.some(key => permissions.includes(key)),
    handleBranchError: () => false,
    renderTopSidebar() {}
  };

  const urls = [];
  dom.window.fetch = url => {
    urls.push(String(url));
    if (String(url).includes('/supplier-returns/import-status')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ statuses: [] }) });
    }
    return new Promise(() => {}); // cac API con lai khong can tra loi trong test nay
  };

  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return { dom, urls, section: () => dom.window.document.getElementById('overviewStockoutSection') };
}

test('muc 4 Tong quan co id de an/hien theo quyen', () => {
  assert.match(html, /<section class="section" id="overviewStockoutSection">/);
});

test('Nhân viên sale (chỉ quyền Tổng quan): ẩn mục 4 và không gọi API nhập Trả NCC', async () => {
  const page = createPage('Nhân viên sale');
  await settle();
  assert.equal(page.section().hidden, true);
  assert.equal(page.urls.some(url => url.includes('/api/products/')), false, 'khong goi API duoi /api/products');
  page.dom.window.close();
});

test('Quản lý (có quyền Hàng hóa): hiện mục 4 và nạp trạng thái nhập Trả NCC như cũ', async () => {
  const page = createPage('Quản lý');
  await settle();
  assert.equal(page.section().hidden, false);
  assert.ok(page.urls.some(url => url.includes('/api/products/supplier-returns/import-status')));
  page.dom.window.close();
});
