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

const { getExportFields, createExportWorkbook } = require('./dashboard/exportService');
const authRoutes = require('./auth/authRoutes');
const adminUserRoutes = require('./auth/adminUserRoutes');
const { requireAuth, requireRole } = require('./auth/authMiddleware');
const { resolveBranch } = require('./branch/branchMiddleware');
const { branchLabelToCode } = require('./branch/branches');
const branchRoutes = require('./branch/branchRoutes');
const { INTERNAL_ROLES, ROLES } = require('./auth/userRepository');
const { getPool } = require('./db/pool');
const hrLeaveRoutes          = require('./hr/hrLeaveRoutes');
const notificationRoutes     = require('./notifications/notificationRoutes');
const roleChangeRequestRoutes = require('./auth/roleChangeRequestRoutes');
const stockoutCheckRoutes    = require('./dashboard/stockoutCheck/stockoutCheckRoutes');
const kiotvietWebhookRoutes  = require('./kiotviet/kiotvietWebhookRoutes');
const kiotvietSyncStatusRoutes = require('./kiotvietSync/kiotvietSyncStatusRoutes');
const debtManagementRoutes = require('./dashboard/debtManagementRoutes');

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Webhook tu KiotViet (nguoi goi la KiotViet, khong phai nguoi dung dang
// nhap) — mount TRUOC moi guard auth/co so. Xem server/kiotviet/kiotvietWebhookRoutes.js.
router.use(kiotvietWebhookRoutes);

// /api/auth/* mount truoc — POST /login va POST /logout khong doi hoi da dang
// nhap (do chinh la noi de dang nhap); GET /me tu bao ve bang requireAuth ben trong.
router.use(authRoutes);
router.use(adminUserRoutes);

// Xem/doi co so dang lam viec — /api/branch. KHONG gan resolveBranch o day:
// chinh hai route nay quyet dinh gia tri cookie ma resolveBranch se doc.
router.use(branchRoutes);

// Toan bo /api/hr/* la du lieu THEO CO SO — gan resolveBranch truoc router con.
router.use('/api/hr', requireAuth, resolveBranch);

// Cac endpoint quan ly nhan su (nghi phep) — /api/hr/* — phan quyen rieng
// tung route ben trong hrLeaveRoutes.js (xem het ho so vs chi Quan ly duyet).
router.use(hrLeaveRoutes);

// Chuong thong bao dung chung cho MOI tai khoan — /api/notifications/*.
router.use(notificationRoutes);

// Yeu cau doi vai tro tu than — /api/role-requests/* — Quan ly duyet/tu choi.
router.use(roleChangeRequestRoutes);

// PATCH trạng thái công nợ tự mang auth/role/branch guard bên trong router.
router.use(debtManagementRoutes);

// Trang thai sync chi danh cho Quan ly; route tu fail-soft 503 neu chua co DB.
router.use('/api/internal/kiotviet-sync/status', requireAuth, requireRole(ROLES.QUAN_LY));
router.use(kiotvietSyncStatusRoutes);

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

// Kiem tra dut hang, doi chieu truc tiep KiotViet API — /api/products/stockout-recent/*, /api/products/stockout-90d/*
router.use(stockoutCheckRoutes);

// Route kiem tra ket noi nhanh — chi xem duoc tren server, KHONG expose secret
router.get('/api/debug', async (req, res) => {
  const branchCode = branchLabelToCode(req.branch);
  const checks = {
    branch: req.branch,
    databaseTest: null,
    databaseError: null
  };
  try {
    const result = await getPool().query('SELECT COUNT(*)::int AS count FROM invoices WHERE branch = $1', [branchCode]);
    checks.databaseTest = `OK — ${result.rows[0].count} hóa đơn từ Supabase`;
  } catch (e) {
    checks.databaseError = { message: e.message };
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
    const data = await getDashboardData(filters, req.branch, req.user);
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
    // Ban go-tim-truc-tiep chi can top 200 dong de UI khong bi cham khi go tung
    // ky tu; nut "Xuat Excel" goi rieng exportService (khong truyen limit nay)
    // nen van xuat day du.
    const data = await searchProductRevenueOverview(req.query.q, req.query.mode, req.branch, undefined, 200);
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
