// ==========================================
// XU LY CAP NHAT DU LIEU REAL-TIME TU WEBHOOK
// ==========================================
const CONFIG = require('../config');
const sheetsClient = require('../sheets/sheetsClient');
const { formatDate, getCodeRowMap } = require('../utils/formatDate');

/**
 * Cap nhat Tab: HANG HOA (Real-time)
 * @param {Array} items - Danh sach hang hoa tu webhook payload
 */
async function updateProductsFromWebhook(items) {
  const data = await sheetsClient.getValues(CONFIG.SHEET_PRODUCTS);
  if (data.length === 0) return;
  const codeRowMap = getCodeRowMap(data, 0);

  for (const item of items) {
    const code = String(item.ProductCode || item.Code || item.code || '').trim();
    if (!code) continue;

    const name = item.ProductName || item.FullName || item.Name || '';
    const price = item.BasePrice !== undefined ? item.BasePrice : (item.price || 0);
    const onHand = item.OnHand !== undefined ? item.OnHand : (item.onHand || 0);
    const reserved = item.Reserved !== undefined ? item.Reserved : (item.reserved || 0);
    const timeStr = formatDate(item.ModifiedDate || item.CreatedDate || new Date());

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      const existing = data[r - 1];
      await sheetsClient.updateRow(CONFIG.SHEET_PRODUCTS, r, [
        code, name || existing[1], price, onHand, reserved, existing[5], existing[6]
      ]);
    } else {
      await sheetsClient.appendRow(CONFIG.SHEET_PRODUCTS, [code, name, price, onHand, reserved, timeStr, '---']);
    }
  }
}

/**
 * Cap nhat Tab: HOA DON (Real-time)
 * @param {Array} items - Danh sach hoa don tu webhook payload
 */
async function updateInvoicesFromWebhook(items) {
  const data = await sheetsClient.getValues(CONFIG.SHEET_INVOICES);
  if (data.length === 0) return;
  const codeRowMap = getCodeRowMap(data, 0);

  for (const item of items) {
    const code = String(item.InvoiceCode || item.Code || item.code || '').trim();
    if (!code) continue;

    const customer = item.CustomerName || item.customerName || 'Khách lẻ';
    const total = item.Total !== undefined ? item.Total : (item.total || 0);
    const discount = item.Discount !== undefined ? item.Discount : (item.discount || 0);
    const actualPay = item.ActualPayment !== undefined ? item.ActualPayment : (item.actualPayment || 0);
    const timeStr = formatDate(item.PurchaseDate || item.purchaseDate || new Date());

    let statusText = 'Hoàn thành';
    if (item.Status === 2 || item.status === 2) statusText = 'Đã hủy';

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      const existing = data[r - 1];
      await sheetsClient.updateRow(CONFIG.SHEET_INVOICES, r, [
        code, customer, total, discount, actualPay, statusText, existing[6]
      ]);
    } else {
      await sheetsClient.appendRow(CONFIG.SHEET_INVOICES, [code, customer, total, discount, actualPay, statusText, timeStr]);
    }
  }
}

/**
 * Cap nhat Tab: KHACH HANG (Real-time)
 * @param {Array} items - Danh sach khach hang tu webhook payload
 */
async function updateCustomersFromWebhook(items) {
  const data = await sheetsClient.getValues(CONFIG.SHEET_CUSTOMERS);
  if (data.length === 0) return;
  const codeRowMap = getCodeRowMap(data, 0);

  for (const item of items) {
    const code = String(item.Code || item.code || '').trim();
    if (!code) continue;

    const name = item.Name || item.name || '';
    const phone = item.ContactNumber || item.contactNumber || '';
    const address = item.Address || item.address || '';
    const email = item.Email || item.email || '';
    const totalDebt = item.TotalDebt !== undefined ? item.TotalDebt : (item.totalDebt || 0);

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      await sheetsClient.updateRow(CONFIG.SHEET_CUSTOMERS, r, [code, name, phone, address, email, totalDebt]);
    } else {
      await sheetsClient.appendRow(CONFIG.SHEET_CUSTOMERS, [code, name, phone, address, email, totalDebt]);
    }
  }
}

module.exports = { updateProductsFromWebhook, updateInvoicesFromWebhook, updateCustomersFromWebhook };
