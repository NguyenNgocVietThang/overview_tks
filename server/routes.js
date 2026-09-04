const express = require('express');
const {
  getDashboardData,
  searchDashboardRecords,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport,
  searchProductRevenueOverview,
  getProductRevenueDetail
} = require('./dashboard/dashboardData');

const router = express.Router();

const sheetsClient = require('./sheets/sheetsClient');
const { getExportFields, createExportWorkbook } = require('./dashboard/exportService');
const CONFIG = require('./config');
const authRoutes = require('./auth/authRoutes');
const adminUserRoutes = require('./auth/adminUserRoutes');
const { requireAuth, requireRole } = require('./auth/authMiddleware');
const { resolveBranch, resolveBranchOptional } = require('./branch/branchMiddleware');
const { BRANCHES } = require('./branch/branches');
const branchRoutes = require('./branch/branchRoutes');
const { INTERNAL_ROLES } = require('./auth/userRepository');
const { lookupInvoiceStatuses } = require('./shipment/invoiceStatusService');
const shipmentOrderRoutes    = require('./shipment/shipmentOrderRoutes');
const orderLifecycleRoutes   = require('./shipment/orderLifecycleRoutes');
const hrLeaveRoutes          = require('./hr/hrLeaveRoutes');
const notificationRoutes     = require('./notifications/notificationRoutes');
const roleChangeRequestRoutes = require('./auth/roleChangeRequestRoutes');
const stockoutCheckRoutes    = require('./dashboard/stockoutCheck/stockoutCheckRoutes');

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// /api/auth/* mount truoc — POST /login va POST /logout khong doi hoi da dang
// nhap (do chinh la noi de dang nhap); GET /me tu bao ve bang requireAuth ben trong.
router.use(authRoutes);
router.use(adminUserRoutes);

// Xem/doi co so dang lam viec — /api/branch. KHONG gan resolveBranch o day:
// chinh hai route nay quyet dinh gia tri cookie ma resolveBranch se doc.
router.use(branchRoutes);

// Tra cuu trang thai hoa don — route DUY NHAT trong /api/shipment/* ma vai tro
// "Khách" duoc dung, ma khach thi khong duoc gan co so nao. Vi vay dang ky
// TRUOC guard co so ben duoi va dung ban "mem" resolveBranchOptional (khong
// bao gio 403, mac dinh Ha Noi) de khong chan khach hang.
router.post('/api/shipment/invoice-status', requireAuth, resolveBranchOptional, async (req, res) => {
  try {
    const results = await lookupInvoiceStatuses(req.body && req.body.codes, req.branch);
    res.status(200).json({ results });
  } catch (err) {
    console.error('=== LOI TRA CUU TRANG THAI HOA DON ===');
    console.error(err.stack);
    console.error('======================================');
    res.status(err.statusCode || 500).json({
      error: err.statusCode && err.statusCode < 500
        ? err.message
        : 'Không tra cứu được trạng thái hóa đơn.',
      code: err.code
    });
  }
});

// Tra cuu "Vong doi don hang" — Khach (xem don cua minh) + 5 vai tro noi bo.
// Dang ky TRUOC gate co so ben duoi (giong invoice-status o tren): nguon du
// lieu la 1 spreadsheet RIENG (2 tab HN/SG gop lai), khong doc theo co so
// dang dang nhap nen KHONG can resolveBranch — chi requireAuth roi ROUTER TU
// phan quyen tung endpoint (xem orderLifecycleRoutes.js).
router.use('/api/shipment/lifecycle', requireAuth, orderLifecycleRoutes);

// Toan bo /api/shipment/* va /api/hr/* con lai deu la du lieu THEO CO SO — gan
// resolveBranch truoc cac router con de moi handler ben trong luon co req.branch,
// va tai khoan chua duoc gan co so bi chan ngay tu vong ngoai.
router.use('/api/shipment', requireAuth, resolveBranch);
router.use('/api/hr', requireAuth, resolveBranch);

// Cac endpoint quan ly van chuyen Phase 1B — /api/shipment/* (tru invoice-status o tren)
router.use(shipmentOrderRoutes);

// Cac endpoint quan ly nhan su (nghi phep) — /api/hr/* — phan quyen rieng
// tung route ben trong hrLeaveRoutes.js (xem het ho so vs chi Quan ly duyet).
router.use(hrLeaveRoutes);

// Chuong thong bao dung chung cho MOI tai khoan — /api/notifications/*.
router.use(notificationRoutes);

// Yeu cau doi vai tro tu than — /api/role-requests/* — Quan ly duyet/tu choi.
router.use(roleChangeRequestRoutes);

// Toan bo API "Bao cao tong hop" ben duoi day chi danh cho 4 vai tro noi bo;
// Khach chi duoc dung route tra cuu van chuyen o tren. Day la ranh gioi bao mat,
// voi auth-guard phia client chi de dieu huong UX. Trang tra cuu cong khai
// cho khach hang (Phase 1) se nam o route rieng, KHONG qua requireAuth.
const requireInternalUser = [requireAuth, requireRole(...INTERNAL_ROLES), resolveBranch];
router.use('/api/debug', ...requireInternalUser);
router.use('/api/dashboard', ...requireInternalUser);
router.use('/api/search', ...requireInternalUser);
router.use('/api/customer-product-top', ...requireInternalUser);
router.use('/api/customer-product-revenue', ...requireInternalUser);
router.use('/api/product-revenue-search', ...requireInternalUser);
router.use('/api/product-revenue-detail', ...requireInternalUser);
router.use('/api/export', ...requireInternalUser);
router.use('/api/products', ...requireInternalUser);

// Kiem tra dut hang (upload Excel, doi chieu truc tiep KiotViet API) — /api/products/stockout-check/*
router.use(stockoutCheckRoutes);

// Route kiem tra ket noi nhanh — chi xem duoc tren server, KHONG expose secret
router.get('/api/debug', async (req, res) => {
  // Doc theo dung co so dang chon de kiem tra nhanh "co so nay dang tro toi
  // spreadsheet nao" — day cung la cach xac minh nhanh nhat khi doi co so.
  const branchSheets = sheetsClient.getSheetsClient(req.branch);
  const branchSpreadsheetId = req.branch === BRANCHES.SAIGON ? CONFIG.SPREADSHEET_ID_SG : CONFIG.SPREADSHEET_ID;
  const checks = {
    SPREADSHEET_ID: !!process.env.SPREADSHEET_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    SPREADSHEET_ID_SG: !!process.env.SPREADSHEET_ID_SG,
    branch: req.branch,
    spreadsheetId: branchSpreadsheetId ? branchSpreadsheetId.substring(0, 8) + '...' : null,
    sheetsTest: null,
    sheetsError: null,
    sheetTabs: null,
    sheetTabsError: null,
  };
  try {
    const data = await branchSheets.getValues(CONFIG.SHEET_INVOICES);
    checks.sheetsTest = `OK — ${data.length} rows tu sheet "${CONFIG.SHEET_INVOICES}"`;
  } catch (e) {
    checks.sheetsError = { message: e.message, googleStatus: e?.response?.status };
  }
  try {
    checks.sheetTabs = await branchSheets.listSheetTitles();
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
      newProducts: parseFilterSpec(req.query, 'np')
    };
    const data = await getDashboardData(filters, req.branch);
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
    res.status(err.statusCode || 500).json({
      error: err.statusCode && err.statusCode < 500 ? err.message : 'Khong lay duoc du lieu dashboard.',
      detail: err.message,
      googleStatus,
      googleMessage,
      code: err.code
    });
  }
});

router.get('/api/search', async (req, res) => {
  try {
    const filterSpec = req.query.view === 'customers' ? parseFilterSpec(req.query, 'cu') : undefined;
    const data = await searchDashboardRecords(req.query.view, req.query.q, req.query.limit, req.query.mode, filterSpec, req.branch);
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
      },
      undefined, // `now` — de mac dinh, tham so tiem cho test
      req.branch
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

router.get('/api/customer-product-revenue', async (req, res) => {
  try {
    const data = await getCustomerProductRevenueReport(
      req.query.code,
      req.query.name,
      req.branch
    );
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    console.error('=== LOI /api/customer-product-revenue ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Stack:', err.stack);
    console.error('==========================================');
    res.status(err.statusCode || 500).json({
      error: err.statusCode && err.statusCode < 500 ? err.message : 'Khong lay duoc bao cao doanh thu theo khach.',
      detail: err.message,
      code: err.code,
      googleStatus
    });
  }
});

router.get('/api/product-revenue-search', async (req, res) => {
  try {
    const data = await searchProductRevenueOverview(req.query.q, req.query.mode, req.branch);
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    console.error('=== LOI /api/product-revenue-search ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Stack:', err.stack);
    console.error('========================================');
    res.status(err.statusCode || 500).json({
      error: err.statusCode && err.statusCode < 500 ? err.message : 'Khong tim kiem duoc doanh thu theo hang.',
      detail: err.message,
      code: err.code,
      googleStatus
    });
  }
});

router.get('/api/product-revenue-detail', async (req, res) => {
  try {
    const data = await getProductRevenueDetail(req.query.code, req.branch);
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    console.error('=== LOI /api/product-revenue-detail ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Stack:', err.stack);
    console.error('========================================');
    res.status(err.statusCode || 500).json({
      error: err.statusCode && err.statusCode < 500 ? err.message : 'Khong lay duoc chi tiet doanh thu theo hang.',
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
    const metadata = await getExportFields(req.body || {}, req.branch);
    res.status(200).json(metadata);
  } catch (err) {
    sendExportError(res, err, 'Không lấy được danh sách trường xuất Excel.');
  }
});

router.post('/api/export', async (req, res) => {
  try {
    const file = await createExportWorkbook(req.body || {}, req.branch);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', file.buffer.length);
    res.status(200).send(file.buffer);
  } catch (err) {
    sendExportError(res, err, 'Không thể tạo file Excel.');
  }
});

module.exports = router;
