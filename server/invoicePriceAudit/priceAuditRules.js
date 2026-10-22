'use strict';

// Quy tac dau vao cua "Kiem tra gia ban": cap khach, Full VAT, hang bo qua, khach bao cuoc.
// Ham thuan, khong doc DB.

const { normalizeText } = require('./priceNoteParser');

// Khach HN duoc bao cuoc: min ap dung = min(min_HN + cuoc; min_SG). So khop ca ten (giu dau).
const FREIGHT_CUSTOMERS = [
  'KMN Jinlong + ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN',
  'KMN KAI (ML)+ ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN',
  'KH Vin Dany + ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN',
  'KMN Tín Phong Shop',
  'KH HENG - ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN',
  'KMN C Thư Sóc Trăng',
  'KMN A Thìn Bình Tân',
  'KMN C Thu Thủy Bình Phước',
  'KMN C Vân Anh Bình Phước',
  'KH Srey Hi - ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN',
];

// Ten khach: NFC + chu thuong + gop khoang trang. KHONG bo dau.
function normalizeCustomerName(name) {
  if (name == null) return '';
  return String(name).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const FREIGHT_SET = new Set(FREIGHT_CUSTOMERS.map(normalizeCustomerName));

function isFreightCustomer(name) {
  const n = normalizeCustomerName(name);
  return n !== '' && FREIGHT_SET.has(n);
}

// Khach KHONG co email (null/rong/chi khoang trang) = Lon. Co email: phan truoc "@" bo dau, thuong, bo khoang trang;
// chi lon/vip nhan dien, email co gia tri khac la Vua.
function customerLevelFromEmail(email) {
  if (typeof email !== 'string' || email.trim() === '') return 'large';
  const at = email.indexOf('@');
  const local = at >= 0 ? email.slice(0, at) : email;
  const key = local
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (key === 'lon') return 'large';
  if (key === 'vip') return 'vip';
  return 'medium';
}

// "vat" (ranh gioi tu; van nhan fullvat / full vat) trong ghi chu dong HOAC ghi chu chung hoa don.
const FULL_VAT_RE = /(?<![\p{L}\p{N}_])(?:full ?)?vat(?![\p{L}\p{N}_])/u;
function hasFullVat(lineNote, invoiceNote) {
  return FULL_VAT_RE.test(normalizeText(lineNote)) || FULL_VAT_RE.test(normalizeText(invoiceNote));
}

// Chi "(OD)" / "(PK)" trong ngoac (cho phep dau cach ben trong); chu OD/PK tran khong tinh.
function isExcludedProduct(name) {
  const n = normalizeText(name);
  if (/\( ?od ?\)/.test(n)) return 'od';
  if (/\( ?pk ?\)/.test(n)) return 'pk';
  return null;
}

module.exports = {
  FREIGHT_CUSTOMERS,
  normalizeCustomerName,
  isFreightCustomer,
  customerLevelFromEmail,
  hasFullVat,
  isExcludedProduct,
};
