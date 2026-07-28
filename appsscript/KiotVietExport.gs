/**
 * KIOTVIET -> GOOGLE SHEETS EXPORT
 * ==========================================
 * Lấy dữ liệu trực tiếp từ KiotViet Public API và đổ vào các sheet trong
 * file Google Sheets này. Sau khi chạy xong, dùng File > Download > Microsoft
 * Excel (.xlsx) để xuất ra Excel phục vụ thống kê.
 *
 * CÀI ĐẶT LẦN ĐẦU (đồng bộ toàn bộ dữ liệu):
 * 1. Mở Google Sheets > Extensions > Apps Script, dán toàn bộ file này vào.
 * 2. Lưu, quay lại Sheets, tải lại trang -> menu "KiotViet" sẽ xuất hiện.
 * 3. Chọn "Đồng bộ tất cả" (lần đầu có thể mất vài phút do phân trang).
 *
 * BẬT CẬP NHẬT REAL-TIME (KiotViet đẩy thay đổi về ngay lập tức qua webhook):
 * 4. Trong Apps Script editor: Deploy > New deployment > chọn loại "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    Bấm Deploy, copy "Web app URL" (dạng https://script.google.com/macros/s/.../exec).
 * 5. Quay lại Sheets > menu KiotViet > "Bật cập nhật real-time (đăng ký Webhook)".
 *    Dán Web app URL vừa copy vào hộp thoại hiện ra.
 *    -> Từ giờ mỗi khi có Hàng hóa/Tồn kho/Khách hàng/Hóa đơn/Đặt hàng/Nhóm hàng
 *       thay đổi trên KiotViet, sheet tương ứng sẽ tự cập nhật gần như ngay lập tức.
 * 6. Chọn thêm "Bật lịch tự động 5 phút (Trả hàng, NCC, Nhập hàng)"
 *    vì KiotViet KHÔNG có webhook cho 3 bảng này (không có type return.*/
 *    supplier.*/purchaseorder.*) — chỉ có thể polling định kỳ, không thể real-time
 *    tuyệt đối cho 3 bảng này dù cấu hình thế nào.
 *
 * Nếu deploy lại (New deployment) thì URL web app đổi -> phải đăng ký lại webhook
 * (chạy lại bước 5, hệ thống tự xóa webhook cũ trước khi đăng ký cái mới).
 *
 * Vẫn có thể chạy "Đồng bộ tất cả" bất cứ lúc nào để đồng bộ lại toàn bộ (full
 * refresh), độc lập với cơ chế real-time ở trên.
 */

const KV_CLIENT_ID = '7e146353-e5e8-49ac-84f9-646f443d9237';
const KV_CLIENT_SECRET = 'D8F6FF4E0DCA02210CE3CD92D97004AA62A89C3B';
const KV_RETAILER = 'CHbansi';

const KV_BASE_URL = 'https://public.kiotapi.com';
const KV_PAGE_SIZE = 100;

// ---------- MENU ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KiotViet')
    .addItem('Đồng bộ tất cả (full refresh)', 'syncAll')
    .addSeparator()
    .addItem('Bán hàng (Hóa đơn, Đặt hàng, Trả hàng)', 'syncSales')
    .addItem('Hàng hóa & Kho (Sản phẩm, Nhóm hàng)', 'syncProductsAndStock')
    .addItem('Khách hàng', 'syncCustomers')
    .addItem('Nhà cung cấp & Nhập hàng', 'syncSuppliers')
    .addSeparator()
    .addItem('Bật cập nhật real-time (đăng ký Webhook)', 'setupRealtimeWebhook')
    .addItem('Tắt cập nhật real-time (xóa Webhook)', 'removeRealtimeWebhook')
    .addItem('Bật lịch tự động 5 phút (Trả hàng, NCC, Nhập hàng)', 'setupPollingTrigger')
    .addItem('Tắt lịch tự động', 'removePollingTrigger')
    .addToUi();
}

function syncAll() {
  syncProductsAndStock();
  syncSales();
  syncCustomers();
  syncSuppliers();
  SpreadsheetApp.getUi().alert('Đã đồng bộ xong toàn bộ dữ liệu KiotViet.');
}

// ---------- AUTH ----------

function getKiotVietToken_() {
  const response = UrlFetchApp.fetch('https://id.kiotviet.vn/connect/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      scopes: 'PublicApi.Access',
      grant_type: 'client_credentials',
      client_id: KV_CLIENT_ID,
      client_secret: KV_CLIENT_SECRET
    },
    muteHttpExceptions: true
  });
  const data = JSON.parse(response.getContentText());
  if (!data.access_token) throw new Error('Không lấy được KiotViet token: ' + response.getContentText());
  return data.access_token;
}

// ---------- FETCH ----------

/**
 * Lấy toàn bộ dữ liệu (mọi trang) của một endpoint KiotViet.
 * @param {string} path - vd: 'products', 'invoices', 'customers'
 * @param {string} extraQuery - query string bổ sung, vd: '&includeInventory=true'
 */
function kvFetchAllPages_(path, extraQuery) {
  const token = getKiotVietToken_();
  const retailer = KV_RETAILER;
  let all = [];
  let currentItem = 0;
  let total = 0;

  do {
    const url = `${KV_BASE_URL}/${path}?pageSize=${KV_PAGE_SIZE}&currentItem=${currentItem}${extraQuery || ''}`;
    const response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Retailer: retailer },
      muteHttpExceptions: true
    });
    const result = JSON.parse(response.getContentText());
    if (!result.data) {
      throw new Error(`Lỗi gọi KiotViet API (${path}): ${response.getContentText()}`);
    }
    all = all.concat(result.data);
    total = result.total || 0;
    currentItem += KV_PAGE_SIZE;
    Utilities.sleep(150); // tránh rate-limit
  } while (currentItem < total);

  return all;
}

// ---------- SHEET HELPERS ----------

function writeSheet_(sheetName, headers, rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function fmtDate_(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm:ss');
}

/**
 * Cập nhật 1 dòng theo mã (cột đầu tiên) mà KHÔNG xóa toàn bộ sheet:
 * nếu đã có mã -> ghi đè dòng đó; nếu chưa có -> thêm dòng mới ở cuối.
 */
function upsertRow_(sheetName, headers, code, rowValues) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let r = 0; r < codes.length; r++) {
      if (String(codes[r][0]) === String(code)) {
        sheet.getRange(r + 2, 1, 1, rowValues.length).setValues([rowValues]);
        return;
      }
    }
  }
  sheet.appendRow(rowValues);
}

/**
 * Xóa mọi dòng có mã hóa đơn khớp trong "Chi tiết hóa đơn" rồi thêm lại
 * (dùng khi hóa đơn được cập nhật, vì số dòng chi tiết có thể thay đổi).
 */
function replaceInvoiceDetailRows_(invoiceCode, newRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Chi tiết hóa đơn';
  let sheet = ss.getSheetByName(sheetName);
  const headers = ['Mã hóa đơn', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá', 'Thành tiền'];
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let r = codes.length - 1; r >= 0; r--) {
      if (String(codes[r][0]) === String(invoiceCode)) sheet.deleteRow(r + 2);
    }
  }
  newRows.forEach(row => sheet.appendRow(row));
}

// ---------- HÀNG HÓA & KHO ----------

function syncProductsAndStock() {
  syncCategories_();
  syncProducts_();
}

function syncCategories_() {
  const categories = kvFetchAllPages_('categories');
  const headers = ['Mã nhóm hàng', 'Tên nhóm hàng', 'Mã nhóm cha'];
  const rows = categories.map(c => [c.categoryId || '', c.categoryName || '', c.parentId || '']);
  writeSheet_('Nhóm hàng', headers, rows);
}

function syncProducts_() {
  const products = kvFetchAllPages_('products', '&includeInventory=true');
  const headers = [
    'Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Thương hiệu', 'Loại',
    'Giá vốn', 'Giá bán', 'Tồn kho', 'Khách đặt', 'Ngày sửa cuối'
  ];
  const rows = products.map(p => {
    const tonKho = p.inventories ? p.inventories.reduce((s, i) => s + (i.onHand || 0), 0) : (p.totalOnHand || 0);
    const khachDat = p.inventories ? p.inventories.reduce((s, i) => s + (i.reserved || 0), 0) : (p.totalReserved || 0);
    return [
      p.code || '', p.fullName || p.name || '', p.categoryName || '', p.tradeMarkName || '',
      p.type === 2 ? 'Combo' : (p.type === 3 ? 'Dịch vụ' : 'Hàng hóa'),
      p.basePrice ? p.basePrice : (p.cost || 0),
      p.basePrice || 0, tonKho, khachDat, fmtDate_(p.modifiedDate || p.createdDate)
    ];
  });
  writeSheet_('Hàng hóa', headers, rows);
}

// ---------- BÁN HÀNG ----------

function syncSales() {
  syncInvoices_();
  syncOrders_();
  syncReturns_();
}

function syncInvoices_() {
  const invoices = kvFetchAllPages_('invoices', '&includePayment=true');
  const headers = ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán', 'Chi nhánh', 'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái'];
  const rows = invoices.map(i => [
    i.code || '', fmtDate_(i.purchaseDate), i.customerName || 'Khách lẻ', i.customerContactNumber || '',
    i.soldByName || '', i.branchName || '', i.total || 0, i.discount || 0, i.totalPayment || i.actualPayment || 0,
    i.status === 2 ? 'Đã hủy' : (i.status === 3 ? 'Hoàn thành' : 'Đang xử lý')
  ]);
  writeSheet_('Hóa đơn', headers, rows);

  const detailHeaders = ['Mã hóa đơn', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá', 'Thành tiền'];
  const detailRows = [];
  invoices.forEach(i => {
    (i.invoiceDetails || []).forEach(d => {
      detailRows.push([
        i.code || '', d.productCode || '', d.productName || '', d.quantity || 0,
        d.price || 0, d.discount || 0, (d.price || 0) * (d.quantity || 0) - (d.discount || 0)
      ]);
    });
  });
  writeSheet_('Chi tiết hóa đơn', detailHeaders, detailRows);
}

function syncOrders_() {
  const orders = kvFetchAllPages_('orders');
  const headers = ['Mã đặt hàng', 'Ngày đặt', 'Khách hàng', 'Nhân viên lập', 'Chi nhánh', 'Tổng tiền', 'Trạng thái'];
  const statusMap = { 1: 'Phiếu tạm', 2: 'Đang xử lý', 3: 'Đã xác nhận', 4: 'Đã hủy', 5: 'Hoàn thành' };
  const rows = orders.map(o => [
    o.code || '', fmtDate_(o.purchaseDate), o.customerName || 'Khách lẻ', o.soldByName || '',
    o.branchName || '', o.total || 0, statusMap[o.status] || o.status || ''
  ]);
  writeSheet_('Đặt hàng', headers, rows);
}

function syncReturns_() {
  const returns = kvFetchAllPages_('returns');
  const headers = ['Mã trả hàng', 'Ngày trả', 'Mã hóa đơn gốc', 'Khách hàng', 'Tổng tiền trả', 'Trạng thái'];
  const rows = returns.map(r => [
    r.code || '', fmtDate_(r.returnDate), r.invoiceCode || '', r.customerName || 'Khách lẻ',
    r.returnTotal || 0, r.status === 1 ? 'Hoàn thành' : (r.status || '')
  ]);
  writeSheet_('Trả hàng', headers, rows);
}

// ---------- KHÁCH HÀNG ----------

function syncCustomers() {
  const customers = kvFetchAllPages_('customers');
  const headers = ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Giới tính', 'Nhóm khách hàng', 'Địa chỉ', 'Email', 'Nợ hiện tại', 'Tổng bán'];
  const rows = customers.map(c => [
    c.code || '', c.name || '', c.contactNumber || '', c.gender === true ? 'Nam' : (c.gender === false ? 'Nữ' : ''),
    c.groupName || '', c.address || '', c.email || '', c.debt || 0, c.totalInvoiced || 0
  ]);
  writeSheet_('Khách hàng', headers, rows);
}

// ---------- NHÀ CUNG CẤP & NHẬP HÀNG ----------

function syncSuppliers() {
  const suppliers = kvFetchAllPages_('suppliers');
  const supplierHeaders = ['Mã NCC', 'Tên NCC', 'Điện thoại', 'Email', 'Địa chỉ', 'Nợ cần trả'];
  const supplierRows = suppliers.map(s => [
    s.code || '', s.name || '', s.contactNumber || '', s.email || '', s.address || '', s.debt || 0
  ]);
  writeSheet_('Nhà cung cấp', supplierHeaders, supplierRows);

  const purchaseOrders = kvFetchAllPages_('purchaseorders');
  const poHeaders = ['Mã nhập hàng', 'Ngày nhập', 'Nhà cung cấp', 'Chi nhánh', 'Tổng tiền', 'Trạng thái'];
  const poRows = purchaseOrders.map(p => [
    p.code || '', fmtDate_(p.purchaseDate), p.supplierName || '', p.branchName || '',
    p.total || 0, p.status === 1 ? 'Hoàn thành' : (p.status || '')
  ]);
  writeSheet_('Nhập hàng', poHeaders, poRows);
}

// ---------- REAL-TIME QUA WEBHOOK ----------

/**
 * Điểm nhận webhook từ KiotViet (sau khi deploy Web App và đăng ký qua
 * setupRealtimeWebhook). KiotViet gửi POST JSON dạng { Notifications: [...] }
 * mỗi khi có thay đổi. Hàm này cập nhật đúng dòng thay đổi, không đồng bộ lại
 * toàn bộ để tránh chậm/giới hạn quota.
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const notifications = payload.Notifications || payload.notifications || [payload];

    notifications.forEach(noti => {
      const action = String(noti.Action || noti.action || '').toLowerCase();
      const items = noti.Data || noti.data || [];
      if (!items || items.length === 0) return;

      if (action.includes('product') || action.includes('stock')) {
        items.forEach(upsertProductFromWebhook_);
      } else if (action.includes('invoice')) {
        items.forEach(upsertInvoiceFromWebhook_);
      } else if (action.includes('order')) {
        items.forEach(upsertOrderFromWebhook_);
      } else if (action.includes('customer')) {
        items.forEach(upsertCustomerFromWebhook_);
      } else if (action.includes('category')) {
        items.forEach(upsertCategoryFromWebhook_);
      }
    });
  } catch (err) {
    // Vẫn trả 200 để KiotViet không retry liên tục vì lỗi payload lạ.
    console.error('doPost error: ' + err);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function upsertProductFromWebhook_(p) {
  const code = p.Code || p.code || p.ProductCode;
  if (!code) return;
  const headers = ['Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Thương hiệu', 'Loại', 'Giá vốn', 'Giá bán', 'Tồn kho', 'Khách đặt', 'Ngày sửa cuối'];
  const inventories = p.Inventories || p.inventories || [];
  const tonKho = inventories.length ? inventories.reduce((s, i) => s + (i.OnHand || i.onHand || 0), 0) : (p.OnHand !== undefined ? p.OnHand : (p.onHand || 0));
  const khachDat = inventories.length ? inventories.reduce((s, i) => s + (i.Reserved || i.reserved || 0), 0) : (p.Reserved !== undefined ? p.Reserved : (p.reserved || 0));
  const row = [
    code, p.Name || p.name || p.FullName || p.fullName || '', p.CategoryName || p.categoryName || '',
    p.TradeMarkName || p.tradeMarkName || '', '',
    p.Cost !== undefined ? p.Cost : (p.cost || 0), p.BasePrice !== undefined ? p.BasePrice : (p.basePrice || 0),
    tonKho, khachDat, fmtDate_(p.ModifiedDate || p.modifiedDate || new Date())
  ];
  upsertRow_('Hàng hóa', headers, code, row);
}

function upsertInvoiceFromWebhook_(i) {
  const code = i.InvoiceCode || i.Code || i.code;
  if (!code) return;
  const headers = ['Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán', 'Chi nhánh', 'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái'];
  const status = i.Status !== undefined ? i.Status : i.status;
  const row = [
    code, fmtDate_(i.PurchaseDate || i.purchaseDate || new Date()), i.CustomerName || i.customerName || 'Khách lẻ',
    i.CustomerContactNumber || i.customerContactNumber || '', i.SoldByName || i.soldByName || '',
    i.BranchName || i.branchName || '', i.Total !== undefined ? i.Total : (i.total || 0),
    i.Discount !== undefined ? i.Discount : (i.discount || 0),
    i.TotalPayment !== undefined ? i.TotalPayment : (i.ActualPayment !== undefined ? i.ActualPayment : (i.actualPayment || 0)),
    status === 2 ? 'Đã hủy' : (status === 3 ? 'Hoàn thành' : 'Đang xử lý')
  ];
  upsertRow_('Hóa đơn', headers, code, row);

  const details = i.InvoiceDetails || i.invoiceDetails;
  if (Array.isArray(details)) {
    const detailRows = details.map(d => {
      const price = d.Price !== undefined ? d.Price : (d.price || 0);
      const qty = d.Quantity !== undefined ? d.Quantity : (d.quantity || 0);
      const discount = d.Discount !== undefined ? d.Discount : (d.discount || 0);
      return [code, d.ProductCode || d.productCode || '', d.ProductName || d.productName || '', qty, price, discount, price * qty - discount];
    });
    replaceInvoiceDetailRows_(code, detailRows);
  }
}

function upsertOrderFromWebhook_(o) {
  const code = o.Code || o.code;
  if (!code) return;
  const headers = ['Mã đặt hàng', 'Ngày đặt', 'Khách hàng', 'Nhân viên lập', 'Chi nhánh', 'Tổng tiền', 'Trạng thái'];
  const statusMap = { 1: 'Phiếu tạm', 2: 'Đang xử lý', 3: 'Đã xác nhận', 4: 'Đã hủy', 5: 'Hoàn thành' };
  const status = o.Status !== undefined ? o.Status : o.status;
  const row = [
    code, fmtDate_(o.PurchaseDate || o.purchaseDate || new Date()), o.CustomerName || o.customerName || 'Khách lẻ',
    o.SoldByName || o.soldByName || '', o.BranchName || o.branchName || '',
    o.Total !== undefined ? o.Total : (o.total || 0), statusMap[status] || status || ''
  ];
  upsertRow_('Đặt hàng', headers, code, row);
}

function upsertCustomerFromWebhook_(c) {
  const code = c.Code || c.code;
  if (!code) return;
  const headers = ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Giới tính', 'Nhóm khách hàng', 'Địa chỉ', 'Email', 'Nợ hiện tại', 'Tổng bán'];
  const gender = c.Gender !== undefined ? c.Gender : c.gender;
  const row = [
    code, c.Name || c.name || '', c.ContactNumber || c.contactNumber || '',
    gender === true ? 'Nam' : (gender === false ? 'Nữ' : ''), c.GroupName || c.groupName || '',
    c.Address || c.address || '', c.Email || c.email || '',
    c.Debt !== undefined ? c.Debt : (c.debt || 0), c.TotalInvoiced !== undefined ? c.TotalInvoiced : (c.totalInvoiced || 0)
  ];
  upsertRow_('Khách hàng', headers, code, row);
}

function upsertCategoryFromWebhook_(c) {
  const code = c.CategoryId !== undefined ? c.CategoryId : (c.categoryId !== undefined ? c.categoryId : (c.Id || c.id));
  if (code === undefined || code === null || code === '') return;
  const headers = ['Mã nhóm hàng', 'Tên nhóm hàng', 'Mã nhóm cha'];
  const row = [
    code, c.CategoryName || c.categoryName || c.Name || c.name || '',
    c.ParentId !== undefined ? c.ParentId : (c.parentId || '')
  ];
  upsertRow_('Nhóm hàng', headers, code, row);
}

const KV_WEBHOOK_EVENT_TYPES = ['product.update', 'product.delete', 'stock.update', 'customer.update', 'customer.delete', 'invoice.update', 'order.update', 'category.update', 'category.delete'];

function kvAuthHeaders_() {
  return { Authorization: 'Bearer ' + getKiotVietToken_(), Retailer: KV_RETAILER };
}

/**
 * Đăng ký webhook trỏ về Web App URL hiện tại (hỏi qua hộp thoại nếu chưa lưu).
 * Xóa mọi webhook cũ trỏ về cùng URL cấu hình trước khi đăng ký lại, tránh trùng.
 */
function setupRealtimeWebhook() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const resp = ui.prompt('Dán Web app URL (Deploy > New deployment > Web app > copy URL):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  const webhookUrl = resp.getResponseText().trim();
  if (!webhookUrl) { ui.alert('URL không hợp lệ.'); return; }

  removeRealtimeWebhook_silent_();

  const headers = kvAuthHeaders_();
  let successCount = 0, failCount = 0;
  KV_WEBHOOK_EVENT_TYPES.forEach(type => {
    const response = UrlFetchApp.fetch(`${KV_BASE_URL}/webhooks`, {
      method: 'post',
      headers: { ...headers, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ Webhook: { Type: type, Url: webhookUrl, IsActive: true, Description: 'Realtime Google Sheets - ' + type } }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 200 || response.getResponseCode() === 201) successCount++; else failCount++;
  });

  props.setProperty('WEBHOOK_URL', webhookUrl);
  ui.alert(`Đăng ký webhook: ${successCount} thành công, ${failCount} thất bại.`);
}

function removeRealtimeWebhook() {
  removeRealtimeWebhook_silent_();
  SpreadsheetApp.getUi().alert('Đã xóa webhook real-time.');
}

function removeRealtimeWebhook_silent_() {
  const headers = kvAuthHeaders_();
  const response = UrlFetchApp.fetch(`${KV_BASE_URL}/webhooks`, { headers, muteHttpExceptions: true });
  const result = JSON.parse(response.getContentText());
  (result.data || []).forEach(webhook => {
    UrlFetchApp.fetch(`${KV_BASE_URL}/webhooks/${webhook.id}`, { method: 'delete', headers, muteHttpExceptions: true });
  });
}

// ---------- LỊCH TỰ ĐỘNG (cho các bảng KiotViet không có webhook) ----------

const KV_POLLING_HANDLER = 'syncPollingOnly_';

function syncPollingOnly_() {
  syncReturns_();
  syncSuppliers();
}

function setupPollingTrigger() {
  removePollingTrigger_silent_();
  // KiotViet Public API không phát webhook cho Trả hàng / Nhà cung cấp / Nhập hàng
  // (không có type "return.*", "supplier.*", "purchaseorder.*") -> 5 phút là mức
  // nhanh nhất Apps Script hỗ trợ ổn định cho time-based trigger.
  ScriptApp.newTrigger(KV_POLLING_HANDLER).timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert('Đã bật lịch tự động: đồng bộ Trả hàng / Nhà cung cấp / Nhập hàng mỗi 5 phút (KiotViet không hỗ trợ webhook cho 3 bảng này).');
}

function removePollingTrigger() {
  removePollingTrigger_silent_();
  SpreadsheetApp.getUi().alert('Đã tắt lịch tự động.');
}

function removePollingTrigger_silent_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === KV_POLLING_HANDLER) ScriptApp.deleteTrigger(t);
  });
}
