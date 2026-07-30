// ==========================================
// DONG BO DU LIEU BAN DAU (Chay thu cong 1 lan)
// ==========================================

/**
 * Ham tong hop: dong bo toan bo du lieu ban dau tu KiotViet.
 * Chay ham nay duy nhat 1 lan khi bat dau su dung he thong.
 */
function syncAllInitialData() {
  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token.");
    return;
  }

  Logger.log("Bat dau tai Hang hoa...");
  syncProductsInitial(token);

  Logger.log("Bat dau tai Hoa don...");
  syncInvoicesInitial(token);

  Logger.log("Bat dau tai Khach hang...");
  syncCustomersInitial(token);

  Logger.log("Bat dau tai Nhom hang...");
  syncCategoriesInitial(token);

  Logger.log("Hoan tat dong bo toan bo du lieu ban dau!");
}

/**
 * Tai toan bo hang hoa tu KiotViet va ghi vao Sheet "Hang hoa".
 * Co the chay truc tiep ham nay trong Apps Script ma khong can truyen token.
 * @param {string=} token - KiotViet access token (khong bat buoc)
 */
function syncProductsInitial(token) {
  token = token || getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token de dong bo Hang hoa.');

  let allProducts = [];
  let currentItem = 0;
  const pageSize = 100;
  let total = 0;
  do {
    const url = `https://public.kiotapi.com/products?pageSize=${pageSize}&currentItem=${currentItem}&includeInventory=true&includeQuantity=true&IncludeProductShelves=true`;
    const response = UrlFetchApp.fetch(url, { "headers": { "Authorization": "Bearer " + token, "Retailer": CONFIG.RETAILER } });
    const result = JSON.parse(response.getContentText());
    allProducts = allProducts.concat(result.data || []);
    total = result.total || 0;
    currentItem += pageSize;
  } while (currentItem < total);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRODUCTS) || ss.insertSheet(CONFIG.SHEET_PRODUCTS);
  const rows = allProducts
    .filter(product => !isVatProductCode(getProductCode_(product)))
    .map(product => buildProductSheetRow_(product));

  sheet.clearContents();
  sheet.getRange(1, 1, 1, PRODUCT_SHEET_HEADERS.length).setValues([PRODUCT_SHEET_HEADERS]);
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, PRODUCT_SHEET_HEADERS.length).setValues(rows);
  }
  formatProductSheet_(sheet, rows.length);
}

/**
 * Tai toan bo hoa don tu KiotViet va ghi vao Sheet "Hoa don".
 * @param {string} token - KiotViet access token
 */
function syncInvoicesInitial(token) {
  let allInvoices = [];
  let currentItem = 0;
  const pageSize = 100;
  let total = 0;
  do {
    const url = `https://public.kiotapi.com/invoices?pageSize=${pageSize}&currentItem=${currentItem}`;
    const response = UrlFetchApp.fetch(url, { "headers": { "Authorization": "Bearer " + token, "Retailer": CONFIG.RETAILER } });
    const result = JSON.parse(response.getContentText());
    allInvoices = allInvoices.concat(result.data || []);
    total = result.total || 0;
    currentItem += pageSize;
  } while (currentItem < total);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_INVOICES) || ss.insertSheet(CONFIG.SHEET_INVOICES);
  const headers = ["Mã hóa đơn", "Tên khách hàng", "Tổng tiền", "Giảm giá", "Khách đã trả", "Trạng thái", "Ngày bán"];
  const rows = allInvoices.map(i => {
    let statusText = "Hoàn thành";
    if (i.status === 2) statusText = "Đã hủy";
    return [i.code || "", i.customerName || "Khách lẻ", i.total || 0, i.discount || 0, i.actualPayment || 0, statusText, formatDate(i.purchaseDate)];
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#EFEFEF");
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 3).setNumberFormat("#,##0");
  }
}

/**
 * Tai toan bo khach hang tu KiotViet va ghi vao Sheet "Khach hang".
 * @param {string} token - KiotViet access token
 */
function syncCustomersInitial(token) {
  let allCustomers = [];
  let currentItem = 0;
  const pageSize = 100;
  let total = 0;
  do {
    const url = `https://public.kiotapi.com/customers?pageSize=${pageSize}&currentItem=${currentItem}`;
    const response = UrlFetchApp.fetch(url, { "headers": { "Authorization": "Bearer " + token, "Retailer": CONFIG.RETAILER } });
    const result = JSON.parse(response.getContentText());
    allCustomers = allCustomers.concat(result.data || []);
    total = result.total || 0;
    currentItem += pageSize;
  } while (currentItem < total);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_CUSTOMERS) || ss.insertSheet(CONFIG.SHEET_CUSTOMERS);
  const headers = ["Mã khách hàng", "Tên khách hàng", "Điện thoại", "Địa chỉ", "Email", "Nợ hiện tại"];
  const rows = allCustomers.map(c => {
    return [c.code || "", c.name || "", c.contactNumber || "", c.address || "", c.email || "", c.debt || 0];
  });
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#EFEFEF");
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat("@"); // Dien thoai dang text tranh mat so 0 dau
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat("#,##0");
  }
}

/**
 * Tai toan bo nhom hang tu KiotViet va ghi vao Sheet "Nhom hang".
 * Can dong bo day du (khong chi cac nhom thay doi qua webhook) de
 * buildParentCategoryResolver_ (DashboardData.gs) tim dung nhom cha goc
 * cho tung san pham.
 * @param {string} token - KiotViet access token
 */
function syncCategoriesInitial(token) {
  let allCategories = [];
  let currentItem = 0;
  const pageSize = 100;
  let total = 0;
  do {
    const url = `https://public.kiotapi.com/categories?hierarchicalData=false&pageSize=${pageSize}&currentItem=${currentItem}`;
    const response = UrlFetchApp.fetch(url, { "headers": { "Authorization": "Bearer " + token, "Retailer": CONFIG.RETAILER } });
    const result = JSON.parse(response.getContentText());
    allCategories = allCategories.concat(result.data || []);
    total = result.total || 0;
    currentItem += pageSize;
  } while (currentItem < total);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_CATEGORIES) || ss.insertSheet(CONFIG.SHEET_CATEGORIES);
  const headers = ["Mã nhóm hàng", "Tên nhóm hàng", "Mã nhóm cha"];
  const rows = allCategories.map(c => [c.categoryId || "", c.categoryName || "", c.parentId || ""]);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#EFEFEF");
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}
