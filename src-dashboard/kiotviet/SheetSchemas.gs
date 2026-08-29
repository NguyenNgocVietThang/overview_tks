// ==========================================
// SCHEMA KIOTVIET -> GOOGLE SHEETS
// ==========================================

/**
 * Moi sheet giu cac cot dashboard dang dung o ben trai, sau do bo sung cac
 * truong Public API dang duoc su dung. Object/mang long khong duoc ghi vao
 * Sheets de bang tinh gon, de doc va khong cham do payload JSON lon.
 */

const KIOTVIET_SHEET_SCHEMA_VERSION = '2026-08-25-compact-columns-v2';
const KIOTVIET_SHEET_SCHEMA_PROPERTY = 'KIOTVIET_SHEET_SCHEMA_VERSION';
const KIOTVIET_INVOICE_BACKFILL_LAST_RESULT_PROPERTY_ = 'KIOTVIET_INVOICE_BACKFILL_LAST_RESULT';

/**
 * Trang thai doi soat backfill Hoa don gan nhat. Ham nay khong goi API, nen co
 * the dung de theo doi trigger tiep suc ma khong tranh quota voi tien trinh tai.
 */
function getInvoiceBackfillStatus() {
  const props = PropertiesService.getScriptProperties();
  let checkpoint = null;
  let lastResult = null;
  try {
    const rawCheckpoint = props.getProperty('SYNC_CHUNK_STATE_invoices');
    if (rawCheckpoint) checkpoint = JSON.parse(rawCheckpoint);
  } catch (e) {
    checkpoint = null;
  }
  try {
    const rawResult = props.getProperty(KIOTVIET_INVOICE_BACKFILL_LAST_RESULT_PROPERTY_);
    if (rawResult) lastResult = JSON.parse(rawResult);
  } catch (e) {
    lastResult = null;
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const invoiceSheet = spreadsheet.getSheetByName('Hóa đơn');
  const detailSheet = spreadsheet.getSheetByName('Chi tiết hóa đơn');
  const invoiceRows = invoiceSheet ? Math.max(0, invoiceSheet.getLastRow() - 1) : 0;
  const invoiceDetailRows = detailSheet ? Math.max(0, detailSheet.getLastRow() - 1) : 0;
  const isCompleted = !checkpoint && !!lastResult;

  return {
    isCompleted: isCompleted,
    phase: checkpoint ? (checkpoint.phase || 'download') : (isCompleted ? 'completed' : 'idle'),
    currentItem: checkpoint ? (Number(checkpoint.currentItem) || 0) : 0,
    total: checkpoint
      ? (Number(checkpoint.total) || 0)
      : (lastResult ? (Number(lastResult.total) || 0) : 0),
    invoiceCount: checkpoint
      ? (Number(checkpoint.invoiceCount) || 0)
      : (lastResult ? (Number(lastResult.invoiceCount) || 0) : 0),
    invoiceDetailCount: checkpoint
      ? (Number(checkpoint.invoiceDetailCount) || 0)
      : (lastResult ? (Number(lastResult.invoiceDetailCount) || 0) : 0),
    invoiceRows: invoiceRows,
    invoiceDetailRows: invoiceDetailRows,
    matchesExpected: isCompleted &&
      invoiceRows === Number(lastResult.invoiceCount) &&
      invoiceDetailRows === Number(lastResult.invoiceDetailCount),
    completedAt: lastResult ? lastResult.completedAt : null,
    updatedAt: checkpoint ? checkpoint.updatedAt : null
  };
}

const CATEGORY_SHEET_HEADERS = Object.freeze([
  'Mã nhóm hàng',
  'Tên nhóm hàng',
  'Mã nhóm cha',
  'ID gian hàng',
  'Có nhóm con',
  'Ngày sửa cuối',
  'Ngày tạo'
]);

const PRODUCT_EXTRA_HEADERS = Object.freeze([
  'ID hàng hóa',
  'ID gian hàng',
  'Được phép bán',
  'Tên gốc',
  'Mô tả',
  'Giá trị quy đổi',
  'Có thuộc tính',
  'Đang hoạt động',
  'Ngày tạo',
  'Ngày cập nhật',
  'Mã loại hàng'
]);

const INVOICE_SHEET_HEADERS = Object.freeze([
  'Mã hóa đơn',
  'Ngày bán',
  'Khách hàng',
  'SĐT khách',
  'Nhân viên bán',
  'Chi nhánh',
  'Tổng tiền hàng',
  'Giảm giá',
  'Khách đã trả',
  'Trạng thái',
  'ID hóa đơn',
  'Mã đặt hàng',
  'ID chi nhánh',
  'ID nhân viên bán',
  'ID khách hàng',
  'Mã khách hàng',
  'Mã trạng thái',
  'Tên trạng thái API',
  'Ghi chú',
  'Thu hộ COD',
  'Ngày tạo'
]);

const INVOICE_DETAIL_SHEET_HEADERS = Object.freeze([
  'Mã hóa đơn',
  'Mã hàng',
  'Tên hàng',
  'Số lượng',
  'Đơn giá',
  'Giảm giá',
  'Thành tiền',
  'ID hóa đơn',
  'ID hàng hóa',
  'Giảm giá (%)',
  'Ghi chú'
]);

const ORDER_SHEET_HEADERS = Object.freeze([
  'Mã đặt hàng',
  'Ngày đặt',
  'Khách hàng',
  'Nhân viên lập',
  'Chi nhánh',
  'Tổng tiền',
  'Trạng thái',
  'ID đặt hàng',
  'ID gian hàng',
  'ID chi nhánh',
  'ID nhân viên lập',
  'ID khách hàng',
  'Mã khách hàng',
  'Khách đã trả',
  'Giảm giá (%)',
  'Giảm giá',
  'Mã trạng thái',
  'Tên trạng thái API',
  'Ghi chú',
  'Thu hộ COD',
  'Ngày tạo',
  'Ngày cập nhật'
]);

const RETURN_SHEET_HEADERS = Object.freeze([
  'Mã trả hàng',
  'Ngày trả',
  'Khách hàng',
  'Tổng tiền trả',
  'Trạng thái',
  'ID trả hàng',
  'ID hóa đơn gốc',
  'ID chi nhánh',
  'Chi nhánh',
  'ID người nhận trả',
  'Nhân viên bán',
  'ID khách hàng',
  'Mã khách hàng',
  'Giảm giá trả hàng',
  'Phí trả hàng',
  'Tổng thanh toán',
  'Mã trạng thái',
  'Tên trạng thái API',
  'Ngày tạo',
  'Ngày cập nhật'
]);

const CUSTOMER_SHEET_HEADERS = Object.freeze([
  'Mã khách hàng',
  'Tên khách hàng',
  'Điện thoại',
  'Nhóm khách hàng',
  'Địa chỉ',
  'Nợ hiện tại',
  'Tổng bán',
  'ID khách hàng',
  'Điện thoại phụ',
  'Công ty',
  'Tổng doanh thu',
  'ID gian hàng',
  'Ngày tạo'
]);

const SUPPLIER_SHEET_HEADERS = Object.freeze([
  'Mã NCC',
  'Tên NCC',
  'Điện thoại',
  'Địa chỉ',
  'Nợ cần trả',
  'ID nhà cung cấp',
  'Trạng thái hoạt động',
  'Ngày cập nhật',
  'Ngày tạo',
  'ID gian hàng',
  'ID chi nhánh tạo',
  'Người tạo',
  'Tổng mua',
  'Tổng mua trừ trả hàng'
]);

// Cau truc y het file "Danh sach chi tiet nhap hang" xuat tu KiotViet: moi
// dong la mot mat hang trong phieu nhap (thong tin phieu nhap duoc lap lai
// tren tung dong mat hang cua chinh phieu do).
const PURCHASE_SHEET_HEADERS = Object.freeze([
  'Chi nhánh',
  'Mã nhập hàng',
  'Thời gian',
  'Thời gian tạo',
  'Mã nhà cung cấp',
  'Tên nhà cung cấp',
  'Người nhập',
  'Người tạo',
  'Tổng tiền hàng',
  'Giảm giá phiếu nhập',
  'Cần trả NCC',
  'Tiền đã trả NCC',
  'Ghi chú',
  'Tổng số lượng',
  'Tổng số mặt hàng',
  'Trạng thái',
  'Mã hàng',
  'Tên hàng',
  'Đơn giá',
  'Giảm giá %',
  'Giảm giá',
  'Giá nhập',
  'Thành tiền',
  'Số lượng'
]);

function pickKiotVietValue_(source, keys) {
  const object = source || {};
  for (let i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(object, keys[i])) {
      return { found: true, value: object[keys[i]] };
    }
  }
  return { found: false, value: undefined };
}

function kiotVietValue_(source, keys, defaultValue) {
  const result = pickKiotVietValue_(source, keys);
  return result.found ? result.value : defaultValue;
}

function kiotVietText_(source, keys, defaultValue) {
  const value = kiotVietValue_(source, keys, defaultValue === undefined ? '' : defaultValue);
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Tranh Google Sheets hieu noi dung tu KiotViet bat dau bang "=" la cong thuc.
  return text.charAt(0) === '=' ? "'" + text : text;
}

function kiotVietId_(source, keys) {
  const value = kiotVietValue_(source, keys, '');
  return value === null || value === undefined || value === '' ? '' : String(value);
}

function kiotVietNumber_(source, keys, defaultValue) {
  const value = kiotVietValue_(source, keys, defaultValue === undefined ? 0 : defaultValue);
  if (value === '' || value === null || value === undefined) {
    return defaultValue === undefined ? 0 : defaultValue;
  }
  const numberValue = Number(value);
  return isFinite(numberValue) ? numberValue : (defaultValue === undefined ? 0 : defaultValue);
}

function kiotVietDate_(source, keys) {
  const result = pickKiotVietValue_(source, keys);
  if (!result.found || !result.value) return '';
  const formatted = formatDate(result.value);
  return formatted === '---' ? '' : formatted;
}

function kiotVietBooleanText_(source, keys) {
  const result = pickKiotVietValue_(source, keys);
  if (!result.found || result.value === null || result.value === '') return '';
  return result.value === true ? 'Có' : (result.value === false ? 'Không' : String(result.value));
}

function kiotVietGender_(source) {
  const result = pickKiotVietValue_(source, ['Gender', 'gender']);
  if (!result.found || result.value === null || result.value === '') return '';
  return result.value === true ? 'Nam' : (result.value === false ? 'Nữ' : String(result.value));
}

function kiotVietCustomerGroups_(source) {
  const direct = pickKiotVietValue_(source, ['GroupName', 'groupName', 'Groups', 'groups']);
  if (direct.found && direct.value !== null && direct.value !== '') {
    if (Array.isArray(direct.value)) {
      return direct.value.map(item => {
        if (typeof item === 'string') return item;
        return kiotVietText_(item, ['Name', 'name', 'GroupName', 'groupName']);
      }).filter(Boolean).join(', ');
    }
    return String(direct.value);
  }

  const details = kiotVietValue_(source, ['CustomerGroupDetails', 'customerGroupDetails'], []);
  return (Array.isArray(details) ? details : []).map(item => {
    return kiotVietText_(item, ['GroupName', 'groupName', 'Name', 'name']);
  }).filter(Boolean).join(', ');
}

function kiotVietStatus_(source, fallbackMap) {
  const statusValue = kiotVietText_(source, ['StatusValue', 'statusValue']);
  if (statusValue) return statusValue;
  const status = kiotVietValue_(source, ['Status', 'status'], '');
  if (Object.prototype.hasOwnProperty.call(fallbackMap || {}, status)) return fallbackMap[status];
  return status === null || status === undefined ? '' : String(status);
}

function buildCategorySheetRow_(category) {
  return [
    kiotVietId_(category, ['CategoryId', 'categoryId', 'Id', 'id']),
    kiotVietText_(category, ['CategoryName', 'categoryName', 'Name', 'name']),
    kiotVietId_(category, ['ParentId', 'parentId']),
    kiotVietId_(category, ['RetailerId', 'retailerId']),
    kiotVietBooleanText_(category, ['HasChild', 'hasChild']),
    kiotVietDate_(category, ['ModifiedDate', 'modifiedDate']),
    kiotVietDate_(category, ['CreatedDate', 'createdDate'])
  ];
}

function buildFullProductSheetRow_(product) {
  const baseRow = buildProductSheetRow_(product);
  return baseRow.concat([
    kiotVietId_(product, ['Id', 'id', 'ProductId', 'productId']),
    kiotVietId_(product, ['RetailerId', 'retailerId']),
    kiotVietBooleanText_(product, ['AllowsSale', 'allowsSale']),
    kiotVietText_(product, ['Name', 'name']),
    kiotVietText_(product, ['Description', 'description']),
    kiotVietNumber_(product, ['ConversionValue', 'conversionValue'], ''),
    kiotVietBooleanText_(product, ['HasVariants', 'hasVariants']),
    kiotVietBooleanText_(product, ['IsActive', 'isActive']),
    kiotVietDate_(product, ['CreatedDate', 'createdDate']),
    kiotVietDate_(product, ['ModifiedDate', 'modifiedDate']),
    kiotVietValue_(product, ['Type', 'type', 'ProductType', 'productType'], '')
  ]);
}

function buildInvoiceSheetRow_(invoice) {
  return [
    kiotVietText_(invoice, ['InvoiceCode', 'invoiceCode', 'Code', 'code']),
    kiotVietDate_(invoice, ['PurchaseDate', 'purchaseDate']),
    kiotVietText_(invoice, ['CustomerName', 'customerName'], 'Khách lẻ') || 'Khách lẻ',
    kiotVietText_(invoice, ['CustomerContactNumber', 'customerContactNumber', 'ContactNumber', 'contactNumber']),
    kiotVietText_(invoice, ['SoldByName', 'soldByName']),
    kiotVietText_(invoice, ['BranchName', 'branchName']),
    kiotVietNumber_(invoice, ['Total', 'total']),
    kiotVietNumber_(invoice, ['Discount', 'discount']),
    kiotVietNumber_(invoice, ['TotalPayment', 'totalPayment', 'ActualPayment', 'actualPayment']),
    kiotVietStatus_(invoice, { 1: 'Phiếu tạm', 2: 'Đã hủy', 3: 'Hoàn thành' }),
    kiotVietId_(invoice, ['Id', 'id', 'InvoiceId', 'invoiceId']),
    kiotVietText_(invoice, ['OrderCode', 'orderCode']),
    kiotVietId_(invoice, ['BranchId', 'branchId']),
    kiotVietId_(invoice, ['SoldById', 'soldById']),
    kiotVietId_(invoice, ['CustomerId', 'customerId']),
    kiotVietText_(invoice, ['CustomerCode', 'customerCode']),
    kiotVietValue_(invoice, ['Status', 'status'], ''),
    kiotVietText_(invoice, ['StatusValue', 'statusValue']),
    kiotVietText_(invoice, ['Description', 'description']),
    kiotVietBooleanText_(invoice, ['UsingCod', 'usingCod']),
    kiotVietDate_(invoice, ['CreatedDate', 'createdDate'])
  ];
}

function buildInvoiceDetailSheetRow_(invoice, detail) {
  const quantity = kiotVietNumber_(detail, ['Quantity', 'quantity']);
  const price = kiotVietNumber_(detail, ['Price', 'price']);
  const discount = kiotVietNumber_(detail, ['Discount', 'discount']);
  const subTotal = pickKiotVietValue_(detail, ['SubTotal', 'subTotal']);
  const amount = subTotal.found ? kiotVietNumber_(detail, ['SubTotal', 'subTotal']) : price * quantity - discount;

  return [
    kiotVietText_(invoice, ['InvoiceCode', 'invoiceCode', 'Code', 'code']),
    kiotVietText_(detail, ['ProductCode', 'productCode']),
    kiotVietText_(detail, ['ProductName', 'productName']),
    quantity,
    price,
    discount,
    amount,
    kiotVietId_(invoice, ['Id', 'id', 'InvoiceId', 'invoiceId']),
    kiotVietId_(detail, ['ProductId', 'productId']),
    kiotVietNumber_(detail, ['DiscountRatio', 'discountRatio'], ''),
    kiotVietText_(detail, ['Note', 'note'])
  ];
}

function buildOrderSheetRow_(order) {
  return [
    kiotVietText_(order, ['OrderCode', 'orderCode', 'Code', 'code']),
    kiotVietDate_(order, ['PurchaseDate', 'purchaseDate']),
    kiotVietText_(order, ['CustomerName', 'customerName'], 'Khách lẻ') || 'Khách lẻ',
    kiotVietText_(order, ['SoldByName', 'soldByName']),
    kiotVietText_(order, ['BranchName', 'branchName']),
    kiotVietNumber_(order, ['Total', 'total']),
    kiotVietStatus_(order, {
      1: 'Phiếu tạm',
      2: 'Đang xử lý',
      3: 'Đã xác nhận',
      4: 'Đã hủy',
      5: 'Hoàn thành'
    }),
    kiotVietId_(order, ['Id', 'id', 'OrderId', 'orderId']),
    kiotVietId_(order, ['RetailerId', 'retailerId']),
    kiotVietId_(order, ['BranchId', 'branchId']),
    kiotVietId_(order, ['SoldById', 'soldById']),
    kiotVietId_(order, ['CustomerId', 'customerId']),
    kiotVietText_(order, ['CustomerCode', 'customerCode']),
    kiotVietNumber_(order, ['TotalPayment', 'totalPayment'], ''),
    kiotVietNumber_(order, ['DiscountRatio', 'discountRatio'], ''),
    kiotVietNumber_(order, ['Discount', 'discount'], ''),
    kiotVietValue_(order, ['Status', 'status'], ''),
    kiotVietText_(order, ['StatusValue', 'statusValue']),
    kiotVietText_(order, ['Description', 'description']),
    kiotVietBooleanText_(order, ['UsingCod', 'usingCod']),
    kiotVietDate_(order, ['CreatedDate', 'createdDate']),
    kiotVietDate_(order, ['ModifiedDate', 'modifiedDate'])
  ];
}

function buildReturnSheetRow_(returnItem) {
  return [
    kiotVietText_(returnItem, ['ReturnCode', 'returnCode', 'Code', 'code']),
    kiotVietDate_(returnItem, ['ReturnDate', 'returnDate']),
    kiotVietText_(returnItem, ['CustomerName', 'customerName'], 'Khách lẻ') || 'Khách lẻ',
    kiotVietNumber_(returnItem, ['ReturnTotal', 'returnTotal']),
    kiotVietStatus_(returnItem, { 1: 'Hoàn thành', 2: 'Đã hủy' }),
    kiotVietId_(returnItem, ['Id', 'id', 'ReturnId', 'returnId']),
    kiotVietId_(returnItem, ['InvoiceId', 'invoiceId']),
    kiotVietId_(returnItem, ['BranchId', 'branchId']),
    kiotVietText_(returnItem, ['BranchName', 'branchName']),
    kiotVietId_(returnItem, ['ReceivedById', 'receivedById']),
    kiotVietText_(returnItem, ['SoldByName', 'soldByName']),
    kiotVietId_(returnItem, ['CustomerId', 'customerId']),
    kiotVietText_(returnItem, ['CustomerCode', 'customerCode']),
    kiotVietNumber_(returnItem, ['ReturnDiscount', 'returnDiscount'], ''),
    kiotVietNumber_(returnItem, ['ReturnFee', 'returnFee'], ''),
    kiotVietNumber_(returnItem, ['TotalPayment', 'totalPayment'], ''),
    kiotVietValue_(returnItem, ['Status', 'status'], ''),
    kiotVietText_(returnItem, ['StatusValue', 'statusValue']),
    kiotVietDate_(returnItem, ['CreatedDate', 'createdDate']),
    kiotVietDate_(returnItem, ['ModifiedDate', 'modifiedDate'])
  ];
}

function buildCustomerSheetRow_(customer) {
  return [
    kiotVietText_(customer, ['CustomerCode', 'customerCode', 'Code', 'code']),
    kiotVietText_(customer, ['Name', 'name', 'CustomerName', 'customerName']),
    kiotVietText_(customer, ['ContactNumber', 'contactNumber']),
    kiotVietCustomerGroups_(customer),
    kiotVietText_(customer, ['Address', 'address']),
    kiotVietNumber_(customer, ['Debt', 'debt', 'TotalDebt', 'totalDebt']),
    kiotVietNumber_(customer, ['TotalInvoiced', 'totalInvoiced']),
    kiotVietId_(customer, ['Id', 'id', 'CustomerId', 'customerId']),
    kiotVietText_(customer, ['SubNumber', 'subNumber']),
    kiotVietText_(customer, ['Organization', 'organization']),
    kiotVietNumber_(customer, ['TotalRevenue', 'totalRevenue'], ''),
    kiotVietId_(customer, ['RetailerId', 'retailerId']),
    kiotVietDate_(customer, ['CreatedDate', 'createdDate'])
  ];
}

function buildSupplierSheetRow_(supplier) {
  return [
    kiotVietText_(supplier, ['SupplierCode', 'supplierCode', 'Code', 'code']),
    kiotVietText_(supplier, ['SupplierName', 'supplierName', 'Name', 'name']),
    kiotVietText_(supplier, ['ContactNumber', 'contactNumber']),
    kiotVietText_(supplier, ['Address', 'address']),
    kiotVietNumber_(supplier, ['Debt', 'debt']),
    kiotVietId_(supplier, ['Id', 'id', 'SupplierId', 'supplierId']),
    kiotVietBooleanText_(supplier, ['IsActive', 'isActive']),
    kiotVietDate_(supplier, ['ModifiedDate', 'modifiedDate']),
    kiotVietDate_(supplier, ['CreatedDate', 'createdDate']),
    kiotVietId_(supplier, ['RetailerId', 'retailerId']),
    kiotVietId_(supplier, ['BranchId', 'branchId']),
    kiotVietText_(supplier, ['CreatedBy', 'createdBy']),
    kiotVietNumber_(supplier, ['TotalInvoiced', 'totalInvoiced'], ''),
    kiotVietNumber_(supplier, ['TotalInvoicedWithoutReturn', 'totalInvoicedWithoutReturn'], '')
  ];
}

/**
 * Lay mang chi tiet mat hang cua mot phieu nhap, chap nhan nhieu ten truong
 * KiotViet co the tra ve tuy phien ban API.
 */
function getPurchaseOrderDetails_(order) {
  const details = kiotVietValue_(order, [
    'PurchaseOrderDetails', 'purchaseOrderDetails',
    'ProductDetails', 'productDetails',
    'Details', 'details'
  ], []);
  return Array.isArray(details) ? details : [];
}

/**
 * Ghep moi phieu nhap voi tung dong mat hang cua no thanh danh sach wrapper
 * {order, detail}, giong cach lam voi Hoa don/Chi tiet hoa don. Phieu nhap
 * khong co dong mat hang nao van duoc giu lai (detail rong) de khong mat du
 * lieu phieu nhap tren sheet.
 */
function buildPurchaseOrderWrappers_(purchaseOrders) {
  const wrappers = [];
  (Array.isArray(purchaseOrders) ? purchaseOrders : []).forEach(order => {
    const details = getPurchaseOrderDetails_(order);
    if (details.length === 0) {
      wrappers.push({ order: order, detail: {} });
      return;
    }
    details.forEach(detail => wrappers.push({ order: order, detail: detail }));
  });
  return wrappers;
}

function buildPurchaseSheetRow_(wrapper) {
  const order = (wrapper && wrapper.order) || {};
  const detail = (wrapper && wrapper.detail) || {};
  const details = getPurchaseOrderDetails_(order);

  const totalQuantity = details.reduce((sum, item) => {
    return sum + kiotVietNumber_(item, ['Quantity', 'quantity', 'OrderQuantity', 'orderQuantity'], 0);
  }, 0);
  const totalPayment = kiotVietNumber_(order, ['TotalPayment', 'totalPayment', 'PaidAmount', 'paidAmount'], 0);
  const total = kiotVietNumber_(order, ['Total', 'total'], 0);

  const detailPrice = kiotVietNumber_(detail, ['Price', 'price'], '');
  const detailQuantity = kiotVietNumber_(detail, ['Quantity', 'quantity', 'OrderQuantity', 'orderQuantity'], '');
  const detailDiscount = kiotVietNumber_(detail, ['Discount', 'discount'], '');
  const subTotal = pickKiotVietValue_(detail, ['SubTotal', 'subTotal']);
  const detailAmount = subTotal.found
    ? kiotVietNumber_(detail, ['SubTotal', 'subTotal'])
    : (Number(detailPrice) || 0) * (Number(detailQuantity) || 0) - (Number(detailDiscount) || 0);

  return [
    kiotVietText_(order, ['BranchName', 'branchName']),
    kiotVietText_(order, ['PurchaseOrderCode', 'purchaseOrderCode', 'Code', 'code']),
    kiotVietDate_(order, ['PurchaseDate', 'purchaseDate']),
    kiotVietDate_(order, ['CreatedDate', 'createdDate']),
    kiotVietText_(order, ['SupplierCode', 'supplierCode']),
    kiotVietText_(order, ['SupplierName', 'supplierName']),
    kiotVietText_(order, ['PurchaseName', 'purchaseName']),
    kiotVietText_(order, ['CreatedByName', 'createdByName', 'CreatorName', 'creatorName', 'PurchaseName', 'purchaseName']),
    total,
    kiotVietNumber_(order, ['Discount', 'discount'], 0),
    kiotVietNumber_(order, ['SupplierDebt', 'supplierDebt', 'NeedToPay', 'needToPay'], total - totalPayment),
    totalPayment,
    kiotVietText_(order, ['Description', 'description']),
    totalQuantity,
    details.length,
    kiotVietStatus_(order, {}),
    kiotVietText_(detail, ['ProductCode', 'productCode']),
    kiotVietText_(detail, ['ProductName', 'productName']),
    detailPrice,
    kiotVietNumber_(detail, ['DiscountRatio', 'discountRatio'], ''),
    detailDiscount,
    detailPrice,
    detailAmount,
    detailQuantity
  ];
}

const KIOTVIET_SHEET_SCHEMAS = Object.freeze({
  categories: {
    sheetName: CONFIG.SHEET_CATEGORIES,
    endpoint: 'categories',
    // KiotViet dat ten tham so la "hierachicalData" (thieu chu "r").
    listQuery: 'hierachicalData=false',
    headers: CATEGORY_SHEET_HEADERS,
    codeKeys: ['CategoryId', 'categoryId', 'Id', 'id'],
    idKeys: ['CategoryId', 'categoryId', 'Id', 'id'],
    buildRow: buildCategorySheetRow_,
    aliases: {},
    numberHeaders: [],
    textHeaders: ['Mã nhóm hàng', 'Mã nhóm cha', 'ID gian hàng']
  },
  products: {
    sheetName: CONFIG.SHEET_PRODUCTS,
    endpoint: 'products',
    listQuery: [
      'includeInventory=true',
      'includeQuantity=true',
      'IncludeProductShelves=true',
      'includePricebook=true',
      'IncludeSerials=true',
      'IncludeBatchExpires=true',
      'includeWarranties=true',
      'includeMaterial=true',
      'includeSoftDeletedAttribute=false'
    ].join('&'),
    detailQuery: [
      'includeSoftDeletedAttribute=false',
      'includeQuantity=true',
      'IncludeProductShelves=true',
      'includePricebook=true',
      'IncludeSerials=true',
      'IncludeBatchExpires=true',
      'includeWarranties=true',
      'includeMaterial=true'
    ].join('&'),
    headers: Object.freeze(PRODUCT_SHEET_HEADERS.concat(PRODUCT_EXTRA_HEADERS)),
    codeKeys: ['ProductCode', 'productCode', 'Code', 'code'],
    idKeys: ['ProductId', 'productId', 'Id', 'id'],
    buildRow: buildFullProductSheetRow_,
    aliases: {
      'Loại hàng': ['Loại hàng', 'Loại'],
      'Trạng thái': ['Trạng thái', 'Trạng thái kinh doanh'],
      'Ngày sửa cuối': ['Ngày sửa cuối', 'Thời gian tạo', 'Ngày cập nhật']
    },
    numberHeaders: [
      'Giá vốn', 'Giá bán', 'Tồn kho', 'Khách đặt',
      'Giá trị quy đổi'
    ],
    textHeaders: [
      'Mã hàng', 'Mã nhóm hàng', 'ID hàng hóa', 'ID gian hàng'
    ]
  },
  invoices: {
    sheetName: CONFIG.SHEET_INVOICES,
    endpoint: 'invoices',
    listQuery: 'includePayment=true&includeInvoiceDelivery=true&IncludeSaleChannel=true',
    detailQuery: '',
    headers: INVOICE_SHEET_HEADERS,
    codeKeys: ['InvoiceCode', 'invoiceCode', 'Code', 'code'],
    idKeys: ['InvoiceId', 'invoiceId', 'Id', 'id'],
    buildRow: buildInvoiceSheetRow_,
    aliases: {
      'Khách hàng': ['Khách hàng', 'Tên khách hàng'],
      'Tổng tiền hàng': ['Tổng tiền hàng', 'Tổng tiền']
    },
    numberHeaders: ['Tổng tiền hàng', 'Giảm giá', 'Khách đã trả'],
    textHeaders: [
      'Mã hóa đơn', 'SĐT khách', 'ID hóa đơn', 'Mã đặt hàng', 'ID chi nhánh',
      'ID nhân viên bán', 'ID khách hàng', 'Mã khách hàng'
    ]
  },
  invoiceDetails: {
    sheetName: CONFIG.SHEET_INVOICE_DETAILS,
    endpoint: '',
    listQuery: '',
    headers: INVOICE_DETAIL_SHEET_HEADERS,
    codeKeys: ['InvoiceCode', 'invoiceCode', 'Code', 'code'],
    idKeys: ['InvoiceId', 'invoiceId', 'Id', 'id'],
    buildRow: function(wrapper) {
      return buildInvoiceDetailSheetRow_(wrapper.invoice || {}, wrapper.detail || {});
    },
    aliases: {},
    numberHeaders: ['Số lượng', 'Đơn giá', 'Giảm giá', 'Thành tiền', 'Giảm giá (%)'],
    textHeaders: ['Mã hóa đơn', 'Mã hàng', 'ID hóa đơn', 'ID hàng hóa']
  },
  orders: {
    sheetName: CONFIG.SHEET_ORDERS,
    endpoint: 'orders',
    listQuery: 'includePayment=true&includeOrderDelivery=true',
    detailQuery: '',
    headers: ORDER_SHEET_HEADERS,
    codeKeys: ['OrderCode', 'orderCode', 'Code', 'code'],
    idKeys: ['OrderId', 'orderId', 'Id', 'id'],
    buildRow: buildOrderSheetRow_,
    aliases: {},
    numberHeaders: ['Tổng tiền', 'Khách đã trả', 'Giảm giá (%)', 'Giảm giá'],
    textHeaders: [
      'Mã đặt hàng', 'ID đặt hàng', 'ID gian hàng', 'ID chi nhánh', 'ID nhân viên lập',
      'ID khách hàng', 'Mã khách hàng'
    ]
  },
  returns: {
    sheetName: CONFIG.SHEET_RETURNS,
    endpoint: 'returns',
    listQuery: 'includePayment=true',
    detailQuery: '',
    headers: RETURN_SHEET_HEADERS,
    codeKeys: ['ReturnCode', 'returnCode', 'Code', 'code'],
    idKeys: ['ReturnId', 'returnId', 'Id', 'id'],
    buildRow: buildReturnSheetRow_,
    aliases: {},
    numberHeaders: [
      'Tổng tiền trả', 'Giảm giá trả hàng', 'Phí trả hàng', 'Tổng thanh toán'
    ],
    textHeaders: [
      'Mã trả hàng', 'ID trả hàng', 'ID hóa đơn gốc',
      'ID chi nhánh', 'ID người nhận trả', 'ID khách hàng', 'Mã khách hàng'
    ]
  },
  customers: {
    sheetName: CONFIG.SHEET_CUSTOMERS,
    endpoint: 'customers',
    listQuery: 'includeTotal=true&includeCustomerGroup=true&includeCustomerSocial=true',
    detailQuery: '',
    headers: CUSTOMER_SHEET_HEADERS,
    codeKeys: ['CustomerCode', 'customerCode', 'Code', 'code'],
    idKeys: ['CustomerId', 'customerId', 'Id', 'id'],
    buildRow: buildCustomerSheetRow_,
    aliases: {
      'Nhóm khách hàng': ['Nhóm khách hàng', 'Tên nhóm khách hàng']
    },
    numberHeaders: ['Nợ hiện tại', 'Tổng bán', 'Tổng doanh thu'],
    textHeaders: [
      'Mã khách hàng', 'Điện thoại', 'Điện thoại phụ',
      'ID khách hàng', 'ID gian hàng'
    ]
  },
  suppliers: {
    sheetName: CONFIG.SHEET_SUPPLIERS,
    endpoint: 'suppliers',
    listQuery: 'includeTotal=true&includeSupplierGroup=true',
    detailQuery: '',
    headers: SUPPLIER_SHEET_HEADERS,
    codeKeys: ['SupplierCode', 'supplierCode', 'Code', 'code'],
    idKeys: ['SupplierId', 'supplierId', 'Id', 'id'],
    buildRow: buildSupplierSheetRow_,
    aliases: {},
    numberHeaders: ['Nợ cần trả', 'Tổng mua', 'Tổng mua trừ trả hàng'],
    textHeaders: [
      'Mã NCC', 'Điện thoại', 'ID nhà cung cấp',
      'ID gian hàng', 'ID chi nhánh tạo'
    ]
  },
  purchases: {
    sheetName: CONFIG.SHEET_PURCHASES,
    endpoint: 'purchaseorders',
    listQuery: 'includePayment=true&includeOrderDelivery=true',
    detailQuery: '',
    headers: PURCHASE_SHEET_HEADERS,
    codeKeys: ['PurchaseOrderCode', 'purchaseOrderCode', 'Code', 'code'],
    idKeys: ['PurchaseOrderId', 'purchaseOrderId', 'Id', 'id'],
    buildRow: buildPurchaseSheetRow_,
    aliases: {},
    numberHeaders: [
      'Tổng tiền hàng', 'Giảm giá phiếu nhập', 'Cần trả NCC', 'Tiền đã trả NCC',
      'Tổng số lượng', 'Tổng số mặt hàng',
      'Đơn giá', 'Giảm giá %', 'Giảm giá', 'Giá nhập', 'Thành tiền', 'Số lượng'
    ],
    textHeaders: ['Mã nhập hàng', 'Mã nhà cung cấp', 'Mã hàng']
  }
});

function fetchAllKiotVietPages_(schema, token) {
  let allItems = [];
  let currentItem = 0;
  const pageSize = 100;
  let total = 0;

  do {
    let url = 'https://public.kiotapi.com/' + schema.endpoint +
      '?pageSize=' + pageSize + '&currentItem=' + currentItem;
    if (schema.listQuery) url += '&' + schema.listQuery;

    const result = fetchKiotVietJsonWithRetry_(url, token, schema.endpoint);
    const pageItems = Array.isArray(result.data) ? result.data : [];
    allItems = allItems.concat(pageItems);
    total = Number(result.total) || 0;
    currentItem += pageSize;
    if (currentItem < total) Utilities.sleep(120);
  } while (currentItem < total);

  return allItems;
}

function fetchKiotVietJsonWithRetry_(url, token, endpoint) {
  const maxAttempts = 5;
  let lastError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: {
          Authorization: 'Bearer ' + token,
          Retailer: CONFIG.RETAILER
        },
        muteHttpExceptions: true,
        timeoutSeconds: 45
      });
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode >= 200 && responseCode < 300) {
        return JSON.parse(responseText);
      }

      lastError = new Error(
        'HTTP ' + responseCode + ' tu KiotViet API (' + endpoint + '): ' + responseText
      );
      if (responseCode !== 429 && responseCode < 500) break;
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) Utilities.sleep(1000 * Math.pow(2, attempt - 1));
  }

  throw new Error(
    'Goi KiotViet API (' + endpoint + ') that bai sau ' + attemptsMade +
    ' lan thu: ' + (lastError ? lastError.toString() : 'khong ro loi')
  );
}

// ==========================================
// CAU HINH VA CO CHE DONG BO PHAN DOAN (CHUNKED SYNC)
// ==========================================
const SYNC_CHUNK_CONFIG = Object.freeze({
  CHUNK_SIZE: 5000,            // 5.000 ban ghi moi lan chay
  PAGE_SIZE: 100,              // 100 ban ghi moi trang API KiotViet
  PURCHASES_PAGE_SIZE: 20,     // Purchase order kem chi tiet rat nang; giu request nho de tranh treo 6 phut
  MAX_RUN_SECONDS: 270,        // Dung an toan sau 4.5 phut de tranh timeout 6 phut cua Google
  AUTO_TRIGGER_DELAY_MS: 60000 // 1 phut tao trigger tiep suc
});

// Nhap hang co the mat vai phut de tai va bung chi tiet tung mat hang. Ghi vao
// tab staging de mot lan timeout/API loi khong xoa du lieu dang hien thi.
const KIOTVIET_CHUNK_STAGING_SHEETS_ = Object.freeze({
  invoices: '_KV_SYNC_STAGING_INVOICES',
  purchases: '_KV_SYNC_STAGING_PURCHASES'
});
const KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_ = '_KV_SYNC_STAGING_INVOICE_DETAILS';

// Tra ve {sheet, created} thay vi chi sheet: goi noi tiep theo can biet trang
// vua duoc tao moi de bo qua cac thao tac khong can thiet (va de gay timeout
// tren file lon) nhu don cot JSON cu hay kiem tra schema.
function prepareKiotVietChunkStagingSheet_(spreadsheet, schemaKey, schema) {
  const stagingName = KIOTVIET_CHUNK_STAGING_SHEETS_[schemaKey];
  if (!stagingName) return { sheet: null, created: false };

  let stagingSheet = spreadsheet.getSheetByName(stagingName);
  let created = false;
  if (!stagingSheet) {
    stagingSheet = createCompactSheet_(spreadsheet, stagingName, 1, schema.headers.length);
    created = true;
  }
  if (!created) stagingSheet.hideSheet();
  return { sheet: stagingSheet, created: created };
}

function copyKiotVietChunkStagingToLive_(schema, liveSheet, stagingSheet, allowEmpty) {
  const stagingLastRow = stagingSheet.getLastRow();
  const previousLastRow = liveSheet.getLastRow();

  // Neu API dot ngot tra ve rong, giu lai du lieu live thay vi cong bo mot bang
  // rong. Nguoi van hanh co the xoa chu dong neu gian hang thuc su khong co phieu.
  if (!allowEmpty && stagingLastRow <= 1 && previousLastRow > 1) {
    throw new Error(
      '[' + schema.sheetName + '] API tra ve 0 ban ghi; giu lai du lieu hien tai de tranh mat du lieu.'
    );
  }

  const publishRowCount = Math.max(stagingLastRow, 1);
  ensureSheetGridCapacity_(liveSheet, publishRowCount, schema.headers.length);
  const stagedValues = stagingSheet
    .getRange(1, 1, publishRowCount, schema.headers.length)
    .getValues();

  // Ghi de tu tren xuong ma khong clear toan bo tab live truoc. Neu Google
  // Sheets nem loi giua chung, du lieu cu van con o cac dong chua ghi den.
  writeKiotVietRowsInChunks_(liveSheet, 1, stagedValues, schema.headers.length);
  if (previousLastRow > publishRowCount) {
    liveSheet
      .getRange(publishRowCount + 1, 1, previousLastRow - publishRowCount, schema.headers.length)
      .clearContent();
  }

  Logger.log(
    '[' + schema.sheetName + '] Da cong bo ' + Math.max(publishRowCount - 1, 0) +
    ' dong tu staging.'
  );
}

function publishKiotVietChunkStagingSheet_(spreadsheet, schemaKey, schema, liveSheet, stagingSheet) {
  copyKiotVietChunkStagingToLive_(schema, liveSheet, stagingSheet, false);
  spreadsheet.deleteSheet(stagingSheet);
}

function prepareInvoiceDetailStagingSheet_(spreadsheet) {
  const detailSchema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
  let stagingSheet = spreadsheet.getSheetByName(KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_);
  let created = false;
  if (!stagingSheet) {
    stagingSheet = createCompactSheet_(
      spreadsheet,
      KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_,
      1,
      detailSchema.headers.length
    );
    created = true;
  }
  if (!created) stagingSheet.hideSheet();
  return { sheet: stagingSheet, created: created };
}

function publishInvoiceStagingPair_(spreadsheet, invoiceSchema, invoiceLiveSheet, invoiceStagingSheet) {
  const detailSchema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
  const detailStagingSheet = spreadsheet.getSheetByName(KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_);
  if (!detailStagingSheet) {
    throw new Error('[Chi tiet hoa don] Mat staging; giu nguyen hai bang live.');
  }
  const detailLiveSheet = spreadsheet.getSheetByName(detailSchema.sheetName) ||
    spreadsheet.insertSheet(detailSchema.sheetName);

  // Apps Script khong co transaction da-sheet. Giu phase=commit cho den khi ca
  // hai phep copy thanh cong; neu loi giua chung, luot sau copy lai idempotent.
  copyKiotVietChunkStagingToLive_(invoiceSchema, invoiceLiveSheet, invoiceStagingSheet, false);
  copyKiotVietChunkStagingToLive_(detailSchema, detailLiveSheet, detailStagingSheet, true);
  spreadsheet.deleteSheet(invoiceStagingSheet);
  spreadsheet.deleteSheet(detailStagingSheet);
}

function writeKiotVietChunkPage_(spreadsheet, schemaKey, schema, sheet, pageItems, invoiceDetailSheet) {
  let rows;
  if (schemaKey === 'products') {
    rows = pageItems
      .filter(product => !isVatProductCode(getProductCode_(product)))
      .map(item => schema.buildRow(item));
  } else if (schemaKey === 'purchases') {
    rows = buildPurchaseOrderWrappers_(pageItems).map(item => schema.buildRow(item));
  } else {
    rows = pageItems.map(item => schema.buildRow(item));
  }

  if (rows.length > 0) {
    writeKiotVietRowsInChunks_(
      sheet,
      sheet.getLastRow() + 1,
      rows,
      schema.headers.length
    );
  }

  let detailSheetLastRow;
  let detailRowsWritten = 0;
  if (schemaKey === 'invoices') {
    const detailSchema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
    const detailSheet = invoiceDetailSheet ||
      spreadsheet.getSheetByName(detailSchema.sheetName) ||
      spreadsheet.insertSheet(detailSchema.sheetName);
    const detailWrappers = [];
    pageItems.forEach(invoice => {
      const details = kiotVietValue_(invoice, ['InvoiceDetails', 'invoiceDetails'], []);
      (Array.isArray(details) ? details : []).forEach(detail => {
        detailWrappers.push({ invoice: invoice, detail: detail });
      });
    });
    if (detailWrappers.length > 0) {
      const detailRows = detailWrappers.map(wrapper => detailSchema.buildRow(wrapper));
      detailRowsWritten = detailRows.length;
      writeKiotVietRowsInChunks_(
        detailSheet,
        detailSheet.getLastRow() + 1,
        detailRows,
        detailSchema.headers.length
      );
    }
    detailSheetLastRow = detailSheet.getLastRow();
  }

  if (typeof SpreadsheetApp !== 'undefined' && typeof SpreadsheetApp.flush === 'function') {
    SpreadsheetApp.flush();
  }
  return {
    sheetLastRow: sheet.getLastRow(),
    detailSheetLastRow: detailSheetLastRow,
    detailRowsWritten: detailRowsWritten
  };
}

/**
 * Dong bo mot phan doan (chunk) cho bat ky bang nao cua KiotViet.
 * Ho tro Checkpoint (luu diem dung) va tu dong goi trigger tiep theo neu chua xong.
 *
 * @param {string} schemaKey - Key trong KIOTVIET_SHEET_SCHEMAS ('products', 'invoices', 'orders', v.v.)
 * @param {Object} [options]
 * @param {string} [options.token] - KiotViet token
 * @param {number} [options.chunkSize] - So ban ghi toi da trong 1 lan (mac dinh 5000)
 * @param {string} [options.resumeHandler] - Ten ham trigger se duoc tao neu can chay tiep
 * @param {boolean} [options.autoSchedule] - Co tu dong tao trigger tiep tuc khong (mac dinh true)
 * @returns {{ schemaKey: string, sheetName: string, isCompleted: boolean, currentItem: number, total: number, recordsProcessed: number }}
 */
function syncKiotVietTableChunk_(schemaKey, options) {
  options = options || {};
  const schema = KIOTVIET_SHEET_SCHEMAS[schemaKey];
  if (!schema) throw new Error('Khong tim thay schema cho: ' + schemaKey);

  const token = options.token || getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token.');

  const chunkSize = options.chunkSize || SYNC_CHUNK_CONFIG.CHUNK_SIZE;
  const pageSize = schemaKey === 'purchases'
    ? SYNC_CHUNK_CONFIG.PURCHASES_PAGE_SIZE
    : SYNC_CHUNK_CONFIG.PAGE_SIZE;
  const maxRunSeconds = options.maxRunSeconds || SYNC_CHUNK_CONFIG.MAX_RUN_SECONDS;
  const autoSchedule = options.autoSchedule !== false;
  const resumeHandler = options.resumeHandler;

  const props = PropertiesService.getScriptProperties();
  const stateKey = 'SYNC_CHUNK_STATE_' + schemaKey;

  // 1. Doc trang thai diem dung
  let state = {};
  try {
    const rawState = props.getProperty(stateKey);
    if (rawState) state = JSON.parse(rawState);
  } catch (e) {
    state = {};
  }

  let currentItem = Number(state.currentItem) || 0;
  let invoiceCount = Number(state.invoiceCount) || (schemaKey === 'invoices' ? currentItem : 0);
  let invoiceDetailCount = Number(state.invoiceDetailCount) || 0;

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const liveSheet = spreadsheet.getSheetByName(schema.sheetName) || spreadsheet.insertSheet(schema.sheetName);
  const stagingName = KIOTVIET_CHUNK_STAGING_SHEETS_[schemaKey];
  let stagingSheet = stagingName ? spreadsheet.getSheetByName(stagingName) : null;
  let invoiceDetailStagingSheet = schemaKey === 'invoices'
    ? spreadsheet.getSheetByName(KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_)
    : null;

  // Neu lan cong bo truoc bi gian doan, thu lai tu staging ma khong tai trung
  // hay append trung chunk cu.
  if (state.phase === 'commit' && stagingName && stagingSheet) {
    try {
      if (schemaKey === 'invoices') {
        publishInvoiceStagingPair_(spreadsheet, schema, liveSheet, stagingSheet);
        const publishedDetailSheet = spreadsheet.getSheetByName(
          KIOTVIET_SHEET_SCHEMAS.invoiceDetails.sheetName
        );
        props.setProperty(KIOTVIET_INVOICE_BACKFILL_LAST_RESULT_PROPERTY_, JSON.stringify({
          completedAt: new Date().toISOString(),
          total: Number(state.total) || currentItem,
          invoiceCount: Number(state.invoiceCount) || currentItem,
          invoiceDetailCount: Number(state.invoiceDetailCount) || 0,
          invoiceRows: Math.max(0, liveSheet.getLastRow() - 1),
          invoiceDetailRows: publishedDetailSheet
            ? Math.max(0, publishedDetailSheet.getLastRow() - 1)
            : 0
        }));
      } else {
        publishKiotVietChunkStagingSheet_(
          spreadsheet, schemaKey, schema, liveSheet, stagingSheet
        );
      }
    } catch (publishError) {
      // Thuong gap khi bang tinh cham gioi han 10 trieu o (SPREADSHEET_GRID_CELL_LIMIT_).
      // Khong xoa checkpoint/staging o day: du lieu da tai van con nguyen trong
      // staging, chi chua cong bo sang live duoc. Len lich thu lai thay vi de
      // chuoi dong bo chet lang le (khong co watchdog nao khac theo doi rieng
      // resumeSyncInvoicesChunk/resumeSyncPurchasesChunk/resumePollingOnlyChunk_).
      Logger.log(
        '[' + schema.sheetName + '] Cong bo staging that bai, se thu lai sau: ' + publishError
      );
      if (resumeHandler) scheduleSpecificChunkTrigger_(resumeHandler);
      return {
        schemaKey: schemaKey,
        sheetName: schema.sheetName,
        isCompleted: false,
        currentItem: currentItem,
        total: Number(state.total) || currentItem,
        recordsProcessed: 0,
        phase: 'commit',
        error: String((publishError && publishError.message) || publishError)
      };
    }
    props.deleteProperty(stateKey);
    if (resumeHandler) removeSpecificChunkTrigger_(resumeHandler);
    return {
      schemaKey: schemaKey,
      sheetName: schema.sheetName,
      isCompleted: true,
      currentItem: currentItem,
      total: Number(state.total) || currentItem,
      recordsProcessed: 0,
      invoiceCount: Number(state.invoiceCount) || undefined,
      invoiceDetailCount: Number(state.invoiceDetailCount) || undefined
    };
  }

  // Checkpoint khong con staging la checkpoint khong the tiep tuc an toan.
  // Khoi dong lai tu dau thay vi ghi tiep vao live hoac bo sot cac trang dau.
  if (stagingName && currentItem > 0 && (
    !stagingSheet || (schemaKey === 'invoices' && !invoiceDetailStagingSheet)
  )) {
    Logger.log('[' + schema.sheetName + '] Mat staging, khoi dong lai tu trang dau.');
    props.deleteProperty(stateKey);
    state = {};
    currentItem = 0;
    invoiceCount = 0;
    invoiceDetailCount = 0;
  }

  let stagingSheetJustCreated = false;
  let invoiceDetailStagingSheetJustCreated = false;
  if (stagingName && !stagingSheet) {
    const prepared = prepareKiotVietChunkStagingSheet_(spreadsheet, schemaKey, schema);
    stagingSheet = prepared.sheet;
    stagingSheetJustCreated = prepared.created;
  }
  if (schemaKey === 'invoices' && !invoiceDetailStagingSheet) {
    const preparedDetail = prepareInvoiceDetailStagingSheet_(spreadsheet);
    invoiceDetailStagingSheet = preparedDetail.sheet;
    invoiceDetailStagingSheetJustCreated = preparedDetail.created;
  }

  // Neu lan chay truoc dung giua luc ghi mot trang, state van tro toi trang da
  // flush thanh cong gan nhat. Xoa phan du chua co checkpoint de lan tiep theo
  // co the tai lai trang do ma khong tao dong trung.
  if (stagingSheet && currentItem > 0 && Number(state.stagingLastRow) > 0) {
    const checkpointLastRow = Number(state.stagingLastRow);
    const stagingLastRow = stagingSheet.getLastRow();
    if (stagingLastRow > checkpointLastRow) {
      stagingSheet
        .getRange(
          checkpointLastRow + 1,
          1,
          stagingLastRow - checkpointLastRow,
          schema.headers.length
        )
        .clearContent();
    }
  }
  const sheet = stagingSheet || liveSheet;

  // Cac bang mot dong/API item co the bi dung giua luc ghi trang. Neu state cu
  // chua co sheetLastRow, currentItem + dong header la checkpoint tuong thich
  // nguoc cho cac schema mot-mot nhu Dat hang, Khach hang va Nha cung cap.
  if (!stagingSheet && currentItem > 0) {
    const fallbackCheckpointLastRow = (
      schemaKey !== 'products' && schemaKey !== 'invoices'
    ) ? currentItem + 1 : 0;
    const checkpointLastRow = Number(state.sheetLastRow) || fallbackCheckpointLastRow;
    const currentLastRow = sheet.getLastRow();
    if (checkpointLastRow > 0 && currentLastRow > checkpointLastRow) {
      sheet.getRange(
        checkpointLastRow + 1,
        1,
        currentLastRow - checkpointLastRow,
        schema.headers.length
      ).clearContent();
    }
  }
  if (schemaKey === 'invoices' && Number(state.detailSheetLastRow) > 0) {
    const detailSchema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
    const detailSheet = invoiceDetailStagingSheet;
    const checkpointDetailLastRow = Number(state.detailSheetLastRow);
    if (detailSheet && detailSheet.getLastRow() > checkpointDetailLastRow) {
      detailSheet.getRange(
        checkpointDetailLastRow + 1,
        1,
        detailSheet.getLastRow() - checkpointDetailLastRow,
        detailSchema.headers.length
      ).clearContent();
    }
  }

  const isFirstChunk = (currentItem === 0);
  // Trang vua duoc tao trong chinh lan chay nay chac chan chua co cot JSON cu
  // va header se duoc ghi lai ngay ben duoi, nen bo qua cac phep doc/ghi kiem
  // tra schema — tren file lon (nhu spreadsheet Ha Noi) cac phep nay (getLastRow,
  // getLastColumn...) co the bi Sheets tra ve loi timeout ngay sau insertSheet.
  const sheetJustCreated = stagingName ? stagingSheetJustCreated : false;

  // Neu la lan dau tien: Don cot JSON cu, kiem tra schema, xoa trang noi dung cu va ghi Header
  if (isFirstChunk) {
    if (!sheetJustCreated) {
      removeLegacyKiotVietJsonColumns_(sheet);
      ensureKiotVietSheetSchema_(sheet, schema);
    }
    sheet.clearContents();
    sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);

    // Rieng voi Hoa don, chuan bi ca tab Chi tiet hoa don
    if (schemaKey === 'invoices') {
      const detailSchema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
      const detailSheet = invoiceDetailStagingSheet;
      if (!invoiceDetailStagingSheetJustCreated) {
        removeLegacyKiotVietJsonColumns_(detailSheet);
        ensureKiotVietSheetSchema_(detailSheet, detailSchema);
      }
      detailSheet.clearContents();
      detailSheet.getRange(1, 1, 1, detailSchema.headers.length).setValues([detailSchema.headers]);
    }
    if (typeof SpreadsheetApp !== 'undefined' && typeof SpreadsheetApp.flush === 'function') {
      SpreadsheetApp.flush();
    }
  }

  const startTime = Date.now();
  let totalRecords = Number(state.total) || 0;
  let recordsInThisRun = 0;

  Logger.log('[' + schema.sheetName + '] Bat dau keo du lieu tu vi tri: ' + currentItem + '...');

  // 2. Vong lap phan trang
  while (recordsInThisRun < chunkSize) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds >= maxRunSeconds) {
      Logger.log('[' + schema.sheetName + '] Da chay ' + Math.round(elapsedSeconds) + 's (cham nguong an toan 4.5 phut), tam dung de len lich tiep suc.');
      break;
    }

    let url = 'https://public.kiotapi.com/' + schema.endpoint +
      '?pageSize=' + pageSize + '&currentItem=' + currentItem;
    if (schema.listQuery) url += '&' + schema.listQuery;

    const result = fetchKiotVietJsonWithRetry_(url, token, schema.endpoint);
    const pageItems = Array.isArray(result.data) ? result.data : [];
    totalRecords = Number(result.total) || 0;

    if (pageItems.length === 0) break;

    let checkpointRows;
    try {
      checkpointRows = writeKiotVietChunkPage_(
        spreadsheet,
        schemaKey,
        schema,
        sheet,
        pageItems,
        invoiceDetailStagingSheet
      );
    } catch (writeError) {
      // Cung co the la loi cham gioi han 10 trieu o. Diem dung (checkpoint) gan
      // nhat da luu tu trang truoc van con nguyen ven, nen an toan de thu lai
      // thay vi de nguyen chuoi dong bo chet lang le khong ai biet.
      Logger.log(
        '[' + schema.sheetName + '] Ghi trang du lieu that bai, se thu lai sau: ' + writeError
      );
      if (autoSchedule && resumeHandler) scheduleSpecificChunkTrigger_(resumeHandler);
      return {
        schemaKey: schemaKey,
        sheetName: schema.sheetName,
        isCompleted: false,
        currentItem: currentItem,
        total: totalRecords,
        recordsProcessed: recordsInThisRun,
        error: String((writeError && writeError.message) || writeError)
      };
    }
    currentItem += pageItems.length;
    recordsInThisRun += pageItems.length;
    if (schemaKey === 'invoices') {
      invoiceCount += pageItems.length;
      invoiceDetailCount += checkpointRows.detailRowsWritten;
    }

    // Chi checkpoint sau khi trang chinh va trang chi tiet (neu co) da flush,
    // de state khong bao gio chay truoc du lieu da luu trong Google Sheets.
    props.setProperty(stateKey, JSON.stringify({
      schemaKey: schemaKey,
      sheetName: schema.sheetName,
      currentItem: currentItem,
      total: totalRecords,
      sheetLastRow: checkpointRows.sheetLastRow,
      stagingLastRow: stagingSheet ? checkpointRows.sheetLastRow : undefined,
      detailSheetLastRow: checkpointRows.detailSheetLastRow,
      invoiceCount: schemaKey === 'invoices' ? invoiceCount : undefined,
      invoiceDetailCount: schemaKey === 'invoices' ? invoiceDetailCount : undefined,
      isCompleted: false,
      updatedAt: new Date().toISOString()
    }));

    if (currentItem >= totalRecords) break;
    Utilities.sleep(120);
  }

  if (recordsInThisRun > 0) {
    Logger.log('[' + schema.sheetName + '] Da ghi ' + recordsInThisRun + ' ban ghi vao Sheet (Hien tai: ' + currentItem + '/' + totalRecords + ').');
  }

  // 4. Kiem tra xem da hoan tat 100% chua
  const isCompleted = (totalRecords > 0 && currentItem >= totalRecords) || (recordsInThisRun === 0 && totalRecords > 0) || (totalRecords === 0 && isFirstChunk);

  if (isCompleted) {
    if (stagingSheet) {
      props.setProperty(stateKey, JSON.stringify({
        schemaKey: schemaKey,
        sheetName: schema.sheetName,
        currentItem: currentItem,
        total: totalRecords,
        stagingLastRow: stagingSheet ? stagingSheet.getLastRow() : undefined,
        detailSheetLastRow: schemaKey === 'invoices'
          ? invoiceDetailStagingSheet.getLastRow()
          : undefined,
        invoiceCount: schemaKey === 'invoices' ? invoiceCount : undefined,
        invoiceDetailCount: schemaKey === 'invoices' ? invoiceDetailCount : undefined,
        phase: 'commit',
        updatedAt: new Date().toISOString()
      }));
      if (resumeHandler) scheduleSpecificChunkTrigger_(resumeHandler);
      Logger.log(
        '[' + schema.sheetName + '] Da tai du staging; se cong bo o luot tiep theo.'
      );
      return {
        schemaKey: schemaKey,
        sheetName: schema.sheetName,
        isCompleted: false,
        currentItem: currentItem,
        total: totalRecords,
        recordsProcessed: recordsInThisRun,
        invoiceCount: schemaKey === 'invoices' ? invoiceCount : undefined,
        invoiceDetailCount: schemaKey === 'invoices' ? invoiceDetailCount : undefined,
        phase: 'commit'
      };
    }
    props.deleteProperty(stateKey);
    if (resumeHandler) removeSpecificChunkTrigger_(resumeHandler);
    Logger.log('[' + schema.sheetName + '] HOAN TAT 100% DONG BO (' + currentItem + '/' + totalRecords + ' ban ghi).');
    return {
      schemaKey: schemaKey,
      sheetName: schema.sheetName,
      isCompleted: true,
      currentItem: currentItem,
      total: totalRecords,
      recordsProcessed: recordsInThisRun,
      invoiceCount: schemaKey === 'invoices' ? invoiceCount : undefined,
      invoiceDetailCount: schemaKey === 'invoices' ? invoiceDetailCount : undefined
    };
  } else {
    props.setProperty(stateKey, JSON.stringify({
      schemaKey: schemaKey,
      sheetName: schema.sheetName,
      currentItem: currentItem,
      total: totalRecords,
      sheetLastRow: sheet.getLastRow(),
      stagingLastRow: stagingSheet ? stagingSheet.getLastRow() : undefined,
      detailSheetLastRow: schemaKey === 'invoices'
        ? invoiceDetailStagingSheet.getLastRow()
        : undefined,
      invoiceCount: schemaKey === 'invoices' ? invoiceCount : undefined,
      invoiceDetailCount: schemaKey === 'invoices' ? invoiceDetailCount : undefined,
      isCompleted: false,
      updatedAt: new Date().toISOString()
    }));

    if (autoSchedule && resumeHandler) {
      scheduleSpecificChunkTrigger_(resumeHandler);
      Logger.log('[' + schema.sheetName + '] Da len lich tu chay tiep sau 1 phut qua trigger: ' + resumeHandler);
    }

    return {
      schemaKey: schemaKey,
      sheetName: schema.sheetName,
      isCompleted: false,
      currentItem: currentItem,
      total: totalRecords,
      recordsProcessed: recordsInThisRun,
      invoiceCount: schemaKey === 'invoices' ? invoiceCount : undefined,
      invoiceDetailCount: schemaKey === 'invoices' ? invoiceDetailCount : undefined
    };
  }
}

function scheduleSpecificChunkTrigger_(handlerName, delayMs) {
  removeSpecificChunkTrigger_(handlerName);
  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .after(delayMs || SYNC_CHUNK_CONFIG.AUTO_TRIGGER_DELAY_MS)
    .create();
}

function removeSpecificChunkTrigger_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function removeAllChunkResumeTriggers_() {
  const triggerHandlers = [
    'resumeSyncCategoriesChunk',
    'resumeSyncProductsChunk',
    'resumeSyncInvoicesChunk',
    'resumeSyncOrdersChunk',
    'resumeSyncReturnsChunk',
    'resumeSyncCustomersChunk',
    'resumeSyncSuppliersChunk',
    'resumeSyncPurchasesChunk',
    'resumeMasterChainSync_'
  ];
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (triggerHandlers.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Tra ve tong quan tien do dong bo phan doan cua tat ca cac bang.
 */
function getSyncProgressSummary() {
  const props = PropertiesService.getScriptProperties();
  const summary = {};
  const schemaKeys = ['categories', 'products', 'invoices', 'orders', 'returns', 'customers', 'suppliers', 'purchases'];

  schemaKeys.forEach(key => {
    const schema = KIOTVIET_SHEET_SCHEMAS[key];
    const raw = props.getProperty('SYNC_CHUNK_STATE_' + key);
    if (raw) {
      try {
        const state = JSON.parse(raw);
        const percent = state.total > 0 ? Math.round((state.currentItem / state.total) * 100) : 0;
        summary[schema.sheetName] = 'Dang dong bo: ' + state.currentItem + '/' + state.total + ' (' + percent + '%)';
      } catch (e) {
        summary[schema.sheetName] = 'Dang xu ly';
      }
    } else {
      summary[schema.sheetName] = 'San sang / Da hoan tat';
    }
  });

  const masterRaw = props.getProperty('MASTER_CHAIN_SYNC_STATE');
  if (masterRaw) {
    try {
      const masterState = JSON.parse(masterRaw);
      summary['Tien do tong the (Chain)'] = 'Dang o buoc ' + (masterState.currentIndex + 1) + '/' + masterState.chain.length + ' (' + masterState.chain[masterState.currentIndex] + ')';
    } catch (e) {}
  }

  Logger.log('=== TIEN DO DONG BO KIOTVIET ===\n' + JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * Xoa sach trang thai tien do dong bo va huy cac trigger tiep suc.
 */
function resetAllSyncProgress() {
  const props = PropertiesService.getScriptProperties();
  const schemaKeys = ['categories', 'products', 'invoices', 'orders', 'returns', 'customers', 'suppliers', 'purchases'];
  schemaKeys.forEach(key => {
    props.deleteProperty('SYNC_CHUNK_STATE_' + key);
  });
  props.deleteProperty('MASTER_CHAIN_SYNC_STATE');
  props.deleteProperty('MASTER_CHAIN_SYNC_WATCHDOG_AT');
  removeAllChunkResumeTriggers_();
  Logger.log('Da reset toan bo tien do dong bo phan doan va xoa cac trigger tiep suc.');
}

function isLegacyKiotVietJsonHeader_(header) {
  return /\(JSON\)\s*$/i.test(String(header || '').trim());
}

/**
 * Xoa vat ly cac cot JSON cu tu mot sheet, di tu phai sang trai de khong lam
 * thay doi chi so cua cac cot chua xu ly.
 */
function removeLegacyKiotVietJsonColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return 0;

  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  let removedCount = 0;

  for (let columnIndex = headers.length - 1; columnIndex >= 0; columnIndex--) {
    if (!isLegacyKiotVietJsonHeader_(headers[columnIndex])) continue;
    sheet.deleteColumn(columnIndex + 1);
    removedCount++;
  }

  return removedCount;
}

/**
 * Ham admin co the chay thu cong khi can. Trigger nen cung tu goi mot lan sau
 * moi phien ban schema, nen khong can vao tung tab de xoa cot bang tay.
 */
function removeJsonColumnsFromAllSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const processedSheets = {};
  const removedBySheet = {};
  let removedColumns = 0;

  Object.keys(KIOTVIET_SHEET_SCHEMAS).forEach(schemaKey => {
    const sheetName = KIOTVIET_SHEET_SCHEMAS[schemaKey].sheetName;
    if (processedSheets[sheetName]) return;
    processedSheets[sheetName] = true;

    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) return;

    const count = removeLegacyKiotVietJsonColumns_(sheet);
    if (count > 0) removedBySheet[sheetName] = count;
    removedColumns += count;
  });

  PropertiesService.getScriptProperties().setProperty(
    KIOTVIET_SHEET_SCHEMA_PROPERTY,
    KIOTVIET_SHEET_SCHEMA_VERSION
  );
  Logger.log(
    'Da xoa ' + removedColumns + ' cot JSON cu. Chi tiet: ' +
    JSON.stringify(removedBySheet)
  );
  return { removedColumns: removedColumns, sheets: removedBySheet };
}

function migrateKiotVietSheetsIfNeeded_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(KIOTVIET_SHEET_SCHEMA_PROPERTY) === KIOTVIET_SHEET_SCHEMA_VERSION) {
    return false;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;

  try {
    if (properties.getProperty(KIOTVIET_SHEET_SCHEMA_PROPERTY) === KIOTVIET_SHEET_SCHEMA_VERSION) {
      return false;
    }
    removeJsonColumnsFromAllSheets();
    return true;
  } finally {
    lock.releaseLock();
  }
}

function writeKiotVietSheet_(schema, items) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(schema.sheetName) || spreadsheet.insertSheet(schema.sheetName);
  const rows = (Array.isArray(items) ? items : []).map(item => schema.buildRow(item));

  removeLegacyKiotVietJsonColumns_(sheet);
  ensureKiotVietSheetSchema_(sheet, schema);
  const previousLastRow = sheet.getLastRow();
  sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
  writeKiotVietRowsInChunks_(sheet, 2, rows, schema.headers.length);
  const newLastRow = rows.length + 1;
  if (previousLastRow > newLastRow) {
    sheet.getRange(newLastRow + 1, 1, previousLastRow - newLastRow, schema.headers.length)
      .clearContent();
  }
  // Khong ap number format trong full sync: Google Sheets Tables co cot co
  // kieu co the nem loi khong bat duoc tu setNumberFormat va lam dung polling.
  return rows.length;
}

function writeInvoiceDetailsSheet_(invoices) {
  const schema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
  const wrappers = [];
  (Array.isArray(invoices) ? invoices : []).forEach(invoice => {
    const details = kiotVietValue_(invoice, ['InvoiceDetails', 'invoiceDetails'], []);
    (Array.isArray(details) ? details : []).forEach(detail => {
      wrappers.push({ invoice: invoice, detail: detail });
    });
  });
  return writeKiotVietSheet_(schema, wrappers);
}

function setKiotVietNumberFormatIfSupported_(range, numberFormat) {
  try {
    range.setNumberFormat(numberFormat);
    return true;
  } catch (error) {
    if (!isKiotVietTypedColumnFormattingError_(error)) throw error;

    // Google Sheets Tables co the gan column type va cam Apps Script doi
    // number format. Day chi la loi trinh bay; du lieu van phai duoc dong bo.
    Logger.log('Bo qua dinh dang cot co kieu cua Google Sheets: ' + error);
    return false;
  }
}

function isKiotVietTypedColumnFormattingError_(error) {
  const message = [
    error && error.message ? error.message : '',
    String(error || '')
  ].join(' ');
  return /typed column|column type|cột đã nhập|cột có kiểu|number format|định dạng số/i
    .test(message);
}

function formatKiotVietSheetIfSupported_(sheet, schema, dataRowCount) {
  try {
    formatKiotVietSheet_(sheet, schema, dataRowCount);
    return true;
  } catch (error) {
    if (!isKiotVietTypedColumnFormattingError_(error)) throw error;
    Logger.log('Bo qua buoc dinh dang sheet co cot kieu cua Google Sheets: ' + error);
    return false;
  }
}

function formatKiotVietSheet_(sheet, schema, dataRowCount) {
  sheet.getRange(1, 1, 1, schema.headers.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1F4E78')
    .setFontFamily('Open Sans')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);

  if (dataRowCount <= 0) return;

  sheet.getRange(2, 1, dataRowCount, schema.headers.length).setFontFamily('Open Sans');

  (schema.numberHeaders || []).forEach(header => {
    const columnIndex = schema.headers.indexOf(header);
    if (columnIndex >= 0) {
      setKiotVietNumberFormatIfSupported_(
        sheet.getRange(2, columnIndex + 1, dataRowCount, 1),
        '#,##0.##'
      );
    }
  });

  (schema.textHeaders || []).forEach(header => {
    const columnIndex = schema.headers.indexOf(header);
    if (columnIndex >= 0) {
      setKiotVietNumberFormatIfSupported_(
        sheet.getRange(2, columnIndex + 1, dataRowCount, 1),
        '@'
      );
    }
  });
}

function writeKiotVietRowsInChunks_(sheet, startRow, rows, columnCount) {
  if (rows.length > 0 && typeof sheet.getMaxRows === 'function') {
    ensureSheetGridCapacity_(
      sheet,
      startRow + rows.length - 1,
      columnCount
    );
  }
  const chunkSize = 1000;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    sheet.getRange(startRow + offset, 1, chunk.length, columnCount).setValues(chunk);
  }
}

function ensureKiotVietSheetSchema_(sheet, schema) {
  removeLegacyKiotVietJsonColumns_(sheet);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) {
    sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
    return;
  }

  const oldHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(value => String(value || '').trim());
  const schemaMatches = schema.headers.length === oldHeaders.length &&
    schema.headers.every((header, index) => header === oldHeaders[index]);
  if (schemaMatches) return;

  const oldHeaderIndexes = {};
  oldHeaders.forEach((header, index) => {
    if (header && oldHeaderIndexes[header] === undefined) oldHeaderIndexes[header] = index;
  });
  const oldRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
    : [];
  const migratedRows = oldRows.map(oldRow => {
    return schema.headers.map(header => {
      const candidates = (schema.aliases && schema.aliases[header]) || [header];
      for (let i = 0; i < candidates.length; i++) {
        if (oldHeaderIndexes[candidates[i]] !== undefined) {
          return oldRow[oldHeaderIndexes[candidates[i]]];
        }
      }
      return '';
    });
  });

  const previousLastRow = lastRow;
  const previousLastColumn = lastColumn;
  sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
  writeKiotVietRowsInChunks_(sheet, 2, migratedRows, schema.headers.length);
  const newLastRow = migratedRows.length + 1;
  if (previousLastRow > newLastRow) {
    sheet.getRange(
      newLastRow + 1,
      1,
      previousLastRow - newLastRow,
      previousLastColumn
    ).clearContent();
  }
  if (previousLastColumn > schema.headers.length) {
    sheet.deleteColumns(
      schema.headers.length + 1,
      previousLastColumn - schema.headers.length
    );
  }
}

function upsertKiotVietSheetItems_(schema, items) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(schema.sheetName) || spreadsheet.insertSheet(schema.sheetName);
  ensureKiotVietSheetSchema_(sheet, schema);

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0);
  const changedRows = [];

  (Array.isArray(items) ? items : []).forEach(item => {
    const code = kiotVietText_(item, schema.codeKeys).trim();
    if (!code) return;

    const existingRowNumber = codeRowMap[code];
    const existingRow = existingRowNumber ? (data[existingRowNumber - 1] || []) : [];
    let row = schema.buildRow(item);
    if (existingRowNumber) {
      // Neu hydrate tam thoi loi, giu lai gia tri cu tai cac cot ma webhook
      // khong cung cap thay vi ghi de thanh rong.
      row = row.map((value, index) => {
        return value === '' && existingRow[index] !== undefined && existingRow[index] !== ''
          ? existingRow[index]
          : value;
      });
    }

    if (existingRowNumber) {
      sheet.getRange(existingRowNumber, 1, 1, schema.headers.length).setValues([row]);
      data[existingRowNumber - 1] = row;
      changedRows.push(existingRowNumber);
    } else {
      const newRowNumber = sheet.getLastRow() + 1;
      sheet.getRange(newRowNumber, 1, 1, schema.headers.length).setValues([row]);
      codeRowMap[code] = newRowNumber;
      data.push(row);
      changedRows.push(newRowNumber);
    }
  });

  changedRows.forEach(rowNumber => formatKiotVietSheetRow_(sheet, schema, rowNumber));
}

function formatKiotVietSheetRow_(sheet, schema, rowNumber) {
  (schema.numberHeaders || []).forEach(header => {
    const columnIndex = schema.headers.indexOf(header);
    if (columnIndex >= 0) {
      setKiotVietNumberFormatIfSupported_(
        sheet.getRange(rowNumber, columnIndex + 1),
        '#,##0.##'
      );
    }
  });
  (schema.textHeaders || []).forEach(header => {
    const columnIndex = schema.headers.indexOf(header);
    if (columnIndex >= 0) {
      setKiotVietNumberFormatIfSupported_(
        sheet.getRange(rowNumber, columnIndex + 1),
        '@'
      );
    }
  });
}

function deleteKiotVietSheetItems_(schema, items) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(schema.sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  ensureKiotVietSheetSchema_(sheet, schema);

  const codes = {};
  const ids = {};
  (Array.isArray(items) ? items : []).forEach(item => {
    const code = kiotVietText_(item, schema.codeKeys).trim();
    const id = kiotVietId_(item, schema.idKeys);
    if (code) codes[code] = true;
    if (id) ids[id] = true;
  });

  const idHeaderCandidates = schema.headers.filter(header => /^ID /.test(header));
  const idColumnIndex = idHeaderCandidates.length > 0
    ? schema.headers.indexOf(idHeaderCandidates[0])
    : -1;
  const data = sheet.getDataRange().getValues();
  const deletedCodes = [];

  for (let rowIndex = data.length - 1; rowIndex >= 1; rowIndex--) {
    const rowCode = String(data[rowIndex][0] || '').trim();
    const rowId = idColumnIndex >= 0 ? String(data[rowIndex][idColumnIndex] || '').trim() : '';
    if ((rowCode && codes[rowCode]) || (rowId && ids[rowId])) {
      if (rowCode) deletedCodes.push(rowCode);
      sheet.deleteRow(rowIndex + 1);
    }
  }
  return deletedCodes;
}

function replaceInvoiceDetailsForInvoices_(invoices) {
  const schema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(schema.sheetName) || spreadsheet.insertSheet(schema.sheetName);
  ensureKiotVietSheetSchema_(sheet, schema);

  const replacementCodes = {};
  const replacementRows = [];
  (Array.isArray(invoices) ? invoices : []).forEach(invoice => {
    const detailsResult = pickKiotVietValue_(invoice, ['InvoiceDetails', 'invoiceDetails']);
    if (!detailsResult.found || !Array.isArray(detailsResult.value)) return;
    const invoiceCode = kiotVietText_(invoice, ['InvoiceCode', 'invoiceCode', 'Code', 'code']).trim();
    if (!invoiceCode) return;
    replacementCodes[invoiceCode] = true;
    detailsResult.value.forEach(detail => {
      replacementRows.push(buildInvoiceDetailSheetRow_(invoice, detail));
    });
  });

  if (Object.keys(replacementCodes).length === 0) return;

  const currentRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.headers.length).getValues()
    : [];
  const keptRows = currentRows.filter(row => !replacementCodes[String(row[0] || '').trim()]);
  const rows = keptRows.concat(replacementRows);

  writeKiotVietSheetRowsSafely_(sheet, schema, rows);
}

function deleteInvoiceDetailsByCodes_(invoiceCodes) {
  const codeMap = {};
  (Array.isArray(invoiceCodes) ? invoiceCodes : []).forEach(code => {
    const normalized = String(code || '').trim();
    if (normalized) codeMap[normalized] = true;
  });
  if (Object.keys(codeMap).length === 0) return;

  const schema = KIOTVIET_SHEET_SCHEMAS.invoiceDetails;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(schema.sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, schema.headers.length).getValues();
  const keptRows = data.filter(row => !codeMap[String(row[0] || '').trim()]);
  writeKiotVietSheetRowsSafely_(sheet, schema, keptRows);
}

function writeKiotVietSheetRowsSafely_(sheet, schema, rows) {
  const previousLastRow = sheet.getLastRow();
  sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
  writeKiotVietRowsInChunks_(sheet, 2, rows, schema.headers.length);
  const newLastRow = rows.length + 1;
  if (previousLastRow > newLastRow) {
    sheet.getRange(newLastRow + 1, 1, previousLastRow - newLastRow, schema.headers.length)
      .clearContent();
  }
}
