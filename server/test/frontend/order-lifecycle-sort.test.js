'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'shipment', 'lifecycle', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function inlineScripts(source) {
  return [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
}

async function renderLifecycleTable() {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/shipment/lifecycle/'
  });
  const { window } = dom;
  window.setInterval = () => 1;
  window.TKSNav = {
    authGuard: () => Promise.resolve({ vaiTro: 'Quản lý' }),
    handleBranchError: () => false
  };
  window.fetch = async () => ({
    ok: true,
    json: async () => ({
      orders: [
        { orderCode: 'B002', saleName: 'Bình', customerName: 'Yến', summary: { code: 'DELIVERING', label: 'Đang giao', at: '02/09/2026 09:00' } },
        { orderCode: 'A001', saleName: 'An', customerName: 'Xuân', summary: { code: 'DELIVERED', label: 'Đã giao', at: '01/09/2026 09:00' } }
      ]
    })
  });

  inlineScripts(html).forEach(script => window.eval(script));
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  return dom;
}

function visibleOrderCodes(document) {
  return [...document.querySelectorAll('#bulkBody tr')].map(row => row.cells[0].textContent);
}

test('nhan lan thu ba vao cung ten cot se bo sap xep va tra ve thu tu goc', async () => {
  const dom = await renderLifecycleTable();
  const { document } = dom.window;
  const orderCodeHeader = document.querySelector('th[data-sort="orderCode"]');

  orderCodeHeader.click();
  assert.deepEqual(visibleOrderCodes(document), ['A001', 'B002']);

  orderCodeHeader.click();
  assert.deepEqual(visibleOrderCodes(document), ['B002', 'A001']);

  orderCodeHeader.click();
  assert.deepEqual(visibleOrderCodes(document), ['B002', 'A001']);
  assert.equal(orderCodeHeader.classList.contains('sort-active'), false);

  dom.window.close();
});
