// ==========================================
// XU LY CAP NHAT DU LIEU REAL-TIME TU WEBHOOK
// ==========================================

/**
 * Cap nhat Tab: HANG HOA (Real-time)
 * @param {Array} items - Danh sach hang hoa tu webhook payload
 */
function updateProductsFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRODUCTS);
  if (!sheet) return;

  let data = sheet.getDataRange().getValues();
  let codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma hang o cot A (index 0)

  // Xoa tu duoi len truoc khi cap nhat de khong lam sai so dong trong codeRowMap.
  const vatRows = [];
  items.forEach(item => {
    const code = String(item.ProductCode || item.Code || item.code || "").trim();
    if (isVatProductCode(code) && codeRowMap[code]) vatRows.push(codeRowMap[code]);
  });
  [...new Set(vatRows)].sort((a, b) => b - a).forEach(rowNumber => sheet.deleteRow(rowNumber));
  if (vatRows.length > 0) {
    data = sheet.getDataRange().getValues();
    codeRowMap = getCodeRowMap(data, 0);
  }

  items.forEach(item => {
    const code = String(item.ProductCode || item.Code || item.code || "").trim();
    if (!code) return;

    const name = item.ProductName || item.productName || item.FullName || item.fullName || item.Name || item.name || "";
    if (isVatProductCode(code)) return;
    const price = item.BasePrice !== undefined ? item.BasePrice : (item.price || 0);
    const onHand = item.OnHand !== undefined ? item.OnHand : (item.onHand || 0);
    const reserved = item.Reserved !== undefined ? item.Reserved : (item.reserved || 0);
    const timeStr = formatDate(item.ModifiedDate || item.CreatedDate || new Date());

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      if (name) sheet.getRange(r, 2).setValue(name);
      sheet.getRange(r, 3).setValue(price).setNumberFormat("#,##0");
      sheet.getRange(r, 4).setValue(onHand).setNumberFormat("#,##0");
      sheet.getRange(r, 5).setValue(reserved).setNumberFormat("#,##0");
    } else {
      const newRow = [code, name, price, onHand, reserved, timeStr, "---"];
      sheet.appendRow(newRow);
      formatLastRowNumbers(sheet, [3, 4, 5]);
    }
  });
}

/**
 * Cap nhat Tab: HOA DON (Real-time)
 * @param {Array} items - Danh sach hoa don tu webhook payload
 */
function updateInvoicesFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_INVOICES);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma hoa don o cot A (index 0)

  items.forEach(item => {
    const code = String(item.InvoiceCode || item.Code || item.code || "").trim();
    if (!code) return;

    const customer = item.CustomerName || item.customerName || "Khách lẻ";
    const total = item.Total !== undefined ? item.Total : (item.total || 0);
    const discount = item.Discount !== undefined ? item.Discount : (item.discount || 0);
    const actualPay = item.ActualPayment !== undefined ? item.ActualPayment : (item.actualPayment || 0);
    const timeStr = formatDate(item.PurchaseDate || item.purchaseDate || new Date());

    let statusText = "Hoàn thành";
    if (item.Status === 2 || item.status === 2) statusText = "Đã hủy";

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      sheet.getRange(r, 2).setValue(customer);
      sheet.getRange(r, 3).setValue(total).setNumberFormat("#,##0");
      sheet.getRange(r, 4).setValue(discount).setNumberFormat("#,##0");
      sheet.getRange(r, 5).setValue(actualPay).setNumberFormat("#,##0");
      sheet.getRange(r, 6).setValue(statusText);
    } else {
      const newRow = [code, customer, total, discount, actualPay, statusText, timeStr];
      sheet.appendRow(newRow);
      formatLastRowNumbers(sheet, [3, 4, 5]);
    }
  });
}

/**
 * Cap nhat Tab: KHACH HANG (Real-time)
 * @param {Array} items - Danh sach khach hang tu webhook payload
 */
function updateCustomersFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_CUSTOMERS);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma khach o cot A (index 0)

  items.forEach(item => {
    const code = String(item.Code || item.code || "").trim();
    if (!code) return;

    const name = item.Name || item.name || "";
    const phone = item.ContactNumber || item.contactNumber || "";
    const address = item.Address || item.address || "";
    const email = item.Email || item.email || "";
    const totalDebt = item.TotalDebt !== undefined ? item.TotalDebt : (item.totalDebt || 0); // No hien tai

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      sheet.getRange(r, 2).setValue(name);
      sheet.getRange(r, 3).setValue(phone).setNumberFormat("@");
      sheet.getRange(r, 4).setValue(address);
      sheet.getRange(r, 5).setValue(email);
      sheet.getRange(r, 6).setValue(totalDebt).setNumberFormat("#,##0");
    } else {
      const newRow = [code, name, phone, address, email, totalDebt];
      sheet.appendRow(newRow);
      formatLastRowNumbers(sheet, [6]);
    }
  });
}

/**
 * Cap nhat Tab: NHOM HANG (Real-time)
 * @param {Array} items - Danh sach nhom hang tu webhook payload
 */
function updateCategoriesFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_CATEGORIES) || ss.insertSheet(CONFIG.SHEET_CATEGORIES);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Mã nhóm hàng", "Tên nhóm hàng", "Mã nhóm cha"]);
  }

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma nhom hang o cot A (index 0)

  items.forEach(item => {
    const code = String(
      item.CategoryId !== undefined ? item.CategoryId : (item.categoryId !== undefined ? item.categoryId : (item.Id || item.id || ""))
    ).trim();
    if (!code) return;

    const name = item.CategoryName || item.categoryName || item.Name || item.name || "";
    const parentId = item.ParentId !== undefined ? item.ParentId : (item.parentId !== undefined ? item.parentId : "");

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      if (name) sheet.getRange(r, 2).setValue(name);
      sheet.getRange(r, 3).setValue(parentId);
    } else {
      sheet.appendRow([code, name, parentId]);
    }
  });
}
