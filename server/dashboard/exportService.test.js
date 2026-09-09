'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const CONFIG = require('../config');
const dashboardData = require('./dashboardData');
const exportService = require('./exportService');

function buildSnapshot() {
  const sheets = {
    [CONFIG.SHEET_PRODUCTS]: [
      ['Mã hàng', 'Tên hàng', 'Giá bán', 'Ngày tạo'],
      ['00123', '=Tên có công thức', 150000, '14/08/2026 08:00:00']
    ],
    [CONFIG.SHEET_INVOICES]: [
      ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'Tổng tiền hàng'],
      ['HD-01', '14/08/2026 09:00:00', 'Khách A', 300000]
    ],
    [CONFIG.SHEET_ORDERS]: [
      ['Mã đặt hàng', 'Ngày đặt', 'Khách hàng', 'Tổng tiền'],
      ['DH-01', '14/08/2026 09:10:00', 'Khách A', 250000]
    ],
    [CONFIG.SHEET_RETURNS]: [
      ['Mã trả hàng', 'Ngày trả', 'Mã hóa đơn gốc', 'Tổng tiền trả'],
      ['TH-01', '14/08/2026 10:00:00', 'HD-01', 50000]
    ],
    [CONFIG.SHEET_CUSTOMERS]: [
      ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Nợ hiện tại'],
      ['KH-01', 'Khách A', '0900123456', 100000]
    ],
    [CONFIG.SHEET_SUPPLIERS]: [
      ['Mã NCC', 'Tên NCC', 'Điện thoại', 'Nợ cần trả'],
      ['NCC-01', 'Nhà cung cấp A', '0280011223', 200000]
    ],
    [CONFIG.SHEET_PURCHASES]: [
      [
        'Chi nhánh', 'Mã nhập hàng', 'Thời gian', 'Thời gian tạo', 'Ngày cập nhật',
        'Mã nhà cung cấp', 'Tên nhà cung cấp', 'Điện thoại', 'Địa chỉ', 'Người nhập',
        'Người tạo', 'Tổng tiền hàng', 'Giảm giá phiếu nhập', 'Cần trả NCC', 'Tiền đã trả NCC',
        'Ghi chú', 'Số hóa đơn đầu vào', 'Tổng số lượng', 'Tổng số mặt hàng', 'Trạng thái',
        'Mã hàng', 'Tên hàng', 'Số lượng'
      ],
      ['CN1', 'PN-01', '14/08/2026 07:00:00', '', '', 'NCC-01', 'Nhà cung cấp A', '', '', '', '', 100000, 0, 100000, 0, '', '', 3, 2, 'Đã nhập hàng', '00123', 'Sản phẩm A', 1],
      ['CN1', 'PN-01', '14/08/2026 07:00:00', '', '', 'NCC-01', 'Nhà cung cấp A', '', '', '', '', 100000, 0, 100000, 0, '', '', 3, 2, 'Đã nhập hàng', 'SP-02', 'Sản phẩm B', 2]
    ]
  };

  const dashboard = {
    overview: {
      endOfDayReport: { transactions: [{ code: 'HD-01', quantity: 2, quantityKnown: true }] },
      todayNewProducts: { products: [{ code: '00123' }] }
    },
    newPurchases: { orders: [{ code: 'PN-01' }] },
    products: {
      topSellingProducts: [{ code: '00123', qty: 2, revenue: 300000 }],
      topSellingParentCategories: [{ name: 'Áo', qty: 2, revenue: 300000, productCount: 1 }],
      newlyImported: { products: [{ code: '00123', firstImportDate: '14/08/2026', daysOnHand: 1, revenue: 300000 }] },
      childCategorySalesByParent: { Áo: [{ name: 'Áo thun', qty: 2, revenue: 300000, productCount: 1 }] }
    },
    lowStock: [{ code: '00123' }],
    allProducts: [{ code: '00123', pct: 100 }],
    invoices: {
      recentOrders: [{ code: 'DH-01' }],
      recentReturns: [{ code: 'TH-01' }],
      recentInvoices: [{ code: 'HD-01' }]
    },
    customers: {
      topRevenue: { top50: [{ code: 'KH-01', saleOrderCount: 2, revenue: 300000 }] },
      topDebt: [{ code: 'KH-01', periodRevenue: 300000 }]
    },
    suppliers: [{ code: 'NCC-01' }],
    debt: {
      1: {
        customers: [{
          code: 'KH-01', name: 'Khách A', phone: '0900123456', group: 'VIP',
          openingDebt: 10, debit: 20, credit: 5, closingDebt: 25,
          transactions: [{ code: 'GD-01', time: '14/08/2026 10:00:00', type: 'Thanh toán', value: 5, runningBalance: 25 }]
        }]
      }
    }
  };

  return { sheets, dashboard };
}

const FIXED_TABLES = [
  'overview.transactions', 'overview.purchases', 'overview.new-products',
  'products.top-selling', 'products.low-stock', 'products.all', 'products.newly-imported',
  'products.child-categories', 'invoices.orders', 'invoices.returns', 'invoices.recent',
  'customers.revenue', 'customers.debt', 'suppliers.list', 'debt.period'
];

test('registry dung du 15 bang va tao duoc metadata voi tat ca cot mac dinh duoc chon', () => {
  const snapshot = buildSnapshot();
  FIXED_TABLES.forEach(tableKey => {
    const context = {
      productAnalysis: tableKey === 'products.top-selling' ? 'product' : undefined,
      childCategoryParent: 'Áo',
      debtPeriod: 1
    };
    const dataset = exportService.__test__.buildFixedDataset(tableKey, snapshot, context);
    assert.equal(dataset.tableKey, tableKey);
    assert.ok(dataset.worksheets.length >= 1, `${tableKey} phai co worksheet`);
    dataset.worksheets.forEach(worksheet => assert.ok(worksheet.columns.length >= 1));
  });
});

test('ca 15 bang tao duoc file xlsx tu danh sach truong API tra ve', async () => {
  const originalSnapshot = dashboardData.getDashboardExportSnapshot;
  dashboardData.getDashboardExportSnapshot = async () => buildSnapshot();
  try {
    for (const tableKey of FIXED_TABLES) {
      const payload = {
        tableKey,
        filters: {},
        context: { productAnalysis: 'product', childCategoryParent: 'Áo', debtPeriod: 1 }
      };
      const metadata = await exportService.getExportFields(payload);
      payload.columns = Object.fromEntries(metadata.worksheets.map(worksheet => [
        worksheet.key,
        worksheet.fields.map(field => field.key)
      ]));
      assert.ok(metadata.worksheets.every(worksheet => worksheet.fields.every(field => field.selected)));
      const file = await exportService.createExportWorkbook(payload);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);
      assert.equal(workbook.worksheets.length, metadata.worksheets.length, tableKey);
    }
  } finally {
    dashboardData.getDashboardExportSnapshot = originalSnapshot;
  }
});

test('Nhap hang tao worksheet tong hop theo phieu va chi tiet tung mat hang', () => {
  const dataset = exportService.__test__.buildFixedDataset('overview.purchases', buildSnapshot(), {});
  assert.deepEqual(dataset.worksheets.map(sheet => sheet.name), ['Tổng hợp phiếu', 'Chi tiết mặt hàng']);
  assert.equal(dataset.worksheets[0].rows.length, 1);
  assert.equal(dataset.worksheets[1].rows.length, 2);
  assert.ok(dataset.worksheets[1].columns.some(column => column.label === 'Mã hàng'));
});

test('Cong no tao worksheet tong hop va giao dich, co ap dung bo loc ma ten', () => {
  const snapshot = buildSnapshot();
  const matched = exportService.__test__.buildFixedDataset('debt.period', snapshot, { debtPeriod: 1, debtFilter: 'khách a' });
  assert.equal(matched.worksheets[0].rows.length, 1);
  assert.equal(matched.worksheets[1].rows.length, 1);
  const missing = exportService.__test__.buildFixedDataset('debt.period', snapshot, { debtPeriod: 1, debtFilter: 'không có' });
  assert.equal(missing.worksheets[0].rows.length, 0);
  assert.equal(missing.worksheets[1].rows.length, 0);
});

test('workbook giu ma co so 0 dau, chan chuoi cong thuc va bat freeze/autofilter', async () => {
  const originalSnapshot = dashboardData.getDashboardExportSnapshot;
  dashboardData.getDashboardExportSnapshot = async () => buildSnapshot();
  try {
    const file = await exportService.createExportWorkbook({
      tableKey: 'products.all',
      filters: {},
      columns: { all_products: ['c0', 'c1', 'c2'] }
    });
    assert.match(file.fileName, /^TKS_Tat_ca_ma_hang_\d{8}_\d{4}\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const worksheet = workbook.worksheets[0];
    assert.equal(worksheet.getCell('A2').value, '00123');
    assert.equal(worksheet.getCell('B2').value, "'=Tên có công thức");
    assert.equal(worksheet.getCell('C2').value, 150000);
    assert.equal(worksheet.views[0].ySplit, 1);
    assert.ok(worksheet.autoFilter);
  } finally {
    dashboardData.getDashboardExportSnapshot = originalSnapshot;
  }
});

test('header khong to mau nen, chu den, an gridline', async () => {
  const originalSnapshot = dashboardData.getDashboardExportSnapshot;
  dashboardData.getDashboardExportSnapshot = async () => buildSnapshot();
  try {
    const file = await exportService.createExportWorkbook({
      tableKey: 'products.all',
      filters: {},
      columns: { all_products: ['c0', 'c1', 'c2'] }
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const worksheet = workbook.worksheets[0];
    const header = worksheet.getRow(1);
    assert.equal(header.font.color.argb, 'FF000000');
    header.eachCell(cell => {
      assert.equal(cell.fill === undefined || cell.fill.pattern === 'none', true);
      assert.ok(cell.border && cell.border.top && cell.border.left && cell.border.bottom && cell.border.right);
    });
    assert.equal(worksheet.views[0].showGridLines, false);
    const dataRow = worksheet.getRow(2);
    dataRow.eachCell(cell => {
      assert.ok(cell.border && cell.border.top && cell.border.left && cell.border.bottom && cell.border.right);
    });
  } finally {
    dashboardData.getDashboardExportSnapshot = originalSnapshot;
  }
});

test('ten file gan tien to HN_/SG_ theo co so dang xuat', async () => {
  const originalSnapshot = dashboardData.getDashboardExportSnapshot;
  dashboardData.getDashboardExportSnapshot = async () => buildSnapshot();
  try {
    const payload = {
      tableKey: 'products.all',
      filters: {},
      columns: { all_products: ['c0', 'c1', 'c2'] }
    };
    const hn = await exportService.createExportWorkbook(payload, 'Hà Nội');
    assert.match(hn.fileName, /^HN_Tat_ca_ma_hang_\d{8}_\d{4}\.xlsx$/);
    const sg = await exportService.createExportWorkbook(payload, 'Sài Gòn');
    assert.match(sg.fileName, /^SG_Tat_ca_ma_hang_\d{8}_\d{4}\.xlsx$/);
  } finally {
    dashboardData.getDashboardExportSnapshot = originalSnapshot;
  }
});

test('tim kiem nhieu nguon tu dong xuat moi nguon mot worksheet va khong can gui cot', async () => {
  const originalSearch = dashboardData.searchDashboardRecords;
  dashboardData.searchDashboardRecords = async () => ({
    results: [
      { source: 'invoices', sourceLabel: 'Hóa đơn', fields: [{ label: 'Mã hóa đơn', value: 'HD-01', rawValue: 'HD-01' }] },
      { source: 'orders', sourceLabel: 'Đặt hàng', fields: [{ label: 'Mã đặt hàng', value: 'DH-01', rawValue: 'DH-01' }] }
    ]
  });
  try {
    const payload = { tableKey: 'search.results', filters: {}, search: { view: 'invoices', mode: 'codes', query: 'HD-01 DH-01' } };
    const metadata = await exportService.getExportFields(payload);
    assert.equal(metadata.selectionMode, 'all-only');
    assert.deepEqual(metadata.worksheets.map(sheet => sheet.name), ['Hóa đơn', 'Đặt hàng']);
    const file = await exportService.createExportWorkbook(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    assert.equal(workbook.worksheets.length, 2);
  } finally {
    dashboardData.searchDashboardRecords = originalSearch;
  }
});

test('API dich vu tu choi tim kiem Tong quan va tu choi khi khong chon truong', async () => {
  await assert.rejects(
    exportService.getExportFields({ tableKey: 'search.results', search: { view: 'overview', query: 'abc' } }),
    error => error.code === 'EXPORT_OVERVIEW_SEARCH_DISABLED'
  );

  const originalSnapshot = dashboardData.getDashboardExportSnapshot;
  dashboardData.getDashboardExportSnapshot = async () => buildSnapshot();
  try {
    await assert.rejects(
      exportService.createExportWorkbook({ tableKey: 'products.all', columns: { all_products: [] } }),
      error => error.code === 'EXPORT_NO_FIELDS_SELECTED'
    );
  } finally {
    dashboardData.getDashboardExportSnapshot = originalSnapshot;
  }
});

test('Bao cao doanh thu theo khach: xuat bang chi tiet + bang so sanh thang, loc theo san pham khi co chon, tu choi khi chua chon khach', async () => {
  const originalReport = dashboardData.getCustomerProductRevenueReport;
  dashboardData.getCustomerProductRevenueReport = async (code, name) => ({
    customer: { code, name: name || code },
    products: [
      { code: 'SP-01', name: 'Sản phẩm một', quantity: 3, revenue: 300, month1Revenue: 100, month2Revenue: 100, month3Revenue: 100 },
      { code: 'SP-02', name: 'Sản phẩm hai', quantity: 1, revenue: 100, month1Revenue: 100, month2Revenue: 0, month3Revenue: 0 }
    ]
  });
  try {
    const detailDataset = await exportService.__test__.buildExportDataset({
      tableKey: 'customers.productDetail',
      context: { customerProductCustomerCode: 'KH-01', customerProductCustomerName: 'Khách A' }
    });
    assert.equal(detailDataset.worksheets[0].rows.length, 2);
    assert.deepEqual(detailDataset.worksheets[0].columns.map(c => c.label), ['Tên hàng', 'Số lượng', 'Doanh số']);

    const monthlyDataset = await exportService.__test__.buildExportDataset({
      tableKey: 'customers.productMonthlyCompare',
      context: { customerProductCustomerCode: 'KH-01', customerProductCode: 'SP-02' }
    });
    assert.equal(monthlyDataset.worksheets[0].rows.length, 1, 'chon 1 san pham thi chi xuat 1 dong');
    assert.equal(monthlyDataset.worksheets[0].rows[0].name, 'Sản phẩm hai');
    assert.deepEqual(monthlyDataset.worksheets[0].columns.map(c => c.label), ['Tên hàng', 'T.này', 'T.trước', 'T.trước nữa']);

    await assert.rejects(
      exportService.__test__.buildExportDataset({ tableKey: 'customers.productDetail', context: {} }),
      error => error.statusCode === 400 && error.code === 'EXPORT_NO_CUSTOMER_SELECTED'
    );
  } finally {
    dashboardData.getCustomerProductRevenueReport = originalReport;
  }
});

test('buildExportDataset: stockout.recentScan tra dung worksheet', async () => {
  const dataset = await exportService.__test__.buildExportDataset({
    tableKey: 'stockout.recentScan',
    recentStockoutResult: {
      branch: 'Hà Nội',
      rows: [{
        code: 'SP001', name: 'Ao thun', lastOutOfStockDate: '2026-01-05', daysOutOfStock: 6,
        periods: [
          { fromDate: '2026-01-01', toDate: '2026-01-05', days: 5 },
          { fromDate: '2026-01-10', toDate: '2026-01-15', days: 6 }
        ]
      }]
    }
  });

  assert.equal(dataset.tableKey, 'stockout.recentScan');
  assert.equal(dataset.title, 'Hàng đứt gần đây');
  assert.equal(dataset.sourceBranch, 'Hà Nội');
  assert.equal(dataset.worksheets.length, 1);
  assert.deepEqual(dataset.worksheets[0].columns.map((c) => c.key), ['code', 'name', 'lastOutOfStockDate', 'daysOutOfStock', 'periods']);
  assert.equal(dataset.worksheets[0].rows[0].code, 'SP001');
  assert.equal(dataset.worksheets[0].rows[0].periods, '01/01/2026 -> 05/01/2026\n10/01/2026 -> 15/01/2026');
});

test('createExportWorkbook: file stockout.recentScan dung ten co so LUC QUET (result.branch), khong phai co so dang xuat hien tai', async () => {
  const file = await exportService.createExportWorkbook({
    tableKey: 'stockout.recentScan',
    recentStockoutResult: {
      branch: 'Hà Nội',
      rows: [{ code: 'SP001', name: 'Ao thun', lastOutOfStockDate: '2026-01-05', daysOutOfStock: 6, periods: [] }]
    },
    columns: { recent_stockout_result: ['code', 'name', 'lastOutOfStockDate', 'daysOutOfStock', 'periods'] }
  }, 'Sài Gòn'); // req.branch hien tai la Sai Gon, nhung ban quet duoc chay o Ha Noi
  assert.match(file.fileName, /^HN_/);
});

test('buildExportDataset: stockout.recentScan khong co dong nao thi bao loi EXPORT_NO_DATA', async () => {
  await assert.rejects(
    exportService.__test__.buildExportDataset({ tableKey: 'stockout.recentScan', recentStockoutResult: { rows: [] } }),
    /EXPORT_NO_DATA|Chưa có kết quả/
  );
});

test('buildExportDataset: stockout.check90d tra dung worksheet', async () => {
  const dataset = await exportService.__test__.buildExportDataset({
    tableKey: 'stockout.check90d',
    stockout90dResult: {
      branch: 'Sài Gòn',
      rows: [{
        code: 'SP001', name: 'Ao thun', stockoutCount: 2, totalStockoutDays: 10, currentOnHand: 3,
        periods: [
          { fromDate: '2026-01-01', toDate: '2026-01-05', days: 5 },
          { fromDate: '2026-01-10', toDate: '2026-01-14', days: 5 }
        ]
      }]
    }
  });

  assert.equal(dataset.tableKey, 'stockout.check90d');
  assert.equal(dataset.title, 'Kiểm tra đứt hàng 90 ngày');
  assert.equal(dataset.sourceBranch, 'Sài Gòn');
  assert.equal(dataset.worksheets.length, 1);
  assert.deepEqual(dataset.worksheets[0].columns.map((c) => c.key), ['code', 'name', 'stockoutCount', 'totalStockoutDays', 'currentOnHand', 'periods']);
  assert.equal(dataset.worksheets[0].rows[0].code, 'SP001');
  assert.equal(dataset.worksheets[0].rows[0].periods, '01/01/2026 -> 05/01/2026\n10/01/2026 -> 14/01/2026');
});

test('file Excel stockout bật wrap text cho cột Các đợt đứt hàng', async () => {
  const file = await exportService.createExportWorkbook({
    tableKey: 'stockout.recentScan',
    recentStockoutResult: {
      rows: [{
        code: 'SP001', name: 'Áo thun', lastOutOfStockDate: '2026-01-01', daysOutOfStock: 10,
        periods: [
          { fromDate: '2026-01-01', toDate: '2026-01-05', days: 5 },
          { fromDate: '2026-01-10', toDate: '2026-01-14', days: 5 }
        ]
      }]
    },
    columns: { recent_stockout_result: ['code', 'name', 'lastOutOfStockDate', 'daysOutOfStock', 'periods'] }
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const periodsColumn = workbook.worksheets[0].getColumn(5);
  assert.equal(periodsColumn.alignment.wrapText, true);
  assert.match(workbook.worksheets[0].getCell('E2').value, /\n/);
});

test('buildExportDataset: stockout.check90d khong co dong nao thi bao loi EXPORT_NO_DATA', async () => {
  await assert.rejects(
    exportService.__test__.buildExportDataset({ tableKey: 'stockout.check90d', stockout90dResult: { rows: [] } }),
    /EXPORT_NO_DATA|Chưa có kết quả/
  );
});
