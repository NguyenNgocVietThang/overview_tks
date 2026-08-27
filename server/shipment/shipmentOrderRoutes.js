// ==========================================
// SHIPMENT ORDER ROUTES — 13 endpoint quan ly van chuyen (Phase 1B).
//
// Mount trong server/routes.js:
//   const shipmentOrderRoutes = require('./shipment/shipmentOrderRoutes');
//   router.use(shipmentOrderRoutes);
//
// Tat ca endpoint deu yeu cau requireAuth + requireRole dung INTERNAL_ROLES
// (hoac subset DISPATCH_ROLES cho endpoint nhan cam), theo dung spec
// phase1b_backend_state_machine_api.md muc 7.
// ==========================================
'use strict';

const express  = require('express');
const multer   = require('multer');
const router   = express.Router();

const { requireAuth, requireRole } = require('../auth/authMiddleware');
const { ROLES, INTERNAL_ROLES }    = require('../auth/userRepository');
const { ORDER_STATUS, FLOWS, WAREHOUSES, assertValidFlowWarehouse } = require('./orderStateMachine');
const { ATTACHMENT_TYPES, uploadAttachment }                        = require('./driveService');
const repo = require('./vcOrderRepository');
const sheetsClient = require('../sheets/sheetsClient');
const CONFIG       = require('../config');

// ---------------------------------------------------------------------------
// Phan quyen theo dac ta
// ---------------------------------------------------------------------------

// Quyen chung cho moi endpoint: 4 vai tro noi bo
const authInternal = [requireAuth, requireRole(...INTERNAL_ROLES)];

// Quyen rieng cho hanh dong tao don + quan ly xe: chi Quan ly va Ke toan
const DISPATCH_ROLES = [ROLES.QUAN_LY, ROLES.KE_TOAN];
const authDispatch   = [requireAuth, requireRole(...DISPATCH_ROLES)];

// ---------------------------------------------------------------------------
// Multer — memory storage, gioi han 8MB, chi chap nhan image/*
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Chỉ chấp nhận file ảnh (image/*).'));
    }
    cb(null, true);
  }
});

// ---------------------------------------------------------------------------
// Tien ich xu ly loi theo pattern du an (xem routes.js va spec muc 6)
// ---------------------------------------------------------------------------

/**
 * Bat loi tu middleware multer (limits/fileFilter) va tra dung format
 * {error, code} da quy uoc o muc 6 spec — mac dinh multer se chuyen loi cho
 * error handler cua Express (khong phai JSON) neu khong bat rieng o day.
 */
function handleUploadError(err, req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    return res.status(400).json({ error: 'Tải ảnh lên thất bại: ' + err.message, code });
  }
  // Loi tu fileFilter (vd sai mimetype)
  return res.status(400).json({ error: err.message, code: 'INVALID_FILE_TYPE' });
}

function handleError(res, err, context) {
  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  // "Co so chua duoc cau hinh nguon du lieu" la 503 nhung KHONG phai loi he
  // thong — giu nguyen thong diep de nguoi dung biet phai lam gi (bao Quan ly
  // cau hinh nguon), thay vi "Loi he thong, vui long thu lai sau".
  if (err.code === 'BRANCH_NOT_CONFIGURED') {
    console.warn(`[${context}] ${err.detail || err.message}`);
    return res.status(err.statusCode || 503).json({ error: err.message, code: err.code });
  }
  console.error(`=== LOI ${context} ===`);
  console.error(err.stack);
  console.error(`${'='.repeat(context.length + 10)}`);
  return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: err.code });
}

// ---------------------------------------------------------------------------
// 1. GET /api/shipment/orders — danh sach don (khong kem items/history)
// ---------------------------------------------------------------------------

router.get('/api/shipment/orders', ...authInternal, async (req, res) => {
  try {
    const { warehouse, flow, status, driverName, dateFrom, dateTo } = req.query;
    const orders = await repo.getOrders({
      warehouse:  warehouse  || undefined,
      flow:       flow       ? Number(flow) : undefined,
      status:     status     || undefined,
      driverName: driverName || undefined,
      dateFrom:   dateFrom   || undefined,
      dateTo:     dateTo     || undefined
    }, req.branch);
    res.status(200).json({ orders });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/orders');
  }
});

// ---------------------------------------------------------------------------
// 2. GET /api/shipment/orders/:orderId — chi tiet 1 don
// ---------------------------------------------------------------------------

router.get('/api/shipment/orders/:orderId', ...authInternal, async (req, res) => {
  try {
    const order = await repo.getOrderById(req.params.orderId, req.branch);
    if (!order) {
      return res.status(404).json({ error: `Không tìm thấy đơn vận chuyển "${req.params.orderId}".`, code: 'ORDER_NOT_FOUND' });
    }
    res.status(200).json({ order });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/orders/:orderId');
  }
});

// ---------------------------------------------------------------------------
// 3. POST /api/shipment/orders — tao don moi tu hoa don KiotViet
// ---------------------------------------------------------------------------

router.post('/api/shipment/orders', ...authDispatch, async (req, res) => {
  try {
    const { kiotviet_code, warehouse, flow, vehicle_id, driver_name, customer_name, customer_phone, address, items } = req.body || {};

    // Validate flow / warehouse khop nhau
    assertValidFlowWarehouse(Number(flow), warehouse);

    // Tra cuu kiotviet_code trong sheet Hoa don (KiotViet goc)
    // Neu sheet khong co du field khach hang, cho phep client truyen fallback trong body
    let resolvedCustomerName  = customer_name  || '';
    let resolvedCustomerPhone = customer_phone || '';
    let resolvedAddress       = address        || '';

    if (kiotviet_code) {
      try {
        const invoiceRows = await sheetsClient.getSheetsClient(req.branch).getValues(CONFIG.SHEET_INVOICES);
        if (invoiceRows.length > 0) {
          const headers = invoiceRows[0];
          const codeIdx = headers.findIndex(h => String(h || '').trim() === 'Mã hóa đơn');
          if (codeIdx >= 0) {
            const found = invoiceRows.slice(1).find(row => String(row[codeIdx] || '').trim() === kiotviet_code);
            if (!found) {
              return res.status(404).json({ error: `Mã hóa đơn KiotViet "${kiotviet_code}" không tồn tại trong hệ thống.`, code: 'KIOTVIET_CODE_NOT_FOUND' });
            }
            // Lay them thong tin khach hang tu sheet Hoa don neu co cot
            const customerIdx = headers.findIndex(h => String(h || '').trim() === 'Tên khách');
            const phoneIdx    = headers.findIndex(h => String(h || '').trim() === 'Số điện thoại');
            const addressIdx  = headers.findIndex(h => String(h || '').trim() === 'Địa chỉ');
            if (customerIdx >= 0 && found[customerIdx]) resolvedCustomerName  = found[customerIdx];
            if (phoneIdx    >= 0 && found[phoneIdx])    resolvedCustomerPhone = found[phoneIdx];
            if (addressIdx  >= 0 && found[addressIdx])  resolvedAddress       = found[addressIdx];
          }
        }
      } catch (lookupErr) {
        // Neu khong tra cuu duoc sheet Hoa don (vd: config thieu), dung fallback tu body
        console.error('=== CANH BAO: Khong tra cuu duoc sheet Hoa don ===');
        console.error(lookupErr.message);
        console.error('=====================================================');
      }
    }

    const order = await repo.createOrder({
      kiotviet_code,
      warehouse,
      flow: Number(flow),
      vehicle_id,
      driver_name,
      customer_name:  resolvedCustomerName,
      customer_phone: resolvedCustomerPhone,
      address:        resolvedAddress,
      items: Array.isArray(items) ? items : []
    }, req.branch);

    res.status(201).json({ order });
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/orders');
  }
});

// ---------------------------------------------------------------------------
// 4. PATCH /api/shipment/orders/:orderId — cap nhat metadata (khong phai trang thai)
// ---------------------------------------------------------------------------

router.patch('/api/shipment/orders/:orderId', ...authDispatch, async (req, res) => {
  try {
    const { vehicle_id, driver_name, customer_name, customer_phone, address, freight_amount, freight_note } = req.body || {};
    const order = await repo.updateOrderMeta(req.params.orderId, {
      vehicle_id, driver_name, customer_name, customer_phone, address, freight_amount, freight_note
    }, req.branch);
    res.status(200).json({ order });
  } catch (err) {
    handleError(res, err, 'PATCH /api/shipment/orders/:orderId');
  }
});

// ---------------------------------------------------------------------------
// 5. POST /api/shipment/orders/:orderId/transition — chuyen trang thai
// ---------------------------------------------------------------------------

router.post('/api/shipment/orders/:orderId/transition', ...authInternal, async (req, res) => {
  try {
    const { to_status, note } = req.body || {};
    if (!to_status) {
      return res.status(400).json({ error: 'Thiếu trường "to_status".', code: 'INVALID_TRANSITION' });
    }
    const changedBy = (req.user && (req.user.hoTen || req.user.username)) || 'unknown';
    const order = await repo.transitionOrderStatus(req.params.orderId, to_status, { changedBy, note }, req.branch);
    res.status(200).json({ order });
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/orders/:orderId/transition');
  }
});

// ---------------------------------------------------------------------------
// 6. PATCH /api/shipment/orders/:orderId/items — cap nhat so luong da nhat
// ---------------------------------------------------------------------------

router.patch('/api/shipment/orders/:orderId/items', ...authInternal, async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Trường "items" phải là mảng.', code: 'INVALID_REQUEST' });
    }
    await repo.updateOrderItems(req.params.orderId, items, req.branch);
    res.status(200).json({ success: true });
  } catch (err) {
    handleError(res, err, 'PATCH /api/shipment/orders/:orderId/items');
  }
});

// ---------------------------------------------------------------------------
// 7. POST /api/shipment/orders/:orderId/attachments — upload anh chung tu
// ---------------------------------------------------------------------------

router.post('/api/shipment/orders/:orderId/attachments', ...authInternal, upload.single('file'), handleUploadError, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { type }    = req.body || {};

    if (!type || !ATTACHMENT_TYPES[type]) {
      return res.status(400).json({
        error: `Loại chứng từ không hợp lệ. Phải là: ${Object.keys(ATTACHMENT_TYPES).join(', ')}.`,
        code: 'INVALID_ATTACHMENT_TYPE'
      });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Thiếu file ảnh.', code: 'MISSING_FILE' });
    }

    // Kiem tra don ton tai
    const order = await repo.getOrderById(orderId, req.branch);
    if (!order) {
      return res.status(404).json({ error: `Không tìm thấy đơn vận chuyển "${orderId}".`, code: 'ORDER_NOT_FOUND' });
    }

    // Upload len Drive
    const driveResult = await uploadAttachment({
      orderId,
      type,
      fileBuffer:   req.file.buffer,
      mimeType:     req.file.mimetype,
      originalName: req.file.originalname,
      branch:       req.branch
    });

    const uploadedBy = (req.user && (req.user.hoTen || req.user.username)) || 'unknown';

    // Ghi vao tab Anh chung tu
    const attachment = await repo.appendAttachment(orderId, {
      type,
      drive_file_id:       driveResult.drive_file_id,
      drive_view_url:      driveResult.drive_view_url,
      drive_thumbnail_url: driveResult.drive_thumbnail_url,
      uploadedBy
    }, req.branch);

    // 4.4 — Tu dong hoan thanh neu dieu kien dap ung
    let updatedOrder = null;
    const AUTO_COMPLETE_TYPES = new Set(['DELIVERY_PHOTO', 'SIGNED_BILL']);
    const AUTO_COMPLETE_STATUSES = new Set([ORDER_STATUS.DANG_GIAO, ORDER_STATUS.DA_GIAO]);

    if (AUTO_COMPLETE_TYPES.has(type) && AUTO_COMPLETE_STATUSES.has(order.current_status)) {
      try {
        updatedOrder = await repo.transitionOrderStatus(orderId, ORDER_STATUS.HOAN_THANH, {
          changedBy: 'system:auto-complete'
        }, req.branch);
      } catch (autoErr) {
        // Neu auto-complete that bai (vd: race condition trang thai da doi),
        // khong lam fail request upload — chi log canh bao
        console.error('=== CANH BAO: Auto-complete that bai ===');
        console.error(autoErr.message);
        console.error('=========================================');
      }
    }

    res.status(201).json({ attachment, order: updatedOrder });
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/orders/:orderId/attachments');
  }
});

// ---------------------------------------------------------------------------
// 8. GET /api/shipment/orders/:orderId/attachments — danh sach anh
// ---------------------------------------------------------------------------

router.get('/api/shipment/orders/:orderId/attachments', ...authInternal, async (req, res) => {
  try {
    const attachments = await repo.listAttachments(req.params.orderId, req.branch);
    res.status(200).json({ attachments });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/orders/:orderId/attachments');
  }
});

// ---------------------------------------------------------------------------
// 9. POST /api/shipment/orders/:orderId/exceptions — tao su co
// ---------------------------------------------------------------------------

router.post('/api/shipment/orders/:orderId/exceptions', ...authInternal, async (req, res) => {
  try {
    const { stage, type, description } = req.body || {};
    if (!type || !description) {
      return res.status(400).json({ error: 'Thiếu trường "type" hoặc "description".', code: 'INVALID_REQUEST' });
    }
    const changedBy = (req.user && (req.user.hoTen || req.user.username)) || 'unknown';
    const result = await repo.createException(req.params.orderId, { stage, type, description, changedBy }, req.branch);
    res.status(201).json(result);
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/orders/:orderId/exceptions');
  }
});

// ---------------------------------------------------------------------------
// 10. GET /api/shipment/exceptions — danh sach su co (dung nen cho 1D)
// ---------------------------------------------------------------------------

router.get('/api/shipment/exceptions', ...authInternal, async (req, res) => {
  try {
    const { status } = req.query;
    const exceptions = await repo.listExceptions(status ? { status } : {}, req.branch);
    res.status(200).json({ exceptions });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/exceptions');
  }
});

// ---------------------------------------------------------------------------
// 11. PATCH /api/shipment/exceptions/:exceptionId — giai quyet su co
// ---------------------------------------------------------------------------

router.patch('/api/shipment/exceptions/:exceptionId', ...authInternal, async (req, res) => {
  try {
    const { resolution, note } = req.body || {};
    if (!['RESUME', 'CANCEL'].includes(resolution)) {
      return res.status(400).json({
        error: 'Trường "resolution" phải là "RESUME" hoặc "CANCEL".',
        code: 'INVALID_REQUEST'
      });
    }
    const resolver = (req.user && (req.user.hoTen || req.user.username)) || 'unknown';
    const result = await repo.resolveException(req.params.exceptionId, { resolution, resolver, note }, req.branch);
    res.status(200).json(result);
  } catch (err) {
    handleError(res, err, 'PATCH /api/shipment/exceptions/:exceptionId');
  }
});

// ---------------------------------------------------------------------------
// 12. GET /api/shipment/vehicles — danh muc xe
// ---------------------------------------------------------------------------

router.get('/api/shipment/vehicles', ...authInternal, async (req, res) => {
  try {
    const vehicles = await repo.getVehicles(req.branch);
    res.status(200).json({ vehicles });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/vehicles');
  }
});

// ---------------------------------------------------------------------------
// 13. POST /api/shipment/vehicles — them xe moi
// ---------------------------------------------------------------------------

router.post('/api/shipment/vehicles', ...authDispatch, async (req, res) => {
  try {
    const { vehicle_id, plate_number, vehicle_type, default_driver, max_weight, notes } = req.body || {};
    if (!vehicle_id || !plate_number || !vehicle_type) {
      return res.status(400).json({ error: 'Thiếu trường bắt buộc: vehicle_id, plate_number, vehicle_type.', code: 'INVALID_REQUEST' });
    }
    const vehicle = await repo.createVehicle({ vehicle_id, plate_number, vehicle_type, default_driver, max_weight, notes }, req.branch);
    res.status(201).json({ vehicle });
  } catch (err) {
    handleError(res, err, 'POST /api/shipment/vehicles');
  }
});

// ---------------------------------------------------------------------------
// 14. PATCH /api/shipment/vehicles/:vehicleId — cap nhat thong tin xe
// ---------------------------------------------------------------------------

router.patch('/api/shipment/vehicles/:vehicleId', ...authDispatch, async (req, res) => {
  try {
    const { plate_number, vehicle_type, default_driver, max_weight, notes } = req.body || {};
    const vehicle = await repo.updateVehicle(req.params.vehicleId, { plate_number, vehicle_type, default_driver, max_weight, notes }, req.branch);
    res.status(200).json({ vehicle });
  } catch (err) {
    handleError(res, err, 'PATCH /api/shipment/vehicles/:vehicleId');
  }
});

// ---------------------------------------------------------------------------
// 15. GET /api/shipment/invoices/pending — hóa đơn KiotViet chưa tạo đơn VC
// ---------------------------------------------------------------------------

router.get('/api/shipment/invoices/pending', ...authDispatch, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    // Doc sheet Hoa don goc KiotViet
    const invoiceRows = await sheetsClient.getSheetsClient(req.branch).getValues(CONFIG.SHEET_INVOICES);
    if (!invoiceRows.length) return res.status(200).json({ invoices: [] });

    const [headers, ...dataRows] = invoiceRows;
    const idx = {
      code:    headers.findIndex(h => String(h || '').trim() === 'Mã hóa đơn'),
      date:    headers.findIndex(h => String(h || '').trim() === 'Ngày'),
      name:    headers.findIndex(h => String(h || '').trim() === 'Tên khách'),
      phone:   headers.findIndex(h => String(h || '').trim() === 'Số điện thoại'),
      address: headers.findIndex(h => String(h || '').trim() === 'Địa chỉ'),
      amount:  headers.findIndex(h => String(h || '').trim() === 'Tổng tiền')
    };

    if (idx.code < 0) {
      return res.status(500).json({ error: 'Sheet hóa đơn thiếu cột "Mã hóa đơn".', code: 'SHEET_CONFIG_ERROR' });
    }

    // Doc tat ca don VC de biet kiotviet_code da ton tai
    const existingOrders = await repo.getOrders({}, req.branch);
    const usedCodes = new Set(
      existingOrders.map(o => String(o.kiotviet_code || '').trim()).filter(Boolean)
    );

    // Loc hoa don chua co don VC
    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;

    function cellAt(row, i) { return i >= 0 && i < row.length ? String(row[i] || '').trim() : ''; }

    const invoices = [];
    for (const row of dataRows) {
      const code = cellAt(row, idx.code);
      if (!code) continue;
      if (usedCodes.has(code)) continue;

      // Loc theo ngay neu co
      if ((from || to) && idx.date >= 0) {
        const rawDate = cellAt(row, idx.date);
        if (rawDate) {
          const d = new Date(rawDate);
          if (from && d < from) continue;
          if (to   && d > to)   continue;
        }
      }

      invoices.push({
        kiotviet_code:  code,
        invoice_date:   cellAt(row, idx.date),
        customer_name:  cellAt(row, idx.name),
        customer_phone: cellAt(row, idx.phone),
        address:        cellAt(row, idx.address),
        amount:         cellAt(row, idx.amount)
      });
    }

    res.status(200).json({ invoices });
  } catch (err) {
    handleError(res, err, 'GET /api/shipment/invoices/pending');
  }
});

module.exports = router;
