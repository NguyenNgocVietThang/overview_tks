// ==========================================
// CAU HINH THONG TIN KET NOI KIOTVIET — TOKOSI
// ==========================================
const CONFIG = {
  RETAILER: 'CHbansi', // Ten gian hang TOKOSI tren KiotViet

  // Ten cac tab luu du lieu tren Sheet
  SHEET_PRODUCTS: 'Hàng hóa',
  SHEET_INVOICES: 'Hóa đơn',
  SHEET_CUSTOMERS: 'Khách hàng',
  SHEET_CATEGORIES: 'Nhóm hàng',
  SHEET_CUSTOMER_REPORT: 'Báo cáo bán hàng',
  SHEET_CUSTOMER_PRODUCT_REPORT: 'Hàng bán theo khách'
};

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
  'Thời gian tạo',
  'Mã nhóm hàng',
  'Hình ảnh',
  'Liên kết kênh bán',
  'Vị trí',
  'Dự kiến hết hàng',
  'Định mức tồn ít nhất',
  'Định mức tồn nhiều nhất'
]);
