// ==========================================
// SCHEMA KIOTVIET -> GOOGLE SHEETS
// ==========================================

/**
 * Moi sheet giu cac cot dashboard dang dung o ben trai, sau do bo sung cac
 * truong Public API dang duoc su dung. Object/mang long khong duoc ghi vao
 * Sheets de bang tinh gon, de doc va khong cham do payload JSON lon.
 */

const KIOTVIET_SHEET_SCHEMA_VERSION = '2026-07-30-no-json-columns-v1';
const KIOTVIET_SHEET_SCHEMA_PROPERTY = 'KIOTVIET_SHEET_SCHEMA_VERSION';

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
  'Mã vạch',
  'ID gian hàng',
  'Được phép bán',
  'Tên gốc',
  'Mô tả',
  'Đơn vị tính',
  'ID đơn vị cơ bản',
  'ID hàng cùng loại',
  'Giá trị quy đổi',
  'Có thuộc tính',
  'Giá trước thuế',
  'Giá sau thuế',
  'Trọng lượng',
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
  'ID gian hàng',
  'Mã đặt hàng',
  'ID chi nhánh',
  'ID nhân viên bán',
  'ID khách hàng',
  'Mã khách hàng',
  'Mã trạng thái',
  'Tên trạng thái API',
  'Ghi chú',
  'Thu hộ COD',
  'Tổng thuế',
  'Ngày tạo',
  'Ngày cập nhật'
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
  'Ghi chú',
  'Là dòng chính',
  'Serial/IMEI'
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
  'Tổng thuế',
  'Ngày tạo',
  'Ngày cập nhật'
]);

const RETURN_SHEET_HEADERS = Object.freeze([
  'Mã trả hàng',
  'Ngày trả',
  'Mã hóa đơn gốc',
  'Khách hàng',
  'Tổng tiền trả',
  'Trạng thái',
  'ID trả hàng',
  'ID gian hàng',
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
  'Tổng thuế',
  'Chế độ tính thuế',
  'Giảm giá sau thuế',
  'Ngày tạo',
  'Ngày cập nhật'
]);

const CUSTOMER_SHEET_HEADERS = Object.freeze([
  'Mã khách hàng',
  'Tên khách hàng',
  'Điện thoại',
  'Giới tính',
  'Nhóm khách hàng',
  'Địa chỉ',
  'Email',
  'Nợ hiện tại',
  'Tổng bán',
  'ID khách hàng',
  'Loại khách hàng',
  'Ngày sinh',
  'Điện thoại phụ',
  'CCCD/CMND',
  'Khu vực',
  'Phường/Xã',
  'Công ty',
  'Ghi chú',
  'Mã số thuế',
  'Tổng điểm',
  'Tổng doanh thu',
  'Điểm hiện tại',
  'ID gian hàng',
  'Ngày cập nhật',
  'Ngày tạo',
  'PSID Facebook'
]);

const SUPPLIER_SHEET_HEADERS = Object.freeze([
  'Mã NCC',
  'Tên NCC',
  'Điện thoại',
  'Email',
  'Địa chỉ',
  'Nợ cần trả',
  'ID nhà cung cấp',
  'Khu vực',
  'Phường/Xã',
  'Công ty',
  'Mã số thuế',
  'Ghi chú',
  'Nhóm nhà cung cấp',
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
  'Ngày cập nhật',
  'Mã nhà cung cấp',
  'Tên nhà cung cấp',
  'Điện thoại',
  'Địa chỉ',
  'Người nhập',
  'Người tạo',
  'Tổng tiền hàng',
  'Giảm giá phiếu nhập',
  'Cần trả NCC',
  'Tiền đã trả NCC',
  'Ghi chú',
  'Số hóa đơn đầu vào',
  'Tổng số lượng',
  'Tổng số mặt hàng',
  'Trạng thái',
  'Mã hàng',
  'Tên hàng',
  'Thương hiệu',
  'ĐVT',
  'Ghi chú hàng hóa',
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
    kiotVietText_(product, ['BarCode', 'barCode', 'Barcode', 'barcode']),
    kiotVietId_(product, ['RetailerId', 'retailerId']),
    kiotVietBooleanText_(product, ['AllowsSale', 'allowsSale']),
    kiotVietText_(product, ['Name', 'name']),
    kiotVietText_(product, ['Description', 'description']),
    kiotVietText_(product, ['Unit', 'unit']),
    kiotVietId_(product, ['MasterUnitId', 'masterUnitId']),
    kiotVietId_(product, ['MasterProductId', 'masterProductId']),
    kiotVietNumber_(product, ['ConversionValue', 'conversionValue'], ''),
    kiotVietBooleanText_(product, ['HasVariants', 'hasVariants']),
    kiotVietNumber_(product, ['Price', 'price'], ''),
    kiotVietNumber_(product, ['PriceAfterTax', 'priceAfterTax'], ''),
    kiotVietNumber_(product, ['Weight', 'weight'], ''),
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
    kiotVietId_(invoice, ['RetailerId', 'retailerId']),
    kiotVietText_(invoice, ['OrderCode', 'orderCode']),
    kiotVietId_(invoice, ['BranchId', 'branchId']),
    kiotVietId_(invoice, ['SoldById', 'soldById']),
    kiotVietId_(invoice, ['CustomerId', 'customerId']),
    kiotVietText_(invoice, ['CustomerCode', 'customerCode']),
    kiotVietValue_(invoice, ['Status', 'status'], ''),
    kiotVietText_(invoice, ['StatusValue', 'statusValue']),
    kiotVietText_(invoice, ['Description', 'description']),
    kiotVietBooleanText_(invoice, ['UsingCod', 'usingCod']),
    kiotVietNumber_(invoice, ['TotalTax', 'totalTax'], ''),
    kiotVietDate_(invoice, ['CreatedDate', 'createdDate']),
    kiotVietDate_(invoice, ['ModifiedDate', 'modifiedDate'])
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
    kiotVietText_(detail, ['Note', 'note']),
    kiotVietBooleanText_(detail, ['IsMaster', 'isMaster']),
    kiotVietText_(detail, ['SerialNumbers', 'serialNumbers'])
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
    kiotVietNumber_(order, ['TotalTax', 'totalTax'], ''),
    kiotVietDate_(order, ['CreatedDate', 'createdDate']),
    kiotVietDate_(order, ['ModifiedDate', 'modifiedDate'])
  ];
}

function buildReturnSheetRow_(returnItem) {
  return [
    kiotVietText_(returnItem, ['ReturnCode', 'returnCode', 'Code', 'code']),
    kiotVietDate_(returnItem, ['ReturnDate', 'returnDate']),
    kiotVietText_(returnItem, ['InvoiceCode', 'invoiceCode']),
    kiotVietText_(returnItem, ['CustomerName', 'customerName'], 'Khách lẻ') || 'Khách lẻ',
    kiotVietNumber_(returnItem, ['ReturnTotal', 'returnTotal']),
    kiotVietStatus_(returnItem, { 1: 'Hoàn thành', 2: 'Đã hủy' }),
    kiotVietId_(returnItem, ['Id', 'id', 'ReturnId', 'returnId']),
    kiotVietId_(returnItem, ['RetailerId', 'retailerId']),
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
    kiotVietNumber_(returnItem, ['TotalTax', 'totalTax'], ''),
    kiotVietValue_(returnItem, ['PricingMode', 'pricingMode'], ''),
    kiotVietNumber_(returnItem, ['DiscountAfterTax', 'discountAfterTax'], ''),
    kiotVietDate_(returnItem, ['CreatedDate', 'createdDate']),
    kiotVietDate_(returnItem, ['ModifiedDate', 'modifiedDate'])
  ];
}

function buildCustomerSheetRow_(customer) {
  return [
    kiotVietText_(customer, ['CustomerCode', 'customerCode', 'Code', 'code']),
    kiotVietText_(customer, ['Name', 'name', 'CustomerName', 'customerName']),
    kiotVietText_(customer, ['ContactNumber', 'contactNumber']),
    kiotVietGender_(customer),
    kiotVietCustomerGroups_(customer),
    kiotVietText_(customer, ['Address', 'address']),
    kiotVietText_(customer, ['Email', 'email']),
    kiotVietNumber_(customer, ['Debt', 'debt', 'TotalDebt', 'totalDebt']),
    kiotVietNumber_(customer, ['TotalInvoiced', 'totalInvoiced']),
    kiotVietId_(customer, ['Id', 'id', 'CustomerId', 'customerId']),
    kiotVietValue_(customer, ['Type', 'type'], ''),
    kiotVietDate_(customer, ['BirthDate', 'birthDate']),
    kiotVietText_(customer, ['SubNumber', 'subNumber']),
    kiotVietText_(customer, ['IdentificationNumber', 'identificationNumber']),
    kiotVietText_(customer, ['LocationName', 'locationName']),
    kiotVietText_(customer, ['WardName', 'wardName']),
    kiotVietText_(customer, ['Organization', 'organization']),
    kiotVietText_(customer, ['Comments', 'comments']),
    kiotVietText_(customer, ['TaxCode', 'taxCode']),
    kiotVietNumber_(customer, ['TotalPoint', 'totalPoint'], ''),
    kiotVietNumber_(customer, ['TotalRevenue', 'totalRevenue'], ''),
    kiotVietNumber_(customer, ['RewardPoint', 'rewardPoint'], ''),
    kiotVietId_(customer, ['RetailerId', 'retailerId']),
    kiotVietDate_(customer, ['ModifiedDate', 'modifiedDate']),
    kiotVietDate_(customer, ['CreatedDate', 'createdDate']),
    kiotVietId_(customer, ['PsidFacebook', 'psidFacebook'])
  ];
}

function buildSupplierSheetRow_(supplier) {
  return [
    kiotVietText_(supplier, ['SupplierCode', 'supplierCode', 'Code', 'code']),
    kiotVietText_(supplier, ['SupplierName', 'supplierName', 'Name', 'name']),
    kiotVietText_(supplier, ['ContactNumber', 'contactNumber']),
    kiotVietText_(supplier, ['Email', 'email']),
    kiotVietText_(supplier, ['Address', 'address']),
    kiotVietNumber_(supplier, ['Debt', 'debt']),
    kiotVietId_(supplier, ['Id', 'id', 'SupplierId', 'supplierId']),
    kiotVietText_(supplier, ['LocationName', 'locationName']),
    kiotVietText_(supplier, ['WardName', 'wardName']),
    kiotVietText_(supplier, ['Organization', 'organization']),
    kiotVietText_(supplier, ['TaxCode', 'taxCode']),
    kiotVietText_(supplier, ['Comments', 'comments']),
    kiotVietText_(supplier, ['Groups', 'groups']),
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
    kiotVietDate_(order, ['ModifiedDate', 'modifiedDate']),
    kiotVietText_(order, ['SupplierCode', 'supplierCode']),
    kiotVietText_(order, ['SupplierName', 'supplierName']),
    kiotVietText_(order, ['ContactNumber', 'contactNumber', 'SupplierContactNumber', 'supplierContactNumber', 'Phone', 'phone']),
    kiotVietText_(order, ['Address', 'address', 'SupplierAddress', 'supplierAddress']),
    kiotVietText_(order, ['PurchaseName', 'purchaseName']),
    kiotVietText_(order, ['CreatedByName', 'createdByName', 'CreatorName', 'creatorName', 'PurchaseName', 'purchaseName']),
    total,
    kiotVietNumber_(order, ['Discount', 'discount'], 0),
    kiotVietNumber_(order, ['SupplierDebt', 'supplierDebt', 'NeedToPay', 'needToPay'], total - totalPayment),
    totalPayment,
    kiotVietText_(order, ['Description', 'description']),
    kiotVietText_(order, ['InvoiceNumber', 'invoiceNumber', 'InputVATNumber', 'inputVATNumber', 'InputInvoiceNumber', 'inputInvoiceNumber']),
    totalQuantity,
    details.length,
    kiotVietStatus_(order, {}),
    kiotVietText_(detail, ['ProductCode', 'productCode']),
    kiotVietText_(detail, ['ProductName', 'productName']),
    kiotVietText_(detail, ['Brand', 'brand', 'BrandName', 'brandName']),
    kiotVietText_(detail, ['Unit', 'unit', 'ProductUnit', 'productUnit']),
    kiotVietText_(detail, ['Note', 'note']),
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
      'Định mức tồn ít nhất', 'Định mức tồn nhiều nhất',
      'Giá trị quy đổi', 'Giá trước thuế', 'Giá sau thuế', 'Trọng lượng'
    ],
    textHeaders: [
      'Mã hàng', 'Mã nhóm hàng', 'ID hàng hóa', 'Mã vạch', 'ID gian hàng',
      'ID đơn vị cơ bản', 'ID hàng cùng loại'
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
    numberHeaders: ['Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Tổng thuế'],
    textHeaders: [
      'Mã hóa đơn', 'SĐT khách', 'ID hóa đơn', 'ID gian hàng', 'Mã đặt hàng', 'ID chi nhánh',
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
    textHeaders: ['Mã hóa đơn', 'Mã hàng', 'ID hóa đơn', 'ID hàng hóa', 'Serial/IMEI']
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
    numberHeaders: ['Tổng tiền', 'Khách đã trả', 'Giảm giá (%)', 'Giảm giá', 'Tổng thuế'],
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
      'Tổng tiền trả', 'Giảm giá trả hàng', 'Phí trả hàng', 'Tổng thanh toán',
      'Tổng thuế', 'Giảm giá sau thuế'
    ],
    textHeaders: [
      'Mã trả hàng', 'Mã hóa đơn gốc', 'ID trả hàng', 'ID gian hàng', 'ID hóa đơn gốc',
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
    numberHeaders: [
      'Nợ hiện tại', 'Tổng bán', 'Tổng điểm', 'Tổng doanh thu', 'Điểm hiện tại'
    ],
    textHeaders: [
      'Mã khách hàng', 'Điện thoại', 'Điện thoại phụ', 'CCCD/CMND',
      'ID khách hàng', 'Mã số thuế', 'ID gian hàng', 'PSID Facebook'
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
      'Mã NCC', 'Điện thoại', 'ID nhà cung cấp', 'Mã số thuế',
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
    textHeaders: ['Mã nhập hàng', 'Mã nhà cung cấp', 'Điện thoại', 'Số hóa đơn đầu vào', 'Mã hàng']
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
  formatKiotVietSheet_(sheet, schema, rows.length);
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
      sheet.getRange(2, columnIndex + 1, dataRowCount, 1).setNumberFormat('#,##0.##');
    }
  });

  (schema.textHeaders || []).forEach(header => {
    const columnIndex = schema.headers.indexOf(header);
    if (columnIndex >= 0) {
      sheet.getRange(2, columnIndex + 1, dataRowCount, 1).setNumberFormat('@');
    }
  });
}

function writeKiotVietRowsInChunks_(sheet, startRow, rows, columnCount) {
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
    formatKiotVietSheet_(sheet, schema, 0);
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
  formatKiotVietSheet_(sheet, schema, migratedRows.length);
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
    if (columnIndex >= 0) sheet.getRange(rowNumber, columnIndex + 1).setNumberFormat('#,##0.##');
  });
  (schema.textHeaders || []).forEach(header => {
    const columnIndex = schema.headers.indexOf(header);
    if (columnIndex >= 0) sheet.getRange(rowNumber, columnIndex + 1).setNumberFormat('@');
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
  formatKiotVietSheet_(sheet, schema, rows.length);
}
