'use strict';

// Cot "Cơ sở" o moi bang du lieu, hang hoa cung ma o hai co so la hai dong rieng, khach gop theo ten
// (khong con cot Ma KH), khong con bo loc trang thai kinh doanh / thanh tim kiem chung.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const HN = 'Hà Nội';
const SG = 'Sài Gòn';
const BOTH = 'Hà Nội, Sài Gòn';

function payload() {
  const product = (branch, stock) => ({
    code: 'SP-1', branch, name: 'Khay giấy bạc', stock, reserved: 0, pct: 50, status: 'Đang kinh doanh', cost: 10, stockValue: stock * 10
  });
  return {
    kpi: {
      revenueToday: 0, invoicesToday: 0, cancelledToday: 0, totalStock: 7, totalProducts: 2, lowStockCount: 1,
      totalCustomers: 1, customersWithDebt: 1, totalDebt: 500, inStockCodes: 2, totalInventoryValue: 70, inventoryValueCategoryCount: 1
    },
    filters: { products: { label: '30 ngày' }, invoices: { label: '30 ngày' } },
    invoices: {
      periodRevenue: 0, periodInvoices: 0, periodCancelledInvoices: 0, revenueByDay: [],
      transactionsReport: {
        transactions: [
          { code: 'HD-1', branch: HN, time: '21/09 09:08', customer: 'KH A', employee: 'NV', quantity: 1, quantityKnown: true, revenue: 10, discount: 0, paid: 10, status: 'Hoàn thành' },
          { code: 'HD-1', branch: SG, time: '21/09 09:10', customer: 'KH B', employee: 'NV', quantity: 2, quantityKnown: true, revenue: 20, discount: 0, paid: 20, status: 'Hoàn thành' }
        ],
        topTransactions: [], summary: { quantity: 3, quantityKnown: true, revenue: 30, discount: 0, paid: 30 }
      }
    },
    products: {
      newProducts: { label: '30 ngày', count: 2, dateColumnAvailable: true, products: [
        { code: 'MOI-1', branch: HN, name: 'Hàng mới', category: 'Nhóm X', createdAt: '18/09/2026 14:28:00' },
        { code: 'MOI-1', branch: SG, name: 'Hàng mới', category: 'Nhóm X', createdAt: '18/09/2026 14:29:00' }
      ] },
      topSellingProducts: [], topSellingParentCategories: [], childCategorySalesByParent: {}, availableParentCategories: [],
      allSellingProducts: [
        { code: 'SP-1', branch: HN, name: 'Khay giấy bạc', qty: 3, revenue: 300 },
        { code: 'SP-1', branch: SG, name: 'Khay giấy bạc', qty: 1, revenue: 100 }
      ],
      newlyImported: {
        products: [
          { code: 'SP-1', branch: HN, name: 'Khay giấy bạc', firstImportDate: '01/09/2026', daysOnHand: 20, revenue: 300 },
          { code: 'SP-1', branch: SG, name: 'Khay giấy bạc', firstImportDate: '02/09/2026', daysOnHand: 19, revenue: 100 }
        ],
        topByRevenue: [], salesByCategory: [], countByCategory: [], salesRevenue: 0, salesQty: 0
      }
    },
    stockValueByCategory: [], stockByCategory: [],
    allProducts: [product(HN, 5), product(SG, 2)],
    customers: {
      topDebt: [{ code: 'KH-1', branch: BOTH, name: 'Khách Hà Nội', phone: '0901', debt: 500, periodRevenue: 0, codesByBranch: { [HN]: 'KH-1', [SG]: 'KH-9' }, debtByBranch: { [HN]: 200, [SG]: 300 } }],
      topRevenue: { top15: [], all: [{ code: 'KH-1', branch: BOTH, name: 'Khách Hà Nội', saleOrderCount: 3, revenue: 999, revenueByBranch: { [HN]: 600, [SG]: 399 } }], label: 'Tất cả' }
    }
  };
}

function createPage() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
    data: payload(),
    days: 30,
    filters: { products: { mode: 'days', days: 30 }, invoices: { mode: 'days', days: 30 }, customers: { mode: 'all' } }
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
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return dom;
}

function headers(doc, tbodyId) {
  return [...doc.getElementById(tbodyId).closest('table').querySelectorAll('thead th')].filter(th => !th.hidden)
    .map(th => th.textContent.replace(/[↕↑↓]/g, '').trim());
}

function rows(doc, tbodyId) {
  return [...doc.querySelectorAll('#' + tbodyId + ' tr[data-table-item-id], #' + tbodyId + ' tr')]
    .filter((tr, index, all) => all.indexOf(tr) === index && tr.cells.length > 1)
    .map(tr => [...tr.cells].filter(td => !td.hidden).map(td => td.textContent.trim()));
}

const TABLES_WITH_BRANCH = {
  products: ['inventoryValueRows', 'topSellingRows', 'allProductRows', 'newlyImportedRows', 'todayNewProductRows'],
  invoices: ['endOfDayRows'],
  customers: ['debtRows', 'customerRevenueRows']
};

test('moi bang du lieu co cot "Cơ sở" va dong nao cung ghi co so', () => {
  const dom = createPage();
  const doc = dom.window.document;
  Object.entries(TABLES_WITH_BRANCH).forEach(([view, tables]) => {
    dom.window.eval("switchView('" + view + "')");
    tables.forEach(id => {
      assert.ok(headers(doc, id).includes('Cơ sở'), id + ' phai co cot Cơ sở: ' + JSON.stringify(headers(doc, id)));
      rows(doc, id).forEach(cells => {
        assert.ok(cells.some(text => [HN, SG, BOTH].includes(text)), id + ' dong ' + JSON.stringify(cells) + ' phai ghi co so');
      });
    });
  });
  dom.window.close();
});

test('hang hoa cung ma o hai co so la hai dong rieng voi khoa dinh danh khac nhau', () => {
  const dom = createPage();
  const doc = dom.window.document;
  dom.window.eval("switchView('products')");
  const allProducts = rows(doc, 'allProductRows');
  assert.equal(allProducts.length, 2, 'SP-1 hien 2 dong (Hà Nội, Sài Gòn)');
  assert.deepEqual(allProducts.map(cells => cells[cells.length - 1]).sort(), [HN, SG]);
  const ids = [...doc.querySelectorAll('#allProductRows tr')].map(tr => tr.dataset.tableItemId);
  assert.deepEqual(ids, ['Hà Nội|SP-1', 'Sài Gòn|SP-1']);
  const topSelling = rows(doc, 'topSellingRows');
  assert.equal(topSelling.length, 2);
  dom.window.close();
});

test('bang khach hang khong con cot Mã KH, khach gop theo ten hien "Hà Nội, Sài Gòn"', () => {
  const dom = createPage();
  const doc = dom.window.document;
  dom.window.eval("switchView('customers')");
  ['debtRows', 'customerRevenueRows'].forEach(id => {
    const head = headers(doc, id);
    assert.ok(!head.includes('Mã KH'), id + ' khong con Mã KH');
    assert.equal(head[0].includes('Khách hàng') || head[0].includes('Tên khách hàng'), true);
  });
  assert.deepEqual([rows(doc, 'debtRows')[0][0], rows(doc, 'debtRows')[0].at(-1)], ['Khách Hà Nội', BOTH]);
  assert.deepEqual([rows(doc, 'customerRevenueRows')[0][0], rows(doc, 'customerRevenueRows')[0].at(-1)], ['Khách Hà Nội', BOTH]);
  dom.window.close();
});

test('bang khach hang: bo bieu do, them cot doanh thu / cong no theo tung co so', () => {
  const dom = createPage();
  const doc = dom.window.document;
  dom.window.eval("switchView('customers')");
  ['chartTopCustomerRevenue', 'chartDebt'].forEach(id => assert.equal(doc.getElementById(id), null, id + ' da bi go'));
  assert.deepEqual(headers(doc, 'customerRevenueRows').slice(2), ['Doanh thu', 'Doanh thu HN', 'Doanh thu SG', 'Cơ sở']);
  assert.deepEqual(headers(doc, 'debtRows').slice(2), ['Công nợ', 'Công nợ HN', 'Công nợ SG', 'Cơ sở']);
  assert.deepEqual(rows(doc, 'customerRevenueRows')[0].slice(2, 5).map(text => text.replace(/\D/g, '')), ['999', '600', '399']);
  assert.deepEqual(rows(doc, 'debtRows')[0].slice(2, 5).map(text => text.replace(/\D/g, '')), ['500', '200', '300']);
  // Payload cu chua co map theo co so: dong cua 1 co so lay tron tong o co so do.
  const html = dom.window.branchAmountCells({ branch: SG }, 'debtByBranch', 70, '');
  assert.deepEqual([...html.matchAll(/data-sort-value="(\d+)"/g)].map(match => match[1]), ['0', '70']);
  dom.window.close();
});

test('khong con bo loc trang thai kinh doanh, cot trang thai kinh doanh va the "Ngừng kinh doanh"', () => {
  const dom = createPage();
  const doc = dom.window.document;
  assert.equal(doc.getElementById('productStatusToggle'), null);
  assert.equal(doc.getElementById('pr-inactive'), null);
  dom.window.eval("switchView('products')");
  ['allProductRows'].forEach(id => {
    assert.ok(!headers(doc, id).some(text => /Trạng thái/.test(text)), id + ' khong con cot trang thai kinh doanh');
  });
  dom.window.close();
});

test('thanh tim kiem chung dau tab da bo, bo loc thoi gian chuyen vao bang', () => {
  const dom = createPage();
  const doc = dom.window.document;
  assert.equal(doc.getElementById('dashboardSearchForm'), null);
  assert.equal(doc.getElementById('dashboardSearchInput'), null);
  assert.equal(doc.getElementById('searchResult'), null);
  // Bo loc thoi gian gio nam trong tung bang (TABLE_DATE_FILTERS), khong con thanh loc dau tab.
  assert.equal(doc.getElementById('filterBar'), null);
  dom.window.close();
});
