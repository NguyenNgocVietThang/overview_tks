'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const document = new JSDOM(html).window.document;

function view(name) {
  const el = document.getElementById('view-' + name);
  assert.ok(el, 'phai co view ' + name);
  return el;
}

function sectionTitles(name) {
  return [...view(name).querySelectorAll(':scope > section.section')].map(section => ({
    step: section.querySelector('.section-step').textContent.trim(),
    title: section.querySelector('.section-head h2').firstChild.textContent.trim()
  }));
}

test('Tổng quan có 4 phần (Xu hướng đứng đầu; không còn Chỉ số then chốt đầu tab, không còn nhóm hàng)', () => {
  const titles = sectionTitles('overview');
  assert.deepEqual(titles.map(s => s.step), ['1', '2', '3', '4']);
  assert.ok(!titles.some(s => /nhóm hàng/.test(s.title)), 'phan nhom hang da bi go');
  assert.deepEqual(titles.map(s => s.title), ['Xu hướng', 'Báo cáo doanh thu theo khách', 'Báo cáo hàng hóa', 'Kiểm tra đứt hàng']);
  ['endOfDayRows', 'chartTopTransactions', 'todayNewProductRows'].forEach(id => {
    assert.equal(view('overview').querySelector('#' + id), null, id + ' khong duoc nam o Tong quan');
  });
  assert.ok(view('overview').querySelector('#productReportRows'), 'productReportRows phai nam o Tong quan');
});

test('Tổng quan không còn phần nhóm hàng, Hàng hóa không còn phần nhóm con', () => {
  ['chartGroupRevenue', 'chartGroupQty', 'childCategoryParentSelect', 'chartChildCategoryRevenue', 'childCategoryRows'].forEach(id => {
    assert.equal(document.getElementById(id), null, id + ' da bi go khoi dashboard');
  });
});

test('Hóa đơn: chỉ còn Giao dịch (đã bỏ phần Phân tích/Trả hàng; Xu hướng đã chuyển sang Tổng quan), không còn Hóa đơn gần đây', () => {
  const titles = sectionTitles('invoices');
  assert.deepEqual(titles.map(s => s.step), ['1']);
  assert.deepEqual(titles.map(s => s.title), ['Giao dịch']);
  ['in-returns-total', 'in-returns-count'].forEach(id => assert.equal(document.getElementById(id), null, id + ' da bi go'));
  ['chartInvoiceRevenue', 'in-revenue'].forEach(id => {
    assert.equal(view('invoices').querySelector('#' + id), null, id + ' da chuyen sang Tong quan');
    assert.ok(view('overview').querySelector('#' + id), id + ' phai nam o Tong quan');
  });
  ['endOfDayRows', 'endOfDayPagination'].forEach(id => {
    assert.ok(view('invoices').querySelector('#' + id), id + ' phai nam o Hoa don');
  });
  assert.equal(view('invoices').querySelector('#chartTopTransactions'), null, 'bieu do top giao dich da bi go');
  ['invoiceRows', 'invoicesPagination', 'tagInvoices'].forEach(id => {
    assert.equal(view('invoices').querySelector('#' + id), null, id + ' da bi go khoi Hoa don');
  });
});

test('Hàng hóa chứa phần Mã mới tạo sau Hàng mới nhập', () => {
  const titles = sectionTitles('products');
  assert.deepEqual(titles.map(s => s.step), ['1', '2', '3', '4', '5']);
  assert.deepEqual(titles.slice(3).map(s => s.title), ['Hàng mới nhập', 'Mã mới tạo']);
  assert.ok(view('products').querySelector('#todayNewProductRows'));
});

test('không còn thanh lọc thời gian chung; bộ lọc Từ – Đến gắn vào từng bảng có lọc thời gian', () => {
  assert.equal(document.getElementById('filterBar'), null);
  const match = html.match(/const TABLE_DATE_FILTERS = \{([\s\S]*?)\};/);
  assert.ok(match, 'phai co TABLE_DATE_FILTERS');
  const map = new Function('return {' + match[1] + '}')();
  // Moi bang 1 bo loc rieng (2 bang Dat hang / Tra hang cua tab Hoa don da bo 2026-10-01).
  assert.deepEqual(map, {
    topSelling: 'topSelling', newlyImported: 'newlyImported', todayNewProducts: 'newProducts',
    endOfDay: 'invoices',
    customerRevenue: 'customers'
  });
  assert.equal(new Set(Object.values(map)).size, Object.keys(map).length, 'khong bang nao dung chung bo loc');
});

test('không còn mục Chỉ số then chốt đầu tab; mỗi mục con có hàng chỉ số ngay dưới tiêu đề', () => {
  ['overview', 'products', 'invoices', 'customers'].forEach(name => {
    const sections = [...view(name).querySelectorAll(':scope > section.section')];
    assert.ok(!sectionTitles(name).some(s => s.title === 'Chỉ số then chốt'), name);
    sections.forEach((section, index) => {
      assert.ok(section.querySelector('.section-kpis'), name + ' muc ' + (index + 1) + ' thieu chi so then chot');
      const firstBlock = section.querySelector(':scope > .section-head').nextElementSibling;
      if (name !== 'overview' || index !== 1) {
        assert.ok(firstBlock.classList.contains('section-kpis'), name + ' muc ' + (index + 1) + ': chi so phai o dau muc');
      }
    });
  });
});

test('tham số bộ lọc gửi backend: np theo Hàng hóa, không còn ov/de', () => {
  const match = html.match(/const TAB_FILTER_PREFIXES = \{([\s\S]*?)\};/);
  assert.ok(match, 'phai co TAB_FILTER_PREFIXES');
  const map = new Function('return {' + match[1] + '}')();
  assert.deepEqual(map, {
    topSelling: ['pr'], newlyImported: ['ni'], newProducts: ['np'],
    invoices: ['in'],
    customers: ['cu']
  });
  assert.equal(map.overview, undefined);
});

// ---- Render thật: dữ liệu đúng cấu trúc payload mới phải hiện ở tab mới ----
function createRenderedDashboard(data) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
    data,
    days: 30,
    filters: { products: { mode: 'days', days: 30 }, invoices: { mode: 'days', days: 30 }, customers: { mode: 'all' } },
    productStatus: 'all'
  }));
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can: () => true, handleBranchError: () => false, renderTopSidebar() {} };
  dom.window.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return dom;
}

function samplePayload() {
  const kpi = { revenueToday: 0, invoicesToday: 0, cancelledToday: 0, totalStock: 0, totalProducts: 0, lowStockCount: 0,
    totalCustomers: 0, customersWithDebt: 0, totalDebt: 0,
    inStockCodes: 0, inactiveProducts: 0, inventoryValueCategoryCount: 0, totalInventoryValue: 0 };
  return {
    kpi,
    filters: { products: { label: '30 ngày' }, invoices: { label: '30 ngày' } },
    invoices: {
      periodRevenue: 0, periodInvoices: 0, periodCancelledInvoices: 0, revenueByDay: [],
      transactionsReport: {
        transactions: [{ code: 'HD-777', time: '21/09 09:08', customer: 'KH A', employee: 'NV B', quantity: 3, quantityKnown: true, revenue: 1200000, discount: 0, paid: 1200000, status: 'Hoàn thành' }],
        topTransactions: [{ code: 'HD-777', revenue: 1200000, status: 'Hoàn thành' }],
        summary: { quantity: 3, quantityKnown: true, revenue: 1200000, discount: 0, paid: 1200000 }
      }
    },
    products: {
      newProducts: { label: '30 ngày', count: 1, dateColumnAvailable: true,
        products: [{ code: 'MOI-01', name: 'Hàng mới tạo', category: 'Nhóm X', createdAt: '18/09/2026 14:28:00', cost: 0, price: 0 }] },
      topSellingProducts: [], topSellingParentCategories: [], childCategorySalesByParent: {}, availableParentCategories: [],
      newlyImported: { products: [], topByRevenue: [], salesByCategory: [], countByCategory: [], salesRevenue: 0, salesQty: 0 }
    },
    stockValueByCategory: [], allProducts: [], stockByCategory: [],
    customers: { topDebt: [], topRevenue: { top15: [], all: [], label: '—' } }
  };
}

test('render: giao dịch hiện ở Hóa đơn, mã mới tạo ở Hàng hóa', () => {
  const dom = createRenderedDashboard(samplePayload());
  const doc = dom.window.document;
  const text = id => doc.getElementById(id).textContent;

  dom.window.eval("switchView('invoices')");
  assert.match(text('endOfDayRows'), /HD-777/);
  assert.match(text('end-day-total-revenue'), /1\.200\.000/);
  assert.match(text('end-day-table-count'), /1 giao dịch/);

  dom.window.eval("switchView('products')");
  assert.match(text('todayNewProductRows'), /MOI-01/);
  assert.match(text('today-new-products-count'), /1 mã mới/);
  // Bảng 5 cột (Mã, Tên, Cơ sở, Nhóm hàng, Thời gian tạo mã) và có biểu đồ tỷ lệ số mã theo nhóm
  assert.equal(doc.querySelectorAll('#todayNewProductRows tr:first-child td').length, 5);
  assert.equal(doc.querySelector('#todayNewProductRows').closest('table').querySelectorAll('th').length, 5);
  assert.equal(text('tagNewProductsCategory'), '1 nhóm');
  assert.equal(doc.getElementById('chartNewProductsCategory').hidden, false);

  // Chuyển về Tổng quan không được ném lỗi dù dữ liệu tab khác có mặt
  assert.doesNotThrow(() => dom.window.eval("switchView('overview')"));
});
