#!/usr/bin/env node
// ==========================================
// DONG BO DU LIEU BAN DAU (chay thu cong 1 lan: npm run sync-initial)
// ==========================================
const CONFIG = require('../config');
const { getKiotVietToken } = require('./auth');
const sheetsClient = require('../sheets/sheetsClient');
const { formatDate } = require('../utils/formatDate');

async function fetchAllPages(path) {
  let all = [];
  let currentItem = 0;
  const pageSize = 100;
  let total = 0;
  const token = await getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token.');

  do {
    const url = `https://public.kiotapi.com/${path}?pageSize=${pageSize}&currentItem=${currentItem}${path === 'products' ? '&includeInventory=true' : ''}`;
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Retailer: CONFIG.RETAILER }
    });
    const result = await response.json();
    all = all.concat(result.data || []);
    total = result.total || 0;
    currentItem += pageSize;
  } while (currentItem < total);

  return all;
}

async function syncProductsInitial() {
  const products = await fetchAllPages('products');
  const headers = ['Mã hàng', 'Tên hàng', 'Giá bán', 'Tồn kho', 'Khách đặt', 'Thời gian sửa', 'Dự kiến hết hàng'];
  const rows = products.map(p => {
    const tonKho = p.inventories ? p.inventories.reduce((sum, i) => sum + (i.onHand || 0), 0) : (p.totalOnHand || 0);
    const khachDat = p.inventories ? p.inventories.reduce((sum, i) => sum + (i.reserved || 0), 0) : (p.totalReserved || 0);
    return [p.code || '', p.fullName || p.name || '', p.basePrice || 0, tonKho, khachDat, formatDate(p.modifiedDate || p.createdDate), '---'];
  });
  await sheetsClient.clearAndWrite(CONFIG.SHEET_PRODUCTS, headers, rows);
  console.log(`Da dong bo ${rows.length} san pham.`);
}

async function syncInvoicesInitial() {
  const invoices = await fetchAllPages('invoices');
  const headers = ['Mã hóa đơn', 'Tên khách hàng', 'Tổng tiền', 'Giảm giá', 'Khách đã trả', 'Trạng thái', 'Ngày bán'];
  const rows = invoices.map(i => {
    const statusText = i.status === 2 ? 'Đã hủy' : 'Hoàn thành';
    return [i.code || '', i.customerName || 'Khách lẻ', i.total || 0, i.discount || 0, i.actualPayment || 0, statusText, formatDate(i.purchaseDate)];
  });
  await sheetsClient.clearAndWrite(CONFIG.SHEET_INVOICES, headers, rows);
  console.log(`Da dong bo ${rows.length} hoa don.`);
}

async function syncCustomersInitial() {
  const customers = await fetchAllPages('customers');
  const headers = ['Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Địa chỉ', 'Email', 'Nợ hiện tại'];
  const rows = customers.map(c => [c.code || '', c.name || '', c.contactNumber || '', c.address || '', c.email || '', c.debt || 0]);
  await sheetsClient.clearAndWrite(CONFIG.SHEET_CUSTOMERS, headers, rows);
  console.log(`Da dong bo ${rows.length} khach hang.`);
}

async function syncAllInitialData() {
  const steps = [
    ['Hang hoa', syncProductsInitial],
    ['Hoa don', syncInvoicesInitial],
    ['Khach hang', syncCustomersInitial],
  ];
  const errors = [];

  for (const [label, fn] of steps) {
    console.log(`Bat dau tai ${label}...`);
    try {
      await fn();
    } catch (err) {
      console.error(`Loi khi dong bo ${label}:`, err);
      errors.push([label, err]);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Dong bo hoan tat voi ${errors.length} loi: ${errors.map(([label]) => label).join(', ')}`);
  }
  console.log('Hoan tat dong bo toan bo du lieu ban dau!');
}

if (require.main === module) {
  syncAllInitialData().catch(err => {
    console.error('Loi dong bo:', err);
    process.exit(1);
  });
}

module.exports = { syncAllInitialData, syncProductsInitial, syncInvoicesInitial, syncCustomersInitial };
