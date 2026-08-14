const express = require('express');
const {
  getDashboardData,
  searchDashboardRecords,
  searchTopCustomersByProducts
} = require('./dashboard/dashboardData');

const router = express.Router();

const sheetsClient = require('./sheets/sheetsClient');
const { getExportFields, createExportWorkbook } = require('./dashboard/exportService');
const CONFIG = require('./config');

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Route kiem tra ket noi nhanh — chi xem duoc tren server, KHONG expose secret
router.get('/api/debug', async (req, res) => {
  const checks = {
    SPREADSHEET_ID: !!process.env.SPREADSHEET_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    spreadsheetId: CONFIG.SPREADSHEET_ID ? CONFIG.SPREADSHEET_ID.substring(0, 8) + '...' : null,
    sheetsTest: null,
    sheetsError: null,
    sheetTabs: null,
    sheetTabsError: null,
  };
  try {
    const data = await sheetsClient.getValues(CONFIG.SHEET_INVOICES);
    checks.sheetsTest = `OK — ${data.length} rows tu sheet "${CONFIG.SHEET_INVOICES}"`;
  } catch (e) {
    checks.sheetsError = { message: e.message, googleStatus: e?.response?.status };
  }
  try {
    checks.sheetTabs = await sheetsClient.listSheetTitles();
  } catch (e) {
    checks.sheetTabsError = e.message;
  }
  res.json(checks);
});

// Doc bo loc thoi gian rieng cho 1 tab tu query string, vd prefix "ov" doc
// ovMode/ovDays/ovFrom/ovTo. legacyDays la fallback cho tham so "days" cu (khi
// dashboard chi co 1 bo loc dung chung cho Tong quan+Hoa don) de link cu/API
// cu khong bi vo neu con noi nao goi lai kieu cu.
function parseFilterSpec(query, prefix, legacyDays) {
  return {
    mode: query[prefix + 'Mode'],
    days: query[prefix + 'Days'] || legacyDays,
    from: query[prefix + 'From'],
    to: query[prefix + 'To']
  };
}

router.get('/api/dashboard', async (req, res) => {
  try {
    const legacyDays = req.query.days;
    const filters = {
      overview: parseFilterSpec(req.query, 'ov', legacyDays),
      products: {
        ...parseFilterSpec(req.query, 'pr'),
        status: req.query.prStatus
      },
      invoices: parseFilterSpec(req.query, 'in', legacyDays),
      // Tab Khách hàng mặc định xem toàn thời gian; cùng bo loc cuMode/cuDays/
      // cuFrom/cuTo duoc dung cho Top khach doanh thu va API top theo san pham.
      customers: {
        ...parseFilterSpec(req.query, 'cu'),
        mode: req.query.cuMode || 'all'
      },
      newPurchases: parseFilterSpec(req.query, 'pu'),
      newProducts: parseFilterSpec(req.query, 'np'),
      deactivated: parseFilterSpec(req.query, 'de')
    };
    const data = await getDashboardData(filters);
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    const googleMessage = err?.response?.data?.error?.message || err?.response?.data;
    console.error('=== LOI /api/dashboard ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Google API message:', JSON.stringify(googleMessage));
    console.error('Stack:', err.stack);
    console.error('=========================');
    res.status(500).json({
      error: 'Khong lay duoc du lieu dashboard.',
      detail: err.message,
      googleStatus,
      googleMessage
    });
  }
});

router.get('/api/search', async (req, res) => {
  try {
    const data = await searchDashboardRecords(req.query.view, req.query.q, req.query.limit, req.query.mode);
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    console.error('=== LOI /api/search ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Stack:', err.stack);
    console.error('=====================');
    res.status(err.statusCode || 500).json({
      error: 'Khong tim kiem duoc du lieu dashboard.',
      detail: err.message,
      code: err.code,
      googleStatus
    });
  }
});

router.get('/api/customer-product-top', async (req, res) => {
  try {
    const data = await searchTopCustomersByProducts(
      req.query.q,
      {
        ...parseFilterSpec(req.query, 'cu'),
        mode: req.query.cuMode || 'all'
      }
    );
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    console.error('=== LOI /api/customer-product-top ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Stack:', err.stack);
    console.error('======================================');
    res.status(err.statusCode || 500).json({
      error: 'Khong tim duoc top khach hang theo san pham.',
      detail: err.message,
      code: err.code,
      googleStatus
    });
  }
});

function sendExportError(res, err, fallbackMessage) {
  const googleStatus = err?.response?.status;
  console.error('=== LOI XUAT EXCEL ===');
  console.error('Message:', err.message);
  console.error('Code:', err.code);
  console.error('Google API status:', googleStatus);
  console.error('Stack:', err.stack);
  console.error('======================');
  res.status(err.statusCode || 500).json({
    error: fallbackMessage,
    detail: err.message,
    code: err.code,
    googleStatus
  });
}

router.post('/api/export/fields', async (req, res) => {
  try {
    const metadata = await getExportFields(req.body || {});
    res.status(200).json(metadata);
  } catch (err) {
    sendExportError(res, err, 'Không lấy được danh sách trường xuất Excel.');
  }
});

router.post('/api/export', async (req, res) => {
  try {
    const file = await createExportWorkbook(req.body || {});
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.status(200).send(file.buffer);
  } catch (err) {
    sendExportError(res, err, 'Không thể tạo file Excel.');
  }
});

module.exports = router;
