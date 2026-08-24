// ==========================================
// CAU HINH THONG TIN KET NOI KIOTVIET — TOKOSI
// ==========================================
const CONFIG = {
  get RETAILER() {
    return PropertiesService.getScriptProperties().getProperty('KIOTVIET_RETAILER') || 'CHhanoi';
  }, // Ten gian hang TOKOSI tren KiotViet

  // Ten cac tab luu du lieu tren Sheet
  SHEET_PRODUCTS: 'Hàng hóa',
  SHEET_INVOICES: 'Hóa đơn',
  SHEET_INVOICE_DETAILS: 'Chi tiết hóa đơn',
  SHEET_ORDERS: 'Đặt hàng',
  SHEET_RETURNS: 'Trả hàng',
  SHEET_CUSTOMERS: 'Khách hàng',
  SHEET_CATEGORIES: 'Nhóm hàng',
  SHEET_SUPPLIERS: 'Nhà cung cấp',
  SHEET_PURCHASES: 'Nhập hàng',
  SHEET_CUSTOMER_REPORT: 'Báo cáo bán hàng',
  SHEET_CUSTOMER_PRODUCT_REPORT: 'Hàng bán theo khách',
  SHEET_CUSTOMER_BY_PRODUCT_REPORT: 'Khách theo hàng hóa',
  SHEET_DISCONTINUED_PRODUCTS: 'Hàng ngừng kinh doanh',
  SHEET_CUSTOMER_DEBT_1_DAY: 'HN1',
  SHEET_CUSTOMER_DEBT_3_DAYS: 'HN3',
  SHEET_CUSTOMER_DEBT_7_DAYS: 'HN7',

  // Spreadsheet van chuyen doc lap. O che do SHIPMENT_LIFECYCLE, Apps Script
  // chi ghi cac tab nay va khong tao 9 tab du lieu tong hop cua dashboard cu.
  SHEET_SHIPMENT_ORDERS: 'Đơn vận chuyển',
  SHEET_SHIPMENT_ORDER_ITEMS: 'Chi tiết vận chuyển',
  SHEET_SHIPMENT_STATUS_HISTORY: 'Lịch sử trạng thái',
  SHEET_SHIPMENT_ATTACHMENTS: 'Ảnh chứng từ',
  SHEET_SHIPMENT_EXCEPTIONS: 'Sự cố vận chuyển',
  SHEET_SHIPMENT_VEHICLES: 'Danh mục xe'
};

const KIOTVIET_SYNC_MODES = Object.freeze({
  SHIPMENT_LIFECYCLE: 'SHIPMENT_LIFECYCLE'
});

/**
 * Project nay chi phuc vu spreadsheet Vận chuyển. Gia tri property duoc giu de
 * tuong thich van hanh, nhung khong cho phep chuyen sang Dashboard/COMBINED.
 */
function getKiotVietSyncMode_() {
  return KIOTVIET_SYNC_MODES.SHIPMENT_LIFECYCLE;
}

function isShipmentLifecycleMode_() {
  return getKiotVietSyncMode_() === KIOTVIET_SYNC_MODES.SHIPMENT_LIFECYCLE;
}

function isCombinedKiotVietMode_() {
  return false;
}

function hasShipmentLifecycle_() {
  return true;
}

function isShipmentLifecycleRelayEnabled_() {
  return String(PropertiesService.getScriptProperties()
    .getProperty('KIOTVIET_SHIPMENT_RELAY_ENABLED') || '').toLowerCase() === 'true';
}

/**
 * Schema co dinh cua tab Hang hoa.
 *
 * 12 cot dau giu thu tu ma Dashboard dang su dung. Cac cot con lai bo sung
 * thong tin hien thi tren man hinh Hang hoa cua KiotViet.
 */
const PRODUCT_SHEET_HEADERS = Object.freeze([
  'Mã hàng',
  'Tên hàng',
  'Nhóm hàng',
  'Thương hiệu',
  'Loại hàng',
  'Giá vốn',
  'Giá bán',
  'Tồn kho',
  'Khách đặt',
  'Trạng thái',
  'Ngày sửa cuối',
  'Mã nhóm hàng',
  'Hình ảnh',
  'Liên kết kênh bán',
  'Vị trí',
  'Dự kiến hết hàng',
  'Định mức tồn ít nhất',
  'Định mức tồn nhiều nhất'
]);
