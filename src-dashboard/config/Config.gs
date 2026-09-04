// ==========================================
// CAU HINH THONG TIN KET NOI KIOTVIET — TOKOSI
//
// File nay dung chung cho 2 Apps Script project doc lap, deploy tu cung
// rootDir src-dashboard/ nhung khac scriptId va khac Script Properties:
//   - KiotHN (.clasp.json)          -> KIOTVIET_RETAILER = CHhanoi
//   - KiotSG (.clasp.saigon.json)   -> KIOTVIET_RETAILER = CHsaigon
// Moi project co Script Properties/token cache rieng, khong doc/ghi cheo
// trang thai cua nhau.
// ==========================================
const CONFIG = {
  get RETAILER() {
    const retailer = PropertiesService.getScriptProperties().getProperty('KIOTVIET_RETAILER');
    if (!retailer) {
      throw new Error('Thieu KIOTVIET_RETAILER trong Apps Script Properties.');
    }
    return retailer;
  }, // Ten gian hang KiotViet cua project nay (KiotHN: CHhanoi, KiotSG: CHsaigon) — bat buoc khai bao, khong fallback ngam

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
  SHEET_CUSTOMER_DEBT_1_DAY: 'HN1',
  SHEET_CUSTOMER_DEBT_3_DAYS: 'HN3',
  SHEET_CUSTOMER_DEBT_7_DAYS: 'HN7'
};

const KIOTVIET_SYNC_MODES = Object.freeze({
  FULL_DASHBOARD: 'FULL_DASHBOARD'
});

/**
 * Project nay chi phuc vu spreadsheet Dashboard. Logic Vận chuyển nằm trong
 * src-order-lifecycle/ và được triển khai bằng .clasp.order-lifecycle.json.
 */
function getKiotVietSyncMode_() {
  return KIOTVIET_SYNC_MODES.FULL_DASHBOARD;
}

function isShipmentLifecycleMode_() {
  return false;
}

function isCombinedKiotVietMode_() {
  return false;
}

function hasShipmentLifecycle_() {
  return false;
}

function isShipmentLifecycleRelayEnabled_() {
  return String(PropertiesService.getScriptProperties()
    .getProperty('KIOTVIET_SHIPMENT_RELAY_ENABLED') || '').toLowerCase() === 'true';
}

/**
 * Schema co dinh cua tab Hang hoa.
 *
 * Chi giu cac cot Dashboard va bao cao van su dung. Dashboard phai tra cuu
 * theo ten header, khong phu thuoc vao vi tri cot co dinh.
 */
const PRODUCT_SHEET_HEADERS = Object.freeze([
  'Mã hàng',
  'Tên hàng',
  'Nhóm hàng',
  'Loại hàng',
  'Giá vốn',
  'Giá bán',
  'Tồn kho',
  'Khách đặt',
  'Trạng thái',
  'Ngày sửa cuối',
  'Mã nhóm hàng',
  'Vị trí'
]);
