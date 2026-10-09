'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');
const { renderHtmlReport } = require('./exportHtmlReport');

function dataset() {
  const columns = [
    { key: 'code', label: 'Mã hàng', type: 'text' },
    { key: 'name', label: 'Tên hàng', type: 'text', width: 260 },
    { key: 'qty', label: 'Số lượng', type: 'number' },
    { key: 'notes', label: 'Ghi chú', type: 'text' }
  ];
  return {
    meta: { title: 'Báo cáo', fileBase: 'report', generatedAt: new Date('2026-10-09T00:00:00Z') },
    worksheets: [
      { key: 'products', name: 'Hàng hóa', columns, rows: Array.from({ length: 55 }, (_, i) => ({ code: `SP${i}`, name: `Hàng ${i}`, qty: i, notes: i === 54 ? 'needle only in hidden column' : 'Chi tiết đầy đủ' })) },
      { key: 'other', name: 'Khác', columns: columns.slice(0, 3), rows: [{ code: 'K1', name: 'Khác', qty: 2 }] }
    ]
  };
}

async function openReport(data = dataset(), mobile = false) {
  const html = (await renderHtmlReport(data)).buffer.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'file:///offline-report.html',
    beforeParse(win) {
      win.DecompressionStream = DecompressionStream;
      win.Response = Response;
      win.HTMLCanvasElement.prototype.getContext = () => null;
      win.console.error = () => {};
      win.matchMedia = query => ({ matches: query.includes('max-width') ? mobile : false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      win.fetch = () => { throw new Error('Offline report must not fetch'); };
      win.XMLHttpRequest = function () { throw new Error('Offline report must not request'); };
    }
  });
  for (let i = 0; i < 200 && /Đang mở dữ liệu/.test(dom.window.document.getElementById('tbody').textContent); i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  return { html, dom, win: dom.window, doc: dom.window.document };
}

function picker(doc) {
  doc.getElementById('tableColumns').click();
  return [...doc.querySelectorAll('input[type=checkbox]')];
}

function toggle(doc, win, label) {
  const checkbox = picker(doc).find(input => input.closest('label').textContent.includes(label));
  assert.ok(checkbox, `Exported picker includes ${label}`);
  checkbox.checked = !checkbox.checked;
  checkbox.dispatchEvent(new win.Event('change', { bubbles: true }));
  doc.getElementById('tableColumns').click();
}

function visibleKeys(doc) {
  return [...doc.querySelectorAll('#thead th')].filter(th => doc.defaultView.getComputedStyle(th).display !== 'none').map(th => th.dataset.columnKey);
}

test('offline artifact embeds shared controls, stable keys and all exported columns initially visible on desktop and mobile', async t => {
  for (const mobile of [false, true]) {
    const { html, dom, doc, win } = await openReport(dataset(), mobile);
    t.after(() => win.close());
    assert.ok(win.TKSTables, 'Shared table controls are embedded');
    assert.equal(doc.querySelectorAll('script').length, 3);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|XMLHttpRequest|\/api\//i);
    assert.match(html, /@media print/);
    assert.equal(doc.getElementById('reportTable').dataset.tableKey, 'export:products');
    assert.deepEqual(visibleKeys(doc), ['code', 'name', 'qty', 'notes']);
    const choices = picker(doc);
    assert.equal(choices.length, 4, 'Only columns actually included in the file are selectable');
    assert.ok(choices.every(input => input.checked));
    assert.ok(doc.getElementById('tableColumns').querySelector('svg'));
    doc.getElementById('tableColumns').click();
    const payload = doc.getElementById('report-data').textContent;
    assert.equal(JSON.parse(zlib.gunzipSync(Buffer.from(payload, 'base64'))).worksheets[0].columns[1].width, 260);
    const col = doc.querySelector('#reportTable col[data-column-key="name"]');
    assert.equal(col.style.width, '260px');
    assert.equal(win.getComputedStyle(doc.getElementById('reportTable')).tableLayout, 'fixed');
    assert.notEqual(win.getComputedStyle(doc.querySelector('#tbody td.num')).whiteSpace, 'nowrap');
    assert.notEqual(win.getComputedStyle(doc.querySelector('#thead th')).whiteSpace, 'nowrap');
    assert.ok(dom);
  }
});

test('visibility survives redraw, sort, paging and worksheet switching without changing source indices, search or summary', async t => {
  const { doc, win } = await openReport();
  t.after(() => win.close());
  const beforeKpis = doc.getElementById('kpis').textContent;
  const beforeCharts = doc.getElementById('charts').textContent;
  toggle(doc, win, 'Ghi chú');
  toggle(doc, win, 'Mã hàng');
  assert.deepEqual(visibleKeys(doc), ['name', 'qty']);
  assert.equal(doc.getElementById('kpis').textContent, beforeKpis);
  assert.equal(doc.getElementById('charts').textContent, beforeCharts);
  doc.querySelector('#thead button[data-col="2"]').click();
  assert.equal(doc.querySelector('#tbody tr').cells[2].textContent, '54');
  assert.deepEqual(visibleKeys(doc), ['name', 'qty']);
  doc.getElementById('nextPage').click();
  assert.match(doc.getElementById('pageLabel').textContent, /Trang 2/);
  assert.deepEqual(visibleKeys(doc), ['name', 'qty']);
  const input = doc.getElementById('q');
  input.value = 'needle';
  input.dispatchEvent(new win.Event('input'));
  assert.match(doc.getElementById('count').textContent, /Hiển thị 1 \/ 55 dòng/);
  assert.equal(doc.querySelector('#tbody tr').cells[0].textContent, 'SP54');
  doc.getElementById('reset').click();
  doc.querySelector('#tabs [data-sheet="1"]').click();
  assert.equal(doc.getElementById('reportTable').dataset.tableKey, 'export:other');
  assert.deepEqual(visibleKeys(doc), ['code', 'name', 'qty']);
  assert.equal(picker(doc).length, 3);
  doc.getElementById('tableColumns').click();
  doc.querySelector('#tabs [data-sheet="0"]').click();
  assert.deepEqual(visibleKeys(doc), ['name', 'qty']);
  input.value = 'no such row';
  input.dispatchEvent(new win.Event('input'));
  assert.equal(doc.querySelector('#tbody .no-rows').colSpan, 2, 'Empty state spans visible columns');
  const reopened = await openReport();
  t.after(() => reopened.win.close());
  assert.deepEqual(visibleKeys(reopened.doc), ['code', 'name', 'qty', 'notes']);
});

test('malicious metadata and cell values remain inert with exactly three inline script elements', async t => {
  const data = dataset();
  const malicious = '</script><img src=x onerror="window.injected=1"><!--';
  data.meta.title = malicious;
  data.worksheets[0].key = malicious;
  data.worksheets[0].columns[0].key = malicious;
  data.worksheets[0].columns[0].label = malicious;
  data.worksheets[0].rows = [{ [malicious]: malicious, name: 'Safe', qty: 1, notes: 'Safe' }];
  const { html, doc, win } = await openReport(data);
  t.after(() => win.close());
  assert.equal((html.match(/<\/script>/gi) || []).length, 3);
  assert.equal(doc.querySelectorAll('script').length, 3);
  assert.equal(doc.querySelectorAll('img').length, 0);
  assert.equal(win.injected, undefined);
  assert.equal(doc.querySelector('#thead th').dataset.columnKey, malicious);
  assert.equal(doc.querySelector('#tbody td').textContent, malicious);
  assert.ok(picker(doc).some(input => input.closest('label').textContent.includes(malicious)));
  assert.equal(doc.querySelectorAll('img').length, 0);
});

test('embedded shared source escapes closing script and style sequences before placing it in HTML', async t => {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    const source = readFileSync.call(this, file, ...args);
    if (String(file).endsWith('table-controls.js')) return source + '\n// </ScRiPt><script>window.sourceInjected=1</script>\n';
    if (String(file).endsWith('table-controls.css')) return source + '\n/* </StYlE><script>window.styleInjected=1</script> */\n';
    return source;
  };
  let result;
  try { result = await openReport(); } finally { fs.readFileSync = readFileSync; }
  t.after(() => result.win.close());
  assert.equal(result.doc.querySelectorAll('script').length, 3);
  assert.equal(result.doc.querySelectorAll('style').length, 1);
  assert.equal(result.win.sourceInjected, undefined);
  assert.equal(result.win.styleInjected, undefined);
  assert.ok(result.win.TKSTables);
  assert.deepEqual(visibleKeys(result.doc), ['code', 'name', 'qty', 'notes']);
});
